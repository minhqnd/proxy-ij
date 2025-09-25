// http-proxy-server-full.js
// Complete HTTP proxy server với hỗ trợ cả HTTP và HTTPS CONNECT
const express = require('express');
const http = require('http');
const net = require('net');
const { URL } = require('url');
const { fetch } = require('undici');
const zlib = require('zlib');
const crypto = require('crypto');

const app = express();

// CONFIG
const PORT = process.env.PORT || 8080;
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

// Health check
app.get('/proxy-health', (req, res) => {
  res.json({
    status: 'healthy',
    type: 'http-proxy-server-full',
    port: PORT,
    supports: ['HTTP', 'HTTPS'],
    inject_domains: INJECT_DOMAINS,
    timestamp: new Date().toISOString()
  });
});

// Status page
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Full HTTP Proxy Server</title>
      <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; }
        .status { background: #d4edda; border: 1px solid #c3e6cb; padding: 15px; border-radius: 5px; }
        .config { background: #f8f9fa; border: 1px solid #dee2e6; padding: 15px; border-radius: 5px; margin: 20px 0; }
        code { background: #e9ecef; padding: 2px 5px; border-radius: 3px; }
      </style>
    </head>
    <body>
      <h1>🔄 Full HTTP Proxy Server</h1>
      <div class="status">
        <h3>✅ Proxy Status: Running</h3>
        <p><strong>Port:</strong> ${PORT}</p>
        <p><strong>Supports:</strong> HTTP + HTTPS (CONNECT)</p>
        <p><strong>Injection Domains:</strong> ${INJECT_DOMAINS.join(', ')}</p>
      </div>
      
      <div class="config">
        <h3>🔧 Browser Configuration</h3>
        <p>Set your browser's proxy to:</p>
        <p><strong>HTTP Proxy:</strong> <code>host.minhqnd.com:${PORT}</code></p>
        <p><strong>HTTPS Proxy:</strong> <code>host.minhqnd.com:${PORT}</code></p>
      </div>

      <div class="config">
        <h3>🧪 Test URLs</h3>
        <ul>
          <li><a href="http://example.com" target="_blank">http://example.com</a></li>
          <li><a href="https://example.com" target="_blank">https://example.com</a></li>
          <li><a href="http://httpbin.org/ip" target="_blank">http://httpbin.org/ip</a></li>
          <li><a href="https://httpbin.org/ip" target="_blank">https://httpbin.org/ip</a></li>
        </ul>
      </div>
    </body>
    </html>
  `);
});

// HTTP proxy handler
app.use(async (req, res) => {
  try {
    if (req.path === '/proxy-health' || req.path === '/') return;

    // Parse target URL from proxy request
    const targetUrl = req.url.startsWith('http://') || req.url.startsWith('https://') 
      ? req.url 
      : 'http://' + req.headers.host + req.url;

    const parsedUrl = new URL(targetUrl);
    const targetHost = parsedUrl.hostname;

    console.log(`📤 HTTP Proxy: ${req.method} ${targetUrl}`);

    // Prepare outgoing headers
    const outgoingHeaders = { ...req.headers };
    delete outgoingHeaders['proxy-connection'];
    delete outgoingHeaders['proxy-authorization'];
    outgoingHeaders.host = targetHost;

    // Make request
    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers: outgoingHeaders,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : req,
    });

    // Get response headers
    const headers = {};
    upstream.headers.forEach((v, k) => headers[k.toLowerCase()] = v);

    // Get body
    const arrayBuf = await upstream.arrayBuffer();
    let bodyBuf = Buffer.from(arrayBuf);

    // Handle compression
    const contentEncoding = headers['content-encoding'];
    const contentType = (headers['content-type'] || '').toLowerCase();

    let isDecompressed = false;
    if (contentEncoding) {
      const decompressed = decompressIfNeeded(bodyBuf, contentEncoding);
      if (decompressed !== bodyBuf) {
        bodyBuf = decompressed;
        isDecompressed = true;
        delete headers['content-encoding'];
      }
    }

    // Inject script for specified domains
    const shouldInject = INJECT_DOMAINS.some(domain => targetHost.includes(domain));
    
    if (shouldInject && contentType.includes('text/html') && (isDecompressed || !contentEncoding)) {
      let bodyStr = bodyBuf.toString('utf8');
      const nonce = randomNonce(12);

      const inlineContent = `(function(){try{var css=".proxy-inject-btn{position:fixed;right:20px;bottom:20px;z-index:999999;padding:12px 16px;border-radius:8px;background:#28a745;color:white;border:none;box-shadow:0 6px 16px rgba(40,167,69,0.3);cursor:pointer;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:14px;font-weight:600;transition:all 0.2s ease}";var s=document.createElement('style');s.appendChild(document.createTextNode(css));document.head.appendChild(s);var btn=document.createElement('button');btn.className='proxy-inject-btn';btn.textContent='🔄 Proxied via ' + '${targetHost}';btn.addEventListener('click',function(){alert('Trang này được proxy qua: ${targetHost}\\nIP Server: host.minhqnd.com');});document.body.appendChild(btn);}catch(e){console.error('Proxy injection error:',e);} })();`;

      const safeInline = `<script nonce="${nonce}">${inlineContent}</script>`;

      if (bodyStr.includes('</body>')) {
        bodyStr = bodyStr.replace('</body>', safeInline + '</body>');
      } else {
        bodyStr += safeInline;
      }

      bodyBuf = Buffer.from(bodyStr, 'utf8');
      headers['content-security-policy'] = addNonceToCSP(headers['content-security-policy'], nonce);
      
      console.log(`✅ Injected script into ${targetHost}`);
    }

    // Update content-length if needed
    if (isDecompressed || shouldInject) {
      headers['content-length'] = Buffer.byteLength(bodyBuf);
    }

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
    console.error('❌ HTTP Proxy error:', err.message);
    res.status(502).json({
      error: 'Bad gateway',
      message: err.message,
      target: req.url
    });
  }
});

// Create HTTP server
const server = http.createServer(app);

// Handle HTTPS CONNECT method for tunneling
server.on('connect', (req, clientSocket, head) => {
  const targetUrl = new URL(`http://${req.url}`);
  const targetHost = targetUrl.hostname;
  const targetPort = targetUrl.port || 443;

  console.log(`🔐 HTTPS CONNECT: ${targetHost}:${targetPort}`);

  // Connect to target server
  const serverSocket = net.connect(targetPort, targetHost, () => {
    // Tell client connection established
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    
    // Pipe data between client and server
    serverSocket.write(head);
    serverSocket.pipe(clientSocket);
    clientSocket.pipe(serverSocket);
  });

  // Handle errors
  serverSocket.on('error', (err) => {
    console.error(`❌ CONNECT error to ${targetHost}:${targetPort}:`, err.message);
    clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
  });

  clientSocket.on('error', (err) => {
    console.error('❌ Client socket error:', err.message);
    serverSocket.end();
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`🚀 Full HTTP Proxy Server running on port ${PORT}`);
  console.log(`📋 Supports: HTTP requests + HTTPS CONNECT tunneling`);
  console.log(`💉 Script injection enabled for: ${INJECT_DOMAINS.join(', ')}`);
  console.log(`🔗 Status page: http://localhost:${PORT}/`);
  console.log(`💚 Health check: http://localhost:${PORT}/proxy-health`);
});

module.exports = server;