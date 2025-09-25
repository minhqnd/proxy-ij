// proxy-inject-nonce.js
// Node 18+, express + undici
const express = require('express');
const { fetch } = require('undici');
const zlib = require('zlib');
const crypto = require('crypto');

const app = express();

// CONFIG
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Domains to inject script into (add more as needed)
const INJECT_DOMAINS = ['example.com', 'www.example.com', 'minhqnd.com'];
const DEFAULT_TARGET = 'https://example.com'; // Default when no host specified

// util: generate base64 nonce
function randomNonce(len = 12) {
  return crypto.randomBytes(len).toString('base64');
}

function decompressIfNeeded(buffer, encoding) {
  if (!encoding) return buffer;
  encoding = encoding.toLowerCase();
  
  try {
    if (encoding.includes('br')) {
      return zlib.brotliDecompressSync(buffer);
    } else if (encoding.includes('gzip')) {
      return zlib.gunzipSync(buffer);
    } else if (encoding.includes('deflate')) {
      return zlib.inflateSync(buffer);
    }
  } catch (e) {
    // If decompression fails, return original buffer and log detailed error
    if (NODE_ENV === 'development') {
      console.warn(`Decompress failed for encoding '${encoding}':`, e.message);
    }
  }
  return buffer;
}

// Add nonce into an existing CSP header value or create one
function addNonceToCSP(cspHeaderValue, nonce) {
  const nonceToken = `'nonce-${nonce}'`;
  if (!cspHeaderValue) {
    return `script-src 'self' ${nonceToken}; object-src 'none'; base-uri 'self'`;
  }
  // split directives and inject into script-src if exists, otherwise add script-src
  const parts = cspHeaderValue.split(';').map(p => p.trim()).filter(Boolean);
  let found = false;
  const newParts = parts.map(part => {
    if (part.startsWith('script-src')) {
      found = true;
      if (part.includes('nonce-')) return part;
      return part + ' ' + nonceToken;
    }
    return part;
  });
  if (!found) {
    newParts.unshift(`script-src 'self' ${nonceToken}`);
  }
  return newParts.join('; ');
}

// Handle CSP meta tags in HTML content
function patchMetaCSP(htmlContent, nonce) {
  const metaCSPRegex = /<meta\s+http-equiv\s*=\s*["']content-security-policy["']\s+content\s*=\s*["']([^"']+)["']\s*\/?>/gi;
  return htmlContent.replace(metaCSPRegex, (match, content) => {
    const updatedContent = addNonceToCSP(content, nonce);
    return match.replace(content, updatedContent);
  });
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    type: 'generic-proxy-with-injection',
    inject_domains: INJECT_DOMAINS,
    default_target: DEFAULT_TARGET,
    uptime: process.uptime()
  });
});

// Main proxy middleware
app.use(async (req, res) => {
  try {
    // Skip health check endpoint
    if (req.path === '/health') {
      return;
    }

    const targetUrl = TARGET_ORIGIN + req.originalUrl;

    // copy headers but remove accept-encoding so upstream returns raw compressed content we'll handle
    const outgoingHeaders = { ...req.headers };
    delete outgoingHeaders['accept-encoding'];

    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers: outgoingHeaders,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : req,
      // timeout and other options can be set here
    });

    // collect headers
    const headers = {};
    upstream.headers.forEach((v, k) => headers[k.toLowerCase()] = v);

    const arrayBuf = await upstream.arrayBuffer();
    let bodyBuf = Buffer.from(arrayBuf);

    const contentEncoding = headers['content-encoding'] || '';
    const contentType = (headers['content-type'] || '').toLowerCase();

    // decompress if upstream compressed
    if (contentEncoding) {
      const originalBuf = bodyBuf;
      bodyBuf = decompressIfNeeded(bodyBuf, contentEncoding);
      
      // Only remove content-encoding if decompression was successful
      if (bodyBuf !== originalBuf || !contentEncoding) {
        delete headers['content-encoding'];
      }
    }

    // Only attempt injection for text/html responses
    if (contentType.includes('text/html')) {
      let bodyStr = bodyBuf.toString('utf8');

      // generate per-response nonce
      const nonce = randomNonce(12);

      // safe inline script content (avoid literal </script>)
      const inlineContent = `(function(){try{var css=".my-inject-btn{position:fixed;right:20px;bottom:20px;z-index:999999;padding:10px 14px;border-radius:8px;background:#0b74de;color:white;border:none;box-shadow:0 6px 14px rgba(11,116,222,0.25);cursor:pointer;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:500;transition:all 0.2s ease;transform:translateZ(0)}";var s=document.createElement('style');s.appendChild(document.createTextNode(css));document.head.appendChild(s);var btn=document.createElement('button');btn.className='my-inject-btn';btn.id='minhqnd-inject-btn';btn.textContent='Hi!';btn.addEventListener('click',function(){alert('hello');});btn.addEventListener('mouseenter',function(){this.style.transform='scale(1.05) translateZ(0)';});btn.addEventListener('mouseleave',function(){this.style.transform='scale(1) translateZ(0)';});document.body.appendChild(btn);}catch(e){console.error('injection error',e);} })();`;

      // build script tag with nonce attribute
      const safeInline = `<script nonce="${nonce}">${inlineContent}</script>`;

      if (bodyStr.includes('</body>')) {
        bodyStr = bodyStr.replace('</body>', safeInline + '</body>');
      } else if (bodyStr.includes('</html>')) {
        bodyStr = bodyStr.replace('</html>', safeInline + '</html>');
      } else {
        bodyStr += safeInline;
      }

      // Handle meta-tag CSP if present
      bodyStr = patchMetaCSP(bodyStr, nonce);

      bodyBuf = Buffer.from(bodyStr, 'utf8');

      // Update/insert CSP header to include the nonce
      headers['content-security-policy'] = addNonceToCSP(headers['content-security-policy'], nonce);
    }

    // update content-length to new body size
    delete headers['content-length'];
    headers['content-length'] = Buffer.byteLength(bodyBuf);

    // remove hop-by-hop headers if any
    const hopByHop = [
      'connection','keep-alive','proxy-authenticate','proxy-authorization',
      'te','trailer','transfer-encoding','upgrade'
    ];
    Object.keys(headers).forEach(k => {
      if (hopByHop.includes(k)) delete headers[k];
    });

    // set headers on response
    Object.entries(headers).forEach(([k, v]) => {
      // Express handles set-cookie differently but v is string or array
      res.setHeader(k, v);
    });

    // status code passthrough
    res.status(upstream.status);
    res.send(bodyBuf);

    // Log requests in development
    if (NODE_ENV === 'development') {
      console.log(`${new Date().toISOString()} - ${req.method} ${req.originalUrl} -> ${upstream.status}`);
    }

  } catch (err) {
    console.error('Proxy error:', err && err.stack || err);
    res.status(502).json({
      error: 'Bad gateway (proxy error)',
      timestamp: new Date().toISOString(),
      target: TARGET_ORIGIN
    });
  }
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down gracefully');
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`Generic proxy server listening on ${PORT}`);
  console.log(`Default target: ${DEFAULT_TARGET}`);
  console.log(`Script injection enabled for: ${INJECT_DOMAINS.join(', ')}`);
  console.log(`Environment: ${NODE_ENV}`);
  console.log(`Health check available at: http://localhost:${PORT}/health`);
});