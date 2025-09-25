// proxy-generic.js
// Generic proxy server that can proxy to any domain
const express = require('express');
const { fetch } = require('undici');
const zlib = require('zlib');
const crypto = require('crypto');
const { URL } = require('url');

const app = express();

// CONFIG
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Domains to inject script into (customize this)
const INJECT_DOMAINS = ['minhqnd.com', 'www.minhqnd.com'];

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

// Health check
app.get('/proxy-health', (req, res) => {
  res.json({
    status: 'healthy',
    type: 'generic-proxy',
    inject_domains: INJECT_DOMAINS,
    timestamp: new Date().toISOString()
  });
});

// Generic proxy middleware
app.use(async (req, res) => {
  try {
    if (req.path === '/proxy-health') return;

    // Build target URL from request
    let targetUrl;
    if (req.headers['proxy-target']) {
      // Custom header to specify target
      targetUrl = req.headers['proxy-target'] + req.originalUrl;
    } else {
      // Default to minhqnd.com
      targetUrl = 'https://minhqnd.com' + req.originalUrl;
    }

    const parsedUrl = new URL(targetUrl);
    const targetHost = parsedUrl.hostname;

    console.log(`Proxying: ${req.method} ${targetUrl}`);

    const outgoingHeaders = { ...req.headers };
    delete outgoingHeaders['proxy-target'];
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
      const { buffer: decompressed, success } = decompressIfNeeded(bodyBuf, contentEncoding);
      if (success) {
        bodyBuf = decompressed;
        isDecompressed = true;
        delete headers['content-encoding'];
      }
    }

    // Inject script only for specified domains
    const shouldInject = INJECT_DOMAINS.some(domain => targetHost.includes(domain));
    
    if (shouldInject && contentType.includes('text/html') && (isDecompressed || !contentEncoding)) {
      let bodyStr = bodyBuf.toString('utf8');
      const nonce = randomNonce(12);

      const inlineContent = `(function(){try{var css=".my-inject-btn{position:fixed;right:20px;bottom:20px;z-index:999999;padding:10px 14px;border-radius:8px;background:#0b74de;color:white;border:none;box-shadow:0 6px 14px rgba(11,116,222,0.25);cursor:pointer;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:500;transition:all 0.2s ease;transform:translateZ(0)}";var s=document.createElement('style');s.appendChild(document.createTextNode(css));document.head.appendChild(s);var btn=document.createElement('button');btn.className='my-inject-btn';btn.id='minhqnd-inject-btn';btn.textContent='Proxied!';btn.addEventListener('click',function(){alert('Hello from proxy: ${targetHost}');});document.body.appendChild(btn);}catch(e){console.error('injection error',e);} })();`;

      const safeInline = `<script nonce="${nonce}">${inlineContent}</script>`;

      if (bodyStr.includes('</body>')) {
        bodyStr = bodyStr.replace('</body>', safeInline + '</body>');
      } else {
        bodyStr += safeInline;
      }

      bodyBuf = Buffer.from(bodyStr, 'utf8');
      headers['content-security-policy'] = addNonceToCSP(headers['content-security-policy'], nonce);
    }

    if (isDecompressed || shouldInject) {
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

    Object.entries(headers).forEach(([k, v]) => {
      res.setHeader(k, v);
    });

    res.status(upstream.status);
    res.send(bodyBuf);

  } catch (err) {
    console.error('Proxy error:', err.message);
    res.status(502).json({
      error: 'Bad gateway',
      message: err.message,
      target: req.headers['proxy-target'] || 'https://minhqnd.com'
    });
  }
});

app.listen(PORT, () => {
  console.log(`Generic proxy server listening on ${PORT}`);
  console.log(`Script injection enabled for: ${INJECT_DOMAINS.join(', ')}`);
  console.log(`Health check: http://localhost:${PORT}/proxy-health`);
});
