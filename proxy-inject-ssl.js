// proxy-inject-ssl.js
// Node.js proxy with built-in SSL support (alternative to Nginx)
const express = require('express');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { fetch } = require('undici');
const zlib = require('zlib');
const crypto = require('crypto');

const app = express();

// CONFIG
const TARGET_ORIGIN = 'https://minhqnd.com';
const HTTP_PORT = process.env.HTTP_PORT || 80;
const HTTPS_PORT = process.env.HTTPS_PORT || 443;
const NODE_ENV = process.env.NODE_ENV || 'development';

// SSL certificate paths (for production with real certs)
const SSL_KEY_PATH = process.env.SSL_KEY_PATH || '/etc/letsencrypt/live/proxy.minhqnd.com/privkey.pem';
const SSL_CERT_PATH = process.env.SSL_CERT_PATH || '/etc/letsencrypt/live/proxy.minhqnd.com/fullchain.pem';

// Same utility functions as before
function randomNonce(len = 12) {
  return crypto.randomBytes(len).toString('base64');
}

function decompressIfNeeded(buffer, encoding) {
  if (!encoding) return buffer;
  encoding = encoding.toLowerCase();
  try {
    if (encoding.includes('br')) return zlib.brotliDecompressSync(buffer);
    if (encoding.includes('gzip')) return zlib.gunzipSync(buffer);
    if (encoding.includes('deflate')) return zlib.inflateSync(buffer);
  } catch (e) {
    console.warn('Decompress failed:', e && e.message);
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

function patchMetaCSP(htmlContent, nonce) {
  const metaCSPRegex = /<meta\s+http-equiv\s*=\s*["']content-security-policy["']\s+content\s*=\s*["']([^"']+)["']\s*\/?>/gi;
  return htmlContent.replace(metaCSPRegex, (match, content) => {
    const updatedContent = addNonceToCSP(content, nonce);
    return match.replace(content, updatedContent);
  });
}

// Security headers middleware
app.use((req, res, next) => {
  // Security headers
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // HSTS for HTTPS
  if (req.secure) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  
  next();
});

// Redirect HTTP to HTTPS in production
app.use((req, res, next) => {
  if (NODE_ENV === 'production' && !req.secure && req.get('X-Forwarded-Proto') !== 'https') {
    return res.redirect(301, `https://${req.get('Host')}${req.url}`);
  }
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    target: TARGET_ORIGIN,
    uptime: process.uptime(),
    ssl: req.secure,
    version: '1.0.0'
  });
});

// Main proxy middleware (same as before)
app.use(async (req, res) => {
  try {
    if (req.path === '/health') return;

    const targetUrl = TARGET_ORIGIN + req.originalUrl;
    const outgoingHeaders = { ...req.headers };
    delete outgoingHeaders['accept-encoding'];

    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers: outgoingHeaders,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : req,
    });

    const headers = {};
    upstream.headers.forEach((v, k) => headers[k.toLowerCase()] = v);

    const arrayBuf = await upstream.arrayBuffer();
    let bodyBuf = Buffer.from(arrayBuf);

    const contentEncoding = headers['content-encoding'] || '';
    const contentType = (headers['content-type'] || '').toLowerCase();

    if (contentEncoding) {
      bodyBuf = decompressIfNeeded(bodyBuf, contentEncoding);
      delete headers['content-encoding'];
    }

    if (contentType.includes('text/html')) {
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

    delete headers['content-length'];
    headers['content-length'] = Buffer.byteLength(bodyBuf);

    const hopByHop = [
      'connection','keep-alive','proxy-authenticate','proxy-authorization',
      'te','trailer','transfer-encoding','upgrade'
    ];
    Object.keys(headers).forEach(k => {
      if (hopByHop.includes(k)) delete headers[k];
    });

    Object.entries(headers).forEach(([k, v]) => {
      res.setHeader(k, v);
    });

    res.status(upstream.status);
    res.send(bodyBuf);

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

// Start servers
function startServers() {
  // HTTP Server (redirect to HTTPS in production)
  const httpServer = http.createServer(app);
  httpServer.listen(HTTP_PORT, () => {
    console.log(`HTTP server listening on port ${HTTP_PORT}`);
    if (NODE_ENV === 'production') {
      console.log('HTTP server redirects to HTTPS');
    }
  });

  // HTTPS Server (if certificates are available)
  if (NODE_ENV === 'production' && fs.existsSync(SSL_KEY_PATH) && fs.existsSync(SSL_CERT_PATH)) {
    try {
      const httpsOptions = {
        key: fs.readFileSync(SSL_KEY_PATH),
        cert: fs.readFileSync(SSL_CERT_PATH)
      };

      const httpsServer = https.createServer(httpsOptions, app);
      httpsServer.listen(HTTPS_PORT, () => {
        console.log(`HTTPS server listening on port ${HTTPS_PORT}`);
        console.log(`SSL certificates loaded from:`);
        console.log(`  Key:  ${SSL_KEY_PATH}`);
        console.log(`  Cert: ${SSL_CERT_PATH}`);
      });
    } catch (err) {
      console.error('Failed to start HTTPS server:', err.message);
      console.log('Running HTTP only. Use Nginx for SSL termination or provide valid certificates.');
    }
  } else {
    console.log('HTTPS server not started (no certificates found or not in production mode)');
    console.log('For HTTPS: Set NODE_ENV=production and provide SSL certificate paths');
  }

  console.log(`Proxy injector forwarding to ${TARGET_ORIGIN}`);
  console.log(`Environment: ${NODE_ENV}`);
  console.log(`Health check: http://localhost:${HTTP_PORT}/health`);
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down gracefully');
  process.exit(0);
});

startServers();