// proxy-inject-improved.js 
// Improved version with better compression handling
const express = require('express');
const { fetch } = require('undici');
const zlib = require('zlib');
const crypto = require('crypto');

const app = express();

// CONFIG
const TARGET_ORIGIN = 'https://minhqnd.com';
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

function randomNonce(len = 12) {
  return crypto.randomBytes(len).toString('base64');
}

// Improved decompression with better error handling
function decompressIfNeeded(buffer, encoding) {
  if (!encoding) return { buffer, success: true };
  
  const encodings = encoding.toLowerCase().split(',').map(e => e.trim());
  let result = buffer;
  let success = true;
  
  try {
    for (const enc of encodings.reverse()) { // Process in reverse order
      if (enc === 'br' || enc === 'brotli') {
        result = zlib.brotliDecompressSync(result);
      } else if (enc === 'gzip') {
        result = zlib.gunzipSync(result);
      } else if (enc === 'deflate') {
        result = zlib.inflateSync(result);
      }
    }
  } catch (e) {
    if (NODE_ENV === 'development') {
      console.warn(`Decompression failed for '${encoding}': ${e.message}`);
    }
    success = false;
    result = buffer; // Return original buffer on failure
  }
  
  return { buffer: result, success };
}

function addNonceToCSP(cspHeaderValue, nonce) {
  const nonceToken = `'nonce-${nonce}'`;
  if (!cspHeaderValue) {
    return `script-src 'self' ${nonceToken}; object-src 'none'; base-uri 'self'`;
  }
  
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
    target: TARGET_ORIGIN,
    uptime: process.uptime(),
    version: '1.1.0 - Improved compression handling'
  });
});

// Main proxy middleware
app.use(async (req, res) => {
  try {
    if (req.path === '/health') return;

    const targetUrl = TARGET_ORIGIN + req.originalUrl;

    // Keep original headers but don't remove accept-encoding
    // Let upstream decide compression, we'll handle it properly
    const outgoingHeaders = { ...req.headers };

    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers: outgoingHeaders,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : req,
    });

    const headers = {};
    upstream.headers.forEach((v, k) => headers[k.toLowerCase()] = v);

    const arrayBuf = await upstream.arrayBuffer();
    let bodyBuf = Buffer.from(arrayBuf);

    const contentEncoding = headers['content-encoding'];
    const contentType = (headers['content-type'] || '').toLowerCase();

    // Handle compression
    let isDecompressed = false;
    if (contentEncoding) {
      const { buffer: decompressed, success } = decompressIfNeeded(bodyBuf, contentEncoding);
      if (success) {
        bodyBuf = decompressed;
        isDecompressed = true;
        delete headers['content-encoding'];
      }
      // If decompression failed, keep original buffer and headers
    }

    // Only process HTML content that we can actually modify
    if (contentType.includes('text/html') && (isDecompressed || !contentEncoding)) {
      let bodyStr = bodyBuf.toString('utf8');
      const nonce = randomNonce(12);

      const inlineContent = `(function(){try{var css=".my-inject-btn{position:fixed;right:20px;bottom:20px;z-index:999999;padding:10px 14px;border-radius:8px;background:#0b74de;color:white;border:none;box-shadow:0 6px 14px rgba(11,116,222,0.25);cursor:pointer;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:500;transition:all 0.2s ease;transform:translateZ(0)}";var s=document.createElement('style');s.appendChild(document.createTextNode(css));document.head.appendChild(s);var btn=document.createElement('button');btn.className='my-inject-btn';btn.id='minhqnd-inject-btn';btn.textContent='Hi!';btn.addEventListener('click',function(){alert('hello');});btn.addEventListener('mouseenter',function(){this.style.transform='scale(1.05) translateZ(0)';});btn.addEventListener('mouseleave',function(){this.style.transform='scale(1) translateZ(0)';});document.body.appendChild(btn);}catch(e){console.error('injection error',e);} })();`;

      const safeInline = `<script nonce="${nonce}">${inlineContent}</script>`;

      if (bodyStr.includes('</body>')) {
        bodyStr = bodyStr.replace('</body>', safeInline + '</body>');
      } else if (bodyStr.includes('</html>')) {
        bodyStr = bodyStr.replace('</html>', safeInline + '</html>');
      } else {
        bodyStr += safeInline;
      }

      bodyStr = patchMetaCSP(bodyStr, nonce);
      bodyBuf = Buffer.from(bodyStr, 'utf8');
      headers['content-security-policy'] = addNonceToCSP(headers['content-security-policy'], nonce);
    }

    // Update content-length only if we modified the content
    if (isDecompressed || contentType.includes('text/html')) {
      delete headers['content-length'];
      headers['content-length'] = Buffer.byteLength(bodyBuf);
    }

    // Remove hop-by-hop headers
    const hopByHop = [
      'connection','keep-alive','proxy-authenticate','proxy-authorization',
      'te','trailer','transfer-encoding','upgrade'
    ];
    Object.keys(headers).forEach(k => {
      if (hopByHop.includes(k)) delete headers[k];
    });

    // Set headers on response
    Object.entries(headers).forEach(([k, v]) => {
      res.setHeader(k, v);
    });

    res.status(upstream.status);
    res.send(bodyBuf);

    // Log requests in development (less verbose)
    if (NODE_ENV === 'development' && !req.originalUrl.includes('_next/static')) {
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
  console.log(`Proxy injector (improved) listening on ${PORT}, forwarding to ${TARGET_ORIGIN}`);
  console.log(`Environment: ${NODE_ENV}`);
  console.log(`Health check available at: http://localhost:${PORT}/health`);
});