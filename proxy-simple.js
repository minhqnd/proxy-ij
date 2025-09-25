// proxy-simple.js
// Simple generic proxy that injects script into specified domains
const express = require('express');
const { fetch } = require('undici');
const zlib = require('zlib');
const crypto = require('crypto');

const app = express();

// CONFIG
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Domains to inject script into
const INJECT_DOMAINS = ['example.com'];

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
    if (NODE_ENV === 'development') {
      console.warn(`Decompression failed for '${encoding}':`, e.message);
    }
  }
  return buffer;
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

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    type: 'simple-proxy',
    inject_domains: INJECT_DOMAINS,
    timestamp: new Date().toISOString()
  });
});

// Proxy middleware
app.use(async (req, res) => {
  try {
    if (req.path === '/health') return;

    // Build target URL - default to example.com
    const targetUrl = 'https://example.com' + req.originalUrl;
    const targetHost = 'example.com';

    console.log(`Proxying: ${req.method} ${targetUrl}`);

    // Prepare headers
    const outgoingHeaders = { ...req.headers };
    delete outgoingHeaders['accept-encoding']; // Handle compression ourselves
    outgoingHeaders.host = targetHost;

    // Fetch from upstream
    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers: outgoingHeaders,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : req,
    });

    // Get response headers
    const headers = {};
    upstream.headers.forEach((v, k) => headers[k.toLowerCase()] = v);

    // Get response body
    const arrayBuf = await upstream.arrayBuffer();
    let bodyBuf = Buffer.from(arrayBuf);

    const contentEncoding = headers['content-encoding'];
    const contentType = (headers['content-type'] || '').toLowerCase();

    // Decompress if needed
    if (contentEncoding) {
      bodyBuf = decompressIfNeeded(bodyBuf, contentEncoding);
      delete headers['content-encoding']; // Remove since we're sending decompressed
    }

    // Inject script for HTML responses
    const shouldInject = INJECT_DOMAINS.some(domain => targetHost.includes(domain));
    
    if (shouldInject && contentType.includes('text/html')) {
      let bodyStr = bodyBuf.toString('utf8');
      const nonce = randomNonce();

      // Script to inject
      const scriptContent = `
        (function(){
          try {
            // Add CSS
            var css = \`.proxy-btn {
              position: fixed;
              top: 20px;
              right: 20px;
              z-index: 999999;
              padding: 12px 16px;
              border-radius: 8px;
              background: #e74c3c;
              color: white;
              border: none;
              box-shadow: 0 4px 12px rgba(231,76,60,0.3);
              cursor: pointer;
              font-family: Arial, sans-serif;
              font-size: 14px;
              font-weight: bold;
              transition: all 0.2s ease;
            }
            .proxy-btn:hover {
              background: #c0392b;
              transform: scale(1.05);
            }\`;
            
            var style = document.createElement('style');
            style.textContent = css;
            document.head.appendChild(style);
            
            // Add button
            var btn = document.createElement('button');
            btn.className = 'proxy-btn';
            btn.textContent = '🔄 Proxied';
            btn.onclick = function() {
              alert('This page is being proxied!\\n\\nOriginal: ${targetUrl}\\nProxy: ' + window.location.href);
            };
            
            document.body.appendChild(btn);
            
            console.log('✅ Proxy injection successful');
          } catch(e) {
            console.error('❌ Proxy injection failed:', e);
          }
        })();
      `;

      const scriptTag = `<script nonce="${nonce}">${scriptContent}</script>`;

      // Inject before closing body tag
      if (bodyStr.includes('</body>')) {
        bodyStr = bodyStr.replace('</body>', scriptTag + '</body>');
      } else {
        bodyStr += scriptTag;
      }

      bodyBuf = Buffer.from(bodyStr, 'utf8');
      
      // Update CSP header
      headers['content-security-policy'] = addNonceToCSP(headers['content-security-policy'], nonce);
    }

    // Update content length
    headers['content-length'] = Buffer.byteLength(bodyBuf);

    // Remove hop-by-hop headers
    const hopByHop = ['connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade'];
    Object.keys(headers).forEach(k => {
      if (hopByHop.includes(k)) delete headers[k];
    });

    // Set response headers
    Object.entries(headers).forEach(([k, v]) => {
      res.setHeader(k, v);
    });

    res.status(upstream.status);
    res.send(bodyBuf);

  } catch (err) {
    console.error('Proxy error:', err.message);
    res.status(502).json({
      error: 'Proxy Error',
      message: err.message,
      timestamp: new Date().toISOString()
    });
  }
});

app.listen(PORT, () => {
  console.log(`🔄 Simple proxy server running on port ${PORT}`);
  console.log(`🎯 Injecting scripts into: ${INJECT_DOMAINS.join(', ')}`);
  console.log(`🏥 Health check: http://localhost:${PORT}/health`);
  console.log(`🧪 Test: http://localhost:${PORT}/ (will proxy example.com)`);
});