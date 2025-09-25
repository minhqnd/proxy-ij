import httpMitmProxy from 'http-mitm-proxy';
import express from 'express';
import morgan from 'morgan';
import { load } from 'cheerio';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

const PROXY_PORT = Number.parseInt(process.env.PROXY_PORT ?? '8080', 10);
const STATUS_PORT = Number.parseInt(process.env.STATUS_PORT ?? '9090', 10);
const INJECT_SELECTOR = process.env.INJECT_SELECTOR ?? 'body';
const INJECT_HTML = process.env.INJECT_HTML ??
  '<div style="position:fixed;bottom:16px;right:16px;z-index:2147483647;padding:12px 16px;background:#111;color:#fff;border-radius:8px;font-family:sans-serif;font-size:14px;box-shadow:0 6px 16px rgba(0,0,0,0.35);">Injected by HTTPS interceptor proxy</div>';
const INJECT_SCRIPT = process.env.INJECT_SCRIPT ?? '';
const RAW_DOMAINS = process.env.INTERCEPT_DOMAINS ?? 'example.com';
const DOMAINS = RAW_DOMAINS.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
const SHOULD_INJECT_EVERYWHERE = DOMAINS.length === 0;
const DOMAIN_SET = new Set(DOMAINS);
const DEFAULT_CA_PATH = path.join(os.homedir(), '.http-mitm-proxy', 'certs', 'ca.pem');

const proxy = new httpMitmProxy.Proxy();

proxy.onError((ctx, err) => {
  const request = ctx?.clientToProxyRequest;
  const target = request?.headers?.host ?? 'unknown-host';
  console.error(`[proxy:error] ${target} ${err.message}`);
});

proxy.onConnect((req, socket, head, callback) => {
  const host = req.url ?? 'unknown-host';
  console.log(`[proxy:connect] Establishing tunnel for ${host}`);
  return callback();
});

proxy.onRequest((ctx, callback) => {
  const hostHeader = ctx.clientToProxyRequest?.headers?.host ?? '';
  const hostname = hostHeader.split(':')[0]?.toLowerCase();
  const shouldInject = SHOULD_INJECT_EVERYWHERE || DOMAIN_SET.has(hostname);

  if (!shouldInject) {
    return callback();
  }

  ctx.use(Proxy.gunzip);
  ctx.state = ctx.state ?? {};
  ctx.state.hostname = hostname;
  ctx.state.nonce = crypto.randomBytes(16).toString('base64');

  const chunks = [];

  ctx.onResponseData((ctxWithData, chunk, done) => {
    chunks.push(Buffer.from(chunk));
    return done(null, null);
  });

  ctx.onResponseEnd((ctxWithData, done) => {
    const response = ctxWithData.serverToProxyResponse;
    const headers = { ...response.headers };
    const statusCode = response.statusCode ?? 200;

    const contentType = (headers['content-type'] ?? headers['Content-Type'] ?? '').toString();
    const isHtml = contentType.toLowerCase().includes('text/html');

    try {
      if (!isHtml) {
        forwardResponse(ctxWithData, Buffer.concat(chunks), { headers, statusCode });
        return done();
      }

      const originalHtml = Buffer.concat(chunks).toString('utf8');
      const modifiedHtml = transformHtml(originalHtml, ctx.state.nonce, hostname);
      const buffer = Buffer.from(modifiedHtml, 'utf8');
      const modifiedHeaders = modifyHeaders(headers, buffer.length, ctx.state.nonce);
      forwardResponse(ctxWithData, buffer, { headers: modifiedHeaders, statusCode });
    } catch (error) {
      console.error(`[proxy:inject-error] ${hostname} ${error.message}`);
      forwardResponse(ctxWithData, Buffer.concat(chunks), { headers, statusCode });
    }

    return done();
  });

  return callback();
});

proxy.listen({ port: PROXY_PORT }, () => {
  console.log(`HTTPS intercepting proxy listening on port ${PROXY_PORT}`);
  console.log(`Root CA certificate (install on clients): ${DEFAULT_CA_PATH}`);
  if (!SHOULD_INJECT_EVERYWHERE) {
    console.log(`Domains with HTML injection: ${Array.from(DOMAIN_SET).join(', ')}`);
  } else {
    console.log('Injecting into every domain (INTERCEPT_DOMAINS not set).');
  }
});

const managementApp = express();
managementApp.use(morgan('combined'));
managementApp.get('/status', (_req, res) => {
  res.json({
    status: 'ok',
    proxyPort: PROXY_PORT,
    domains: SHOULD_INJECT_EVERYWHERE ? 'ALL' : Array.from(DOMAIN_SET),
    selector: INJECT_SELECTOR,
    hasScript: Boolean(INJECT_SCRIPT.trim()),
    caCertificatePath: DEFAULT_CA_PATH
  });
});

managementApp.listen(STATUS_PORT, () => {
  console.log(`Management endpoint available at http://localhost:${STATUS_PORT}/status`);
});

function forwardResponse(ctx, bodyBuffer, options) {
  const { headers, statusCode } = options;
  ctx.proxyToClientResponse.writeHead(statusCode, headers);
  ctx.proxyToClientResponse.end(bodyBuffer);
}

function transformHtml(html, nonce, hostname) {
  const $ = load(html, { decodeEntities: false });
  const selectorTarget = $(INJECT_SELECTOR);
  const nonceValue = nonce ?? crypto.randomBytes(16).toString('base64');

  ensureNonceInCsp($, nonceValue);

  if (selectorTarget.length === 0) {
    $('body').append(INJECT_HTML);
  } else {
    selectorTarget.first().append(INJECT_HTML);
  }

  if (INJECT_SCRIPT.trim().length > 0) {
    $('body').append(`<script nonce="${nonceValue}" data-injected="proxy">${INJECT_SCRIPT}</script>`);
  }

  $('body').append(`<div style="display:none!important" data-proxy-meta="injected" data-host="${hostname}"></div>`);

  return $.html();
}

function modifyHeaders(headers, contentLength, nonce) {
  const result = { ...headers };
  delete result['content-encoding'];
  delete result['Content-Encoding'];
  result['content-length'] = contentLength;
  result['Content-Length'] = contentLength;

  const cspHeaderKey = getCspHeaderKey(result);
  if (cspHeaderKey) {
    const headerValue = result[cspHeaderKey];
    result[cspHeaderKey] = ensureNonceInCspHeader(headerValue, nonce);
  }

  return result;
}

function ensureNonceInCsp(document, nonce) {
  const cspHeader = document('meta[http-equiv="Content-Security-Policy"]').attr('content');
  if (!cspHeader) {
    return;
  }
  const updated = ensureNonceInCspHeader(cspHeader, nonce);
  document('meta[http-equiv="Content-Security-Policy"]').attr('content', updated);
}

function ensureNonceInCspHeader(headerValue, nonce) {
  if (!headerValue) {
    return headerValue;
  }

  if (!/script-src/i.test(headerValue)) {
    return `${headerValue.trim()} script-src 'self' 'nonce-${nonce}';`;
  }

  if (headerValue.includes(`'nonce-${nonce}'`)) {
    return headerValue;
  }

  return headerValue.replace(/(script-src[^;]*)/i, (match) => {
    if (match.includes(`'unsafe-inline'`)) {
      return `${match}`;
    }
    return `${match} 'nonce-${nonce}'`;
  });
}

function getCspHeaderKey(headers) {
  const lower = Object.keys(headers).find((key) => key.toLowerCase() === 'content-security-policy');
  return lower;
}
