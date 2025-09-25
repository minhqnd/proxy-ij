#!/usr/bin/env python3

import os
import re
from mitmproxy import http
from mitmproxy import ctx
from bs4 import BeautifulSoup

# Configuration from environment variables
INJECT_SELECTOR = os.getenv('INJECT_SELECTOR', 'body')
INJECT_HTML = os.getenv('INJECT_HTML', '<div style="position:fixed;bottom:16px;right:16px;z-index:2147483647;padding:12px 16px;background:#111;color:#fff;border-radius:8px;font-family:sans-serif;font-size:14px;box-shadow:0 6px 16px rgba(0,0,0,0.35);">Injected by MITMProxy</div>')
INJECT_SCRIPT = os.getenv('INJECT_SCRIPT', '')
RAW_DOMAINS = os.getenv('INTERCEPT_DOMAINS', 'example.com')
DOMAINS = [d.strip().lower() for d in RAW_DOMAINS.split(',') if d.strip()]
SHOULD_INJECT_EVERYWHERE = len(DOMAINS) == 0
DOMAIN_SET = set(DOMAINS)

class Injector:
    def __init__(self):
        self.nonce_pattern = re.compile(r'<script[^>]*nonce="([^"]*)"[^>]*>', re.IGNORECASE)

    def load(self, loader):
        loader.add_option(
            name="inject_domains",
            typespec=str,
            default=RAW_DOMAINS,
            help="Comma-separated list of domains to inject into"
        )

    def response(self, flow: http.HTTPFlow) -> None:
        if not flow.response or not flow.response.content:
            return

        hostname = flow.request.host.lower()
        if not SHOULD_INJECT_EVERYWHERE and hostname not in DOMAIN_SET:
            return

        content_type = flow.response.headers.get('content-type', '').lower()
        if 'text/html' not in content_type:
            return

        try:
            html = flow.response.content.decode('utf-8', errors='ignore')
            modified_html = self.inject_content(html, hostname)
            flow.response.content = modified_html.encode('utf-8')
            flow.response.headers['content-length'] = str(len(flow.response.content))

            ctx.log.info(f"Injected content into {hostname}")
        except Exception as e:
            ctx.log.error(f"Error injecting into {hostname}: {e}")

    def inject_content(self, html: str, hostname: str) -> str:
        soup = BeautifulSoup(html, 'html.parser')

        # Ensure CSP allows inline scripts with nonce
        self.update_csp(soup)

        # Inject HTML
        selector = soup.select_one(INJECT_SELECTOR)
        if selector:
            selector.append(BeautifulSoup(INJECT_HTML, 'html.parser'))
        else:
            if soup.body:
                soup.body.append(BeautifulSoup(INJECT_HTML, 'html.parser'))

        # Inject script if provided
        if INJECT_SCRIPT.strip():
            nonce = self.extract_nonce(soup)
            script_tag = soup.new_tag('script', nonce=nonce, **{'data-injected': 'mitmproxy'})
            script_tag.string = INJECT_SCRIPT
            if soup.body:
                soup.body.append(script_tag)

        # Add meta tag for tracking
        meta_tag = soup.new_tag('div', style='display:none!important', **{'data-proxy-meta': 'injected', 'data-host': hostname})
        if soup.body:
            soup.body.append(meta_tag)

        return str(soup)

    def update_csp(self, soup):
        meta_csp = soup.find('meta', attrs={'http-equiv': 'Content-Security-Policy'})
        if not meta_csp:
            return

        csp = meta_csp.get('content', '')
        if not csp:
            return

        # Add 'nonce-{random}' to script-src if not present
        import secrets
        nonce = secrets.token_hex(16)
        if 'script-src' in csp and "'unsafe-inline'" not in csp:
            csp = re.sub(r"(script-src[^;]*)", rf"\1 'nonce-{nonce}'", csp)
        elif 'script-src' not in csp:
            csp += f" script-src 'self' 'nonce-{nonce}';"

        meta_csp['content'] = csp

    def extract_nonce(self, soup) -> str:
        scripts = soup.find_all('script', nonce=True)
        if scripts:
            return scripts[0]['nonce']
        import secrets
        return secrets.token_hex(16)

addons = [Injector()]