// reverse-proxy-dns.js
// Reverse proxy với DNS control - cách tốt nhất cho HTTPS injection
const express = require('express');
const { fetch } = require('undici');
const zlib = require('zlib');
const crypto = require('crypto');
const { URL } = require('url');

const app = express();

// CONFIG
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'production';

// ORIGIN SERVER - server thật mà bạn muốn proxy
const ORIGIN_HOST = process.env.ORIGIN_HOST || 'minhqnd.com';
const ORIGIN_PROTOCOL = process.env.ORIGIN_PROTOCOL || 'https';

// PROXY DOMAIN - domain bạn sở hữu và điều khiển DNS
const PROXY_DOMAIN = process.env.PROXY_DOMAIN || 'proxy.minhqnd.com';

// Middleware để parse body
app.use(express.raw({ type: '*/*', limit: '50mb' }));

function randomNonce(len = 12) {
  return crypto.randomBytes(len).toString('base64');
}

function decompressIfNeeded(buffer, encoding) {
  if (!encoding) return { buffer, success: true };
  
  const encodings = encoding.toLowerCase().split(',').map(e => e.trim());
  let result = buffer;
  let success = true;
  
  try {
    for (const enc of encodings.reverse()) {
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
    result = buffer;
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

// Health check cho reverse proxy
app.get('/proxy-health', (req, res) => {
  res.json({
    status: 'healthy',
    type: 'reverse-proxy-dns',
    proxy_domain: PROXY_DOMAIN,
    origin_host: ORIGIN_HOST,
    origin_protocol: ORIGIN_PROTOCOL,
    ssl_status: 'valid_certificate',
    injection_status: 'enabled',
    timestamp: new Date().toISOString()
  });
});

// Status page cho reverse proxy
app.get('/proxy-status', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Reverse Proxy Status</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; max-width: 900px; margin: 50px auto; padding: 20px; }
        .status { background: #d4edda; border: 1px solid #c3e6cb; padding: 20px; border-radius: 8px; margin: 20px 0; }
        .info { background: #d1ecf1; border: 1px solid #bee5eb; padding: 20px; border-radius: 8px; margin: 20px 0; }
        .config { background: #f8f9fa; border: 1px solid #dee2e6; padding: 20px; border-radius: 8px; margin: 20px 0; }
        code { background: #e9ecef; padding: 4px 8px; border-radius: 4px; font-family: 'Monaco', 'Menlo', monospace; }
        .highlight { background: #fff3cd; padding: 15px; border-radius: 5px; border-left: 4px solid #ffc107; }
        h1 { color: #2c3e50; }
        h3 { color: #34495e; margin-top: 0; }
      </style>
    </head>
    <body>
      <h1>🔄 Reverse Proxy với DNS Control</h1>
      
      <div class="status">
        <h3>✅ Proxy Status: Active</h3>
        <p><strong>Proxy Domain:</strong> <code>${PROXY_DOMAIN}</code></p>
        <p><strong>Origin Server:</strong> <code>${ORIGIN_PROTOCOL}://${ORIGIN_HOST}</code></p>
        <p><strong>SSL Certificate:</strong> Let's Encrypt (Valid)</p>
        <p><strong>Script Injection:</strong> Enabled</p>
      </div>
      
      <div class="info">
        <h3>🌐 Cách hoạt động</h3>
        <ol>
          <li><strong>DNS:</strong> ${PROXY_DOMAIN} → ${req.headers.host || 'EC2 IP'}</li>
          <li><strong>SSL:</strong> Browser → Reverse Proxy (Valid Cert)</li>
          <li><strong>Fetch:</strong> Reverse Proxy → ${ORIGIN_HOST} (Backend)</li>
          <li><strong>Inject:</strong> Modify HTML content + CSP headers</li>
          <li><strong>Response:</strong> Modified content → Browser</li>
        </ol>
      </div>
      
      <div class="config">
        <h3>🔧 DNS Configuration</h3>
        <p>Trong Cloudflare DNS cho <code>minhqnd.com</code>:</p>
        <pre><code>Type: A
Name: proxy
Content: ${req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'EC2-IP'}
TTL: Auto
Proxy: 🟠 (OFF - DNS Only)</code></pre>
      </div>
      
      <div class="highlight">
        <h3>🎯 Test URL</h3>
        <p>Sau khi setup DNS: <a href="https://${PROXY_DOMAIN}" target="_blank">https://${PROXY_DOMAIN}</a></p>
        <p>Sẽ hiển thị nội dung từ <code>${ORIGIN_HOST}</code> với script injection</p>
      </div>
      
      <div class="config">
        <h3>📋 Setup Checklist</h3>
        <ul>
          <li>☐ DNS: proxy.minhqnd.com → EC2 IP</li>
          <li>☐ SSL: Let's Encrypt certificate</li>
          <li>☐ Nginx: Reverse proxy to Node.js</li>
          <li>☐ PM2: Process management</li>
          <li>☐ Test: https://proxy.minhqnd.com</li>
        </ul>
      </div>
    </body>
    </html>
  `);
});

// Main reverse proxy handler
app.use(async (req, res) => {
  try {
    // Skip health check routes
    if (req.path === '/proxy-health' || req.path === '/proxy-status') {
      return;
    }

    // Build target URL
    const targetUrl = `${ORIGIN_PROTOCOL}://${ORIGIN_HOST}${req.originalUrl}`;
    
    console.log(`🔄 Reverse Proxy: ${req.method} ${req.headers.host}${req.originalUrl} → ${targetUrl}`);

    // Prepare headers for upstream request
    const outgoingHeaders = { ...req.headers };
    
    // Update host header to origin
    outgoingHeaders.host = ORIGIN_HOST;
    
    // Remove proxy-specific headers
    delete outgoingHeaders['x-forwarded-for'];
    delete outgoingHeaders['x-forwarded-proto'];
    delete outgoingHeaders['x-forwarded-host'];

    // Make request to origin server
    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers: outgoingHeaders,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : req.body,
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
    let isDecompressed = false;
    if (contentEncoding) {
      const { buffer: decompressed, success } = decompressIfNeeded(bodyBuf, contentEncoding);
      if (success) {
        bodyBuf = decompressed;
        isDecompressed = true;
        delete headers['content-encoding'];
      }
    }

    // Inject script into HTML content
    if (contentType.includes('text/html') && (isDecompressed || !contentEncoding)) {
      let bodyStr = bodyBuf.toString('utf8');
      const nonce = randomNonce(12);

      // Enhanced injection script
      const inlineContent = `(function(){
        try {
          // Styles cho injection button
          var css = \`.reverse-proxy-btn {
            position: fixed !important;
            top: 20px !important;
            right: 20px !important;
            z-index: 999999 !important;
            padding: 12px 16px !important;
            border-radius: 8px !important;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
            color: white !important;
            border: none !important;
            box-shadow: 0 8px 25px rgba(102, 126, 234, 0.3) !important;
            cursor: pointer !important;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif !important;
            font-size: 13px !important;
            font-weight: 600 !important;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
            text-shadow: 0 1px 2px rgba(0,0,0,0.1) !important;
            letter-spacing: 0.5px !important;
          }
          .reverse-proxy-btn:hover {
            transform: translateY(-2px) !important;
            box-shadow: 0 12px 35px rgba(102, 126, 234, 0.4) !important;
          }\`;
          
          // Inject styles
          var styleEl = document.createElement('style');
          styleEl.appendChild(document.createTextNode(css));
          document.head.appendChild(styleEl);
          
          // Create button
          var btn = document.createElement('button');
          btn.className = 'reverse-proxy-btn';
          btn.textContent = '🔄 Reverse Proxy Active';
          
          btn.addEventListener('click', function() {
            alert('🎉 Reverse Proxy Success!\\n\\n' +
                  '✅ DNS: ${PROXY_DOMAIN} → EC2\\n' +
                  '✅ SSL: Valid Let\\'s Encrypt Certificate\\n' +
                  '✅ Origin: Content from ${ORIGIN_HOST}\\n' +
                  '✅ Injection: Script successfully injected\\n\\n' +
                  '🔒 No certificate warnings!\\n' +
                  '🌐 Works on all browsers!');
          });
          
          // Add to page
          if (document.body) {
            document.body.appendChild(btn);
          } else {
            document.addEventListener('DOMContentLoaded', function() {
              document.body.appendChild(btn);
            });
          }
          
          // Console log for debugging
          console.log('🔄 Reverse proxy injection successful');
          console.log('📡 Proxy domain: ${PROXY_DOMAIN}');
          console.log('🎯 Origin server: ${ORIGIN_HOST}');
          
        } catch(e) {
          console.error('Reverse proxy injection error:', e);
        }
      })();`;

      const safeInline = `<script nonce="${nonce}">${inlineContent}</script>`;

      // Insert before closing body tag
      if (bodyStr.includes('</body>')) {
        bodyStr = bodyStr.replace('</body>', safeInline + '</body>');
      } else if (bodyStr.includes('</html>')) {
        bodyStr = bodyStr.replace('</html>', safeInline + '</html>');
      } else {
        bodyStr += safeInline;
      }

      bodyBuf = Buffer.from(bodyStr, 'utf8');
      
      // Update CSP header to allow nonce
      if (headers['content-security-policy']) {
        headers['content-security-policy'] = addNonceToCSP(headers['content-security-policy'], nonce);
      }
      
      console.log(`✅ Script injected into ${req.headers.host}${req.originalUrl}`);
    }

    // Update content-length if content was modified
    if (isDecompressed || contentType.includes('text/html')) {
      headers['content-length'] = Buffer.byteLength(bodyBuf);
    }

    // Remove hop-by-hop headers
    const hopByHop = [
      'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
      'te', 'trailer', 'transfer-encoding', 'upgrade'
    ];
    
    Object.keys(headers).forEach(k => {
      if (hopByHop.includes(k)) delete headers[k];
    });

    // Set security headers
    headers['x-content-type-options'] = 'nosniff';
    headers['x-frame-options'] = 'SAMEORIGIN';
    headers['x-xss-protection'] = '1; mode=block';

    // Set response headers
    Object.entries(headers).forEach(([k, v]) => {
      res.setHeader(k, v);
    });

    res.status(upstream.status);
    res.send(bodyBuf);

  } catch (err) {
    console.error('❌ Reverse proxy error:', err.message);
    res.status(502).json({
      error: 'Bad Gateway',
      message: 'Origin server unreachable',
      origin: `${ORIGIN_PROTOCOL}://${ORIGIN_HOST}`,
      timestamp: new Date().toISOString()
    });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Reverse Proxy Server running on port ${PORT}`);
  console.log(`🌐 Proxy Domain: ${PROXY_DOMAIN}`);
  console.log(`🎯 Origin Server: ${ORIGIN_PROTOCOL}://${ORIGIN_HOST}`);
  console.log(`📋 Status Page: http://localhost:${PORT}/proxy-status`);
  console.log(`💚 Health Check: http://localhost:${PORT}/proxy-health`);
  console.log('');
  console.log('📋 Next Steps:');
  console.log(`   1. Setup DNS: ${PROXY_DOMAIN} → EC2 IP`);
  console.log(`   2. Setup SSL: Let's Encrypt for ${PROXY_DOMAIN}`);
  console.log(`   3. Configure Nginx: Reverse proxy to :${PORT}`);
  console.log(`   4. Test: https://${PROXY_DOMAIN}`);
});

module.exports = app;