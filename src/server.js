import express from 'express';
import morgan from 'morgan';
import { fetch } from 'undici';
import { load as loadHtml } from 'cheerio';
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib';
import crypto from 'node:crypto';

const PORT = Number(process.env.PORT || 3000);
const TARGET_ORIGIN = process.env.TARGET_ORIGIN || 'https://example.com';
const INJECTION_HTML = process.env.INJECTION_HTML || `
  <div id="content-proxy-banner" style="position:fixed;bottom:24px;right:24px;padding:16px 20px;background:#1f2937;color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;border-radius:12px;box-shadow:0 12px 32px rgba(31,41,55,.35);z-index:2147483647;">
    <strong>Content Proxy:</strong> This page is being managed by your company.
  </div>
`;

const app = express();
app.enable('trust proxy');
app.use(morgan('dev'));

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    targetOrigin: TARGET_ORIGIN,
    injectionEnabled: Boolean(INJECTION_HTML.trim()),
    timestamp: new Date().toISOString()
  });
});

function cloneHeaders(headers) {
  const cloned = {};
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      cloned[key] = value.join(', ');
    } else if (typeof value === 'string') {
      cloned[key] = value;
    }
  }
  return cloned;
}

function decompressBody(buffer, encoding) {
  if (!encoding) return { buffer, encodingRemoved: false };

  const normalized = encoding.toLowerCase();
  try {
    if (normalized.includes('br')) {
      return { buffer: brotliDecompressSync(buffer), encodingRemoved: true };
    }
    if (normalized.includes('gzip')) {
      return { buffer: gunzipSync(buffer), encodingRemoved: true };
    }
    if (normalized.includes('deflate')) {
      return { buffer: inflateSync(buffer), encodingRemoved: true };
    }
  } catch (error) {
    console.warn(`Failed to decompress response with encoding '${encoding}': ${error.message}`);
  }

  return { buffer, encodingRemoved: false };
}

function ensureNonceInCsp(cspValue, nonce) {
  if (!cspValue) {
    return `script-src 'self' 'nonce-${nonce}'; object-src 'none'; base-uri 'self'`;
  }

  const directives = cspValue
    .split(';')
    .map(part => part.trim())
    .filter(Boolean);

  let scriptIndex = directives.findIndex(d => d.startsWith('script-src'));
  if (scriptIndex === -1) {
    directives.push(`script-src 'self' 'nonce-${nonce}'`);
    return directives.join('; ');
  }

  const scriptDirective = directives[scriptIndex];
  if (scriptDirective.includes('nonce-')) {
    return cspValue;
  }

  directives[scriptIndex] = `${scriptDirective} 'nonce-${nonce}'`;
  return directives.join('; ');
}

app.use(async (req, res) => {
  const targetUrl = new URL(req.originalUrl || '/', TARGET_ORIGIN).toString();
  console.log(`Proxying ${req.method} ${req.originalUrl} -> ${targetUrl}`);

  try {
  const outgoingHeaders = cloneHeaders(req.headers);
  // Ensure the upstream gets the correct Host header
  outgoingHeaders.host = new URL(TARGET_ORIGIN).host;
  // Normalise compression negotiation so we can handle it consistently
  outgoingHeaders['accept-encoding'] = 'gzip, deflate, br';
  delete outgoingHeaders['content-length'];

    const upstreamResponse = await fetch(targetUrl, {
      method: req.method,
      headers: outgoingHeaders,
      // For GET/HEAD we do not forward a body
      body: ['GET', 'HEAD'].includes(req.method.toUpperCase()) ? undefined : req,
      redirect: 'manual',
      duplex: ['GET', 'HEAD'].includes(req.method.toUpperCase()) ? undefined : 'half'
    });

    const responseHeaders = {};
    upstreamResponse.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    const status = upstreamResponse.status;
    const contentType = responseHeaders['content-type'] || '';
    const contentEncoding = responseHeaders['content-encoding'];

    const arrayBuffer = await upstreamResponse.arrayBuffer();
    let bodyBuffer = Buffer.from(arrayBuffer);
    let encodingRemoved = false;

    if (contentEncoding) {
      const result = decompressBody(bodyBuffer, contentEncoding);
      bodyBuffer = result.buffer;
      encodingRemoved = result.encodingRemoved;
    }

    if (contentType.includes('text/html') && INJECTION_HTML.trim().length > 0) {
  const html = bodyBuffer.toString('utf8');
  const $ = loadHtml(html, { decodeEntities: false });

      // Ensure body exists before injecting
      if ($('body').length === 0) {
        $('html').append('<body></body>');
      }

      $('body').append(INJECTION_HTML);

      const nonce = crypto.randomBytes(12).toString('base64');
      const script = `document.body.dataset.proxyInjected = 'true';`;
      $('body').append(`<script nonce="${nonce}">${script}</script>`);

      if (responseHeaders['content-security-policy']) {
        responseHeaders['content-security-policy'] = ensureNonceInCsp(
          responseHeaders['content-security-policy'],
          nonce
        );
      } else {
        responseHeaders['content-security-policy'] = `script-src 'self' 'nonce-${nonce}'; object-src 'none'; base-uri 'self'`;
      }

      bodyBuffer = Buffer.from($.html());
      responseHeaders['content-length'] = Buffer.byteLength(bodyBuffer).toString();
      delete responseHeaders['content-encoding'];
    } else if (encodingRemoved) {
      // If we decompressed but did not re-encode
      responseHeaders['content-length'] = Buffer.byteLength(bodyBuffer).toString();
      delete responseHeaders['content-encoding'];
    }

    // Remove hop-by-hop headers per RFC 7230 section 6.1
    ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'].forEach(header => {
      delete responseHeaders[header];
    });

    for (const [key, value] of Object.entries(responseHeaders)) {
      if (typeof value !== 'undefined') {
        res.setHeader(key, value);
      }
    }

    res.status(status);

    if (['HEAD'].includes(req.method.toUpperCase())) {
      res.end();
    } else {
      res.send(bodyBuffer);
    }
  } catch (error) {
    console.error('Proxy error:', error);
    res.status(502).json({
      error: 'Bad Gateway',
      message: error.message,
      target: targetUrl
    });
  }
});

app.listen(PORT, () => {
  console.log(`Content proxy listening on port ${PORT}`);
  console.log(`Forwarding requests to ${TARGET_ORIGIN}`);
});
