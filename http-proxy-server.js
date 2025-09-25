// http-proxy-server.js
// True HTTP proxy server that can handle any domain with injection
const express = require('express');
const { fetch } = require('undici');
const zlib = require('zlib');
const crypto = require('crypto');
const { URL } = require('url');

const app = express();

// CONFIG
const PORT = process.env.PORT || 8080; // Standard proxy port
const NODE_ENV = process.env.NODE_ENV || 'development';

// Domains to inject script into
const INJECT_DOMAINS = ['example.com', 'httpbin.org', 'minhqnd.com'];

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

// Proxy status page
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>HTTP Proxy Server</title>
      <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; }
        .status { background: #d4edda; border: 1px solid #c3e6cb; padding: 15px; border-radius: 5px; }
        .config { background: #f8f9fa; border: 1px solid #dee2e6; padding: 15px; border-radius: 5px; margin: 20px 0; }
        code { background: #e9ecef; padding: 2px 5px; border-radius: 3px; }
      </style>
    </head>
    <body>
      <h1>🔄 HTTP Proxy Server</h1>
      <div class="status">
        <h3>✅ Proxy Status: Running</h3>
        <p><strong>Port:</strong> ${PORT}</p>
        <p><strong>Type:</strong> HTTP Proxy with Script Injection</p>
        <p><strong>Injection Domains:</strong> ${INJECT_DOMAINS.join(', ')}</p>
      </div>
      
      <div class="config">
        <h3>🔧 Browser Configuration</h3>
        <p>Set your browser's HTTP proxy to:</p>
        <p><code>127.0.0.1:${PORT}</code></p>
        <p>Or configure system proxy with these settings.</p>
      </div>

      <div class="config">
        <h3>🧪 Test URLs</h3>
        <p>Try visiting these URLs after setting up the proxy:</p>
        <ul>
          <li><a href="http://example.com" target="_blank">http://example.com</a> (will have injection)</li>
          <li><a href="http://httpbin.org/html" target="_blank">http://httpbin.org/html</a> (will have injection)</li>
          <li><a href="http://google.com" target="_blank">http://google.com</a> (no injection)</li>
        </ul>
      </div>
    </body>
    </html>
  `);
});

// Health check
app.get('/proxy-health', (req, res) => {
  res.json({
    status: 'healthy',
    type: 'http-proxy-server',
    port: PORT,
    inject_domains: INJECT_DOMAINS,
    timestamp: new Date().toISOString()
  });
});

// HTTP Proxy middleware - this handles ALL requests
app.use(async (req, res) => {
  try {
    // Skip our own status pages
    if (req.path === '/' || req.path === '/proxy-health') {
      return;
    }

    // Parse the requested URL
    // For HTTP proxy, the full URL is in req.url
    let targetUrl;
    
    if (req.url.startsWith('http://') || req.url.startsWith('https://')) {
      // Direct proxy request with full URL
      targetUrl = req.url;
    } else {
      // Relative URL - construct with Host header
      const protocol = req.headers['x-forwarded-proto'] || (req.connection.encrypted ? 'https' : 'http');
      const host = req.headers.host;
      targetUrl = `${protocol}://${host}${req.url}`;
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(targetUrl);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid URL', url: targetUrl });
    }

    const targetHost = parsedUrl.hostname;
    
    console.log(`🔄 Proxying: ${req.method} ${targetUrl}`);

    // Prepare headers for upstream request
    const outgoingHeaders = { ...req.headers };
    
    // Clean up proxy-specific headers
    delete outgoingHeaders['accept-encoding']; // Handle compression ourselves
    delete outgoingHeaders['proxy-connection'];
    delete outgoingHeaders['proxy-authenticate'];
    delete outgoingHeaders['proxy-authorization'];
    
    // Set correct host
    outgoingHeaders.host = targetHost;

    // Make request to upstream server
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

    // Check if we should inject script for this domain
    const shouldInject = INJECT_DOMAINS.some(domain => targetHost.includes(domain));
    
    // Inject script for HTML responses from specified domains
    if (shouldInject && contentType.includes('text/html')) {
      let bodyStr = bodyBuf.toString('utf8');
      const nonce = randomNonce();

      console.log(`💉 Injecting script into ${targetHost}`);

      // Script to inject
      const scriptContent = `
        (function(){
          try {
            // Add CSS
            var css = \`.proxy-indicator {
              position: fixed;
              top: 10px;
              right: 10px;
              z-index: 999999;
              padding: 8px 12px;
              border-radius: 20px;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              color: white;
              border: none;
              box-shadow: 0 4px 15px rgba(102,126,234,0.4);
              cursor: pointer;
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
              font-size: 12px;
              font-weight: 600;
              transition: all 0.3s ease;
              transform: translateZ(0);
            }
            .proxy-indicator:hover {
              transform: scale(1.05) translateZ(0);
              box-shadow: 0 6px 20px rgba(102,126,234,0.6);
            }
            .proxy-indicator::before {
              content: '🔄';
              margin-right: 5px;
            }\`;
            
            var style = document.createElement('style');
            style.textContent = css;
            document.head.appendChild(style);
            
            // Add indicator
            var indicator = document.createElement('button');
            indicator.className = 'proxy-indicator';
            indicator.textContent = 'PROXIED';
            indicator.title = 'This page is being served through a proxy server';
            indicator.onclick = function() {
              alert('🔄 Proxy Server Active!\\n\\n' +
                    'Original URL: ${targetUrl}\\n' +
                    'Proxy Server: ${req.headers.host || 'localhost:' + PORT}\\n' +
                    'Target Host: ${targetHost}\\n\\n' +
                    'This content has been modified by the proxy server.');
            };
            
            // Add to page
            if (document.body) {
              document.body.appendChild(indicator);
            } else {
              document.addEventListener('DOMContentLoaded', function() {
                document.body.appendChild(indicator);
              });
            }
            
            console.log('✅ Proxy injection successful for ${targetHost}');
          } catch(e) {
            console.error('❌ Proxy injection failed:', e);
          }
        })();
      `;

      const scriptTag = `<script nonce="${nonce}">${scriptContent}</script>`;

      // Inject before closing body tag, or at end if no body tag
      if (bodyStr.includes('</body>')) {
        bodyStr = bodyStr.replace('</body>', scriptTag + '</body>');
      } else if (bodyStr.includes('</html>')) {
        bodyStr = bodyStr.replace('</html>', scriptTag + '</html>');
      } else {
        bodyStr += scriptTag;
      }

      bodyBuf = Buffer.from(bodyStr, 'utf8');
      
      // Update CSP header to allow our script
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

    // Log successful proxy
    if (NODE_ENV === 'development') {
      console.log(`✅ ${req.method} ${targetHost}${parsedUrl.pathname} -> ${upstream.status} ${shouldInject ? '(INJECTED)' : ''}`);
    }

  } catch (err) {
    console.error('❌ Proxy error:', err.message);
    res.status(502).json({
      error: 'Proxy Error',
      message: err.message,
      timestamp: new Date().toISOString(),
      url: req.url
    });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 HTTP Proxy Server running on port ${PORT}`);
  console.log(`🎯 Script injection enabled for: ${INJECT_DOMAINS.join(', ')}`);
  console.log(`🌐 Configure your browser to use HTTP proxy: 127.0.0.1:${PORT}`);
  console.log(`📊 Status page: http://localhost:${PORT}/`);
  console.log(`🏥 Health check: http://localhost:${PORT}/proxy-health`);
  console.log('');
  console.log('🔧 Browser setup:');
  console.log('   HTTP Proxy: 127.0.0.1:' + PORT);
  console.log('   HTTPS Proxy: 127.0.0.1:' + PORT);
  console.log('');
});