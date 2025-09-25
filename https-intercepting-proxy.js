// https-intercepting-proxy.js
// HTTP proxy với khả năng intercept và inject vào HTTPS
const express = require('express');
const http = require('http');
const https = require('https');
const net = require('net');
const tls = require('tls');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
const { fetch } = require('undici');
const zlib = require('zlib');

const app = express();

// CONFIG
const PORT = process.env.PORT || 8080;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Domains to inject script into
const INJECT_DOMAINS = ['example.com', 'httpbin.org', 'minhqnd.com'];

// Domains to intercept HTTPS (cần cẩn thận!)
const INTERCEPT_HTTPS_DOMAINS = ['example.com'];

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

// Tạo self-signed certificate cho domain
function generateCertForDomain(domain) {
  const certDir = path.join(__dirname, 'certs');
  if (!fs.existsSync(certDir)) {
    fs.mkdirSync(certDir, { recursive: true });
  }
  
  const certPath = path.join(certDir, `${domain}.crt`);
  const keyPath = path.join(certDir, `${domain}.key`);
  
  // Kiểm tra certificate đã tồn tại
  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    return {
      cert: fs.readFileSync(certPath),
      key: fs.readFileSync(keyPath)
    };
  }
  
  // Tạo certificate mới (cần openssl)
  const { execSync } = require('child_process');
  
  try {
    // Tạo private key
    execSync(`openssl genrsa -out "${keyPath}" 2048`, { stdio: 'pipe' });
    
    // Tạo certificate
    const subj = `/C=VN/ST=HCM/L=HCM/O=Dev/CN=${domain}`;
    execSync(`openssl req -new -x509 -key "${keyPath}" -out "${certPath}" -days 365 -subj "${subj}"`, { stdio: 'pipe' });
    
    return {
      cert: fs.readFileSync(certPath),
      key: fs.readFileSync(keyPath)
    };
  } catch (error) {
    console.error(`❌ Không thể tạo certificate cho ${domain}:`, error.message);
    console.log(`💡 Cài đặt OpenSSL: brew install openssl (macOS) hoặc apt-get install openssl (Ubuntu)`);
    return null;
  }
}

// Health check
app.get('/proxy-health', (req, res) => {
  res.json({
    status: 'healthy',
    type: 'https-intercepting-proxy',
    port: PORT,
    supports: ['HTTP', 'HTTPS', 'HTTPS-Interception'],
    inject_domains: INJECT_DOMAINS,
    intercept_https_domains: INTERCEPT_HTTPS_DOMAINS,
    timestamp: new Date().toISOString()
  });
});

// Status page
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>HTTPS Intercepting Proxy</title>
      <style>
        body { font-family: Arial, sans-serif; max-width: 900px; margin: 50px auto; padding: 20px; }
        .status { background: #d4edda; border: 1px solid #c3e6cb; padding: 15px; border-radius: 5px; }
        .warning { background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 5px; margin: 20px 0; }
        .config { background: #f8f9fa; border: 1px solid #dee2e6; padding: 15px; border-radius: 5px; margin: 20px 0; }
        code { background: #e9ecef; padding: 2px 5px; border-radius: 3px; }
        .danger { color: #721c24; }
      </style>
    </head>
    <body>
      <h1>🔒 HTTPS Intercepting Proxy</h1>
      
      <div class="warning">
        <h3>⚠️ Cảnh báo bảo mật</h3>
        <p class="danger">Proxy này có thể intercept HTTPS traffic. Chỉ sử dụng cho development!</p>
        <ul>
          <li>Browser sẽ hiện certificate warnings</li>
          <li>Cần import root certificate để tránh warnings</li>
          <li>Không dùng cho production traffic</li>
        </ul>
      </div>
      
      <div class="status">
        <h3>✅ Proxy Status: Running</h3>
        <p><strong>Port:</strong> ${PORT}</p>
        <p><strong>Supports:</strong> HTTP + HTTPS + HTTPS Interception</p>
        <p><strong>Inject Domains:</strong> ${INJECT_DOMAINS.join(', ')}</p>
        <p><strong>HTTPS Intercept:</strong> ${INTERCEPT_HTTPS_DOMAINS.join(', ')}</p>
      </div>
      
      <div class="config">
        <h3>🔧 Browser Configuration</h3>
        <p>Set proxy to: <code>host.minhqnd.com:${PORT}</code></p>
        <p>Certificate warnings là bình thường khi test HTTPS interception.</p>
      </div>

      <div class="config">
        <h3>🧪 Test URLs</h3>
        <ul>
          <li><a href="http://example.com" target="_blank">http://example.com</a> (HTTP injection)</li>
          <li><a href="https://example.com" target="_blank">https://example.com</a> (HTTPS interception + injection)</li>
        </ul>
      </div>
    </body>
    </html>
  `);
});

// HTTP proxy handler (giống như cũ)
app.use(async (req, res) => {
  try {
    if (req.path === '/proxy-health' || req.path === '/') return;

    const targetUrl = req.url.startsWith('http://') || req.url.startsWith('https://') 
      ? req.url 
      : 'http://' + req.headers.host + req.url;

    const parsedUrl = new URL(targetUrl);
    const targetHost = parsedUrl.hostname;

    console.log(`📤 HTTP Proxy: ${req.method} ${targetUrl}`);

    const outgoingHeaders = { ...req.headers };
    delete outgoingHeaders['proxy-connection'];
    delete outgoingHeaders['proxy-authorization'];
    outgoingHeaders.host = targetHost;

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

    let isDecompressed = false;
    if (contentEncoding) {
      const decompressed = decompressIfNeeded(bodyBuf, contentEncoding);
      if (decompressed !== bodyBuf) {
        bodyBuf = decompressed;
        isDecompressed = true;
        delete headers['content-encoding'];
      }
    }

    // Inject script
    const shouldInject = INJECT_DOMAINS.some(domain => targetHost.includes(domain));
    
    if (shouldInject && contentType.includes('text/html') && (isDecompressed || !contentEncoding)) {
      let bodyStr = bodyBuf.toString('utf8');
      const nonce = randomNonce(12);

      const inlineContent = `(function(){try{var css=".https-proxy-btn{position:fixed;right:20px;bottom:20px;z-index:999999;padding:12px 16px;border-radius:8px;background:#dc3545;color:white;border:none;box-shadow:0 6px 16px rgba(220,53,69,0.3);cursor:pointer;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:14px;font-weight:600;transition:all 0.2s ease}";var s=document.createElement('style');s.appendChild(document.createTextNode(css));document.head.appendChild(s);var btn=document.createElement('button');btn.className='https-proxy-btn';btn.textContent='🔒 HTTPS Intercepted: ${targetHost}';btn.addEventListener('click',function(){alert('HTTPS đã được intercept!\\nDomain: ${targetHost}\\nProxy: host.minhqnd.com\\n\\n⚠️ Chỉ dùng cho development!');});document.body.appendChild(btn);}catch(e){console.error('HTTPS injection error:',e);} })();`;

      const safeInline = `<script nonce="${nonce}">${inlineContent}</script>`;

      if (bodyStr.includes('</body>')) {
        bodyStr = bodyStr.replace('</body>', safeInline + '</body>');
      } else {
        bodyStr += safeInline;
      }

      bodyBuf = Buffer.from(bodyStr, 'utf8');
      headers['content-security-policy'] = addNonceToCSP(headers['content-security-policy'], nonce);
      
      console.log(`🔒 Injected script into HTTPS ${targetHost}`);
    }

    if (isDecompressed || shouldInject) {
      headers['content-length'] = Buffer.byteLength(bodyBuf);
    }

    // Remove hop-by-hop headers
    const hopByHop = ['connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade'];
    Object.keys(headers).forEach(k => {
      if (hopByHop.includes(k)) delete headers[k];
    });

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

// Handle HTTPS CONNECT method
server.on('connect', (req, clientSocket, head) => {
  const targetUrl = new URL(`http://${req.url}`);
  const targetHost = targetUrl.hostname;
  const targetPort = targetUrl.port || 443;

  console.log(`🔐 HTTPS CONNECT: ${targetHost}:${targetPort}`);

  // Kiểm tra có cần intercept không
  const shouldIntercept = INTERCEPT_HTTPS_DOMAINS.some(domain => targetHost.includes(domain));

  if (shouldIntercept) {
    console.log(`🕵️ Intercepting HTTPS for ${targetHost}`);
    
    // Tạo certificate cho domain này
    const cert = generateCertForDomain(targetHost);
    if (!cert) {
      console.error(`❌ Cannot create certificate for ${targetHost}`);
      clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      return;
    }

    // Tạo HTTPS server tạm thời
    const httpsOptions = {
      key: cert.key,
      cert: cert.cert,
      SNICallback: (domain, callback) => {
        callback(null, tls.createSecureContext(cert));
      }
    };

    // Tell client connection established
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');

    // Tạo TLS connection với client
    const tlsSocket = new tls.TLSSocket(clientSocket, {
      isServer: true,
      ...httpsOptions
    });

    // Handle HTTPS requests từ client
    const httpsServer = https.createServer(httpsOptions, app);
    httpsServer.emit('connection', tlsSocket);

  } else {
    // Normal CONNECT tunnel (không intercept)
    const serverSocket = net.connect(targetPort, targetHost, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      serverSocket.write(head);
      serverSocket.pipe(clientSocket);
      clientSocket.pipe(serverSocket);
    });

    serverSocket.on('error', (err) => {
      console.error(`❌ CONNECT error to ${targetHost}:${targetPort}:`, err.message);
      clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
    });

    clientSocket.on('error', (err) => {
      console.error('❌ Client socket error:', err.message);
      serverSocket.end();
    });
  }
});

// Start server
server.listen(PORT, () => {
  console.log(`🚀 HTTPS Intercepting Proxy running on port ${PORT}`);
  console.log(`📋 Supports: HTTP + HTTPS + HTTPS Interception`);
  console.log(`💉 Script injection: ${INJECT_DOMAINS.join(', ')}`);
  console.log(`🔒 HTTPS interception: ${INTERCEPT_HTTPS_DOMAINS.join(', ')}`);
  console.log(`🔗 Status: http://localhost:${PORT}/`);
  console.log(`⚠️  Certificate warnings là bình thường cho HTTPS interception`);
});

module.exports = server;