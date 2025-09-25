#!/usr/bin/env python3
"""
Mitmproxy addon: inject HTML/snippet + inline script with nonce, update CSP header/meta safely.
Dependencies: mitmproxy, beautifulsoup4
"""

import os
import secrets
from bs4 import BeautifulSoup
from mitmproxy import http, ctx

# Config via environment variables (or hardcode for quick test)
INJECT_HTML = os.environ.get("INJECT_HTML", '<div id="injected-banner" style="position:fixed;right:12px;bottom:12px;padding:8px;background:#0b74de;color:#fff;border-radius:6px;z-index:2147483647">INJECTED</div>')
INJECT_SCRIPT = os.environ.get("INJECT_SCRIPT", "alert('injected script');")
INJECT_SELECTOR = os.environ.get("INJECT_SELECTOR", "body")  # CSS selector to append snippet into; fallback to body

def add_nonce_to_csp(csp_value: str, nonce: str) -> str:
    """
    Add 'nonce-<nonce>' to script-src directive in a CSP header string.
    If script-src doesn't exist, add it.
    """
    nonce_token = f"'nonce-{nonce}'"
    if not csp_value or not csp_value.strip():
        return f"script-src 'self' {nonce_token}; object-src 'none'; base-uri 'self'"

    parts = [p.strip() for p in csp_value.split(';') if p.strip()]
    new_parts = []
    found = False
    for part in parts:
        if part.startswith("script-src"):
            found = True
            if "nonce-" in part:
                new_parts.append(part)
            else:
                new_parts.append(part + " " + nonce_token)
        else:
            new_parts.append(part)
    if not found:
        new_parts.insert(0, f"script-src 'self' {nonce_token}")
    return "; ".join(new_parts)

class Injector:
    def __init__(self):
        ctx.log.info("Mitmproxy injector initialized")

    def response(self, flow: http.HTTPFlow) -> None:
        # Only act on valid responses with HTML content
        try:
            resp = flow.response
            if resp is None:
                return
            ctype = resp.headers.get("content-type", "").lower()
            if "text/html" not in ctype:
                return

            # get decoded text (mitmproxy handles decompression)
            try:
                html = resp.get_text(strict=False)
            except Exception as e:
                ctx.log.warn(f"Could not get text for {flow.request.pretty_url}: {e}")
                return

            # parse html
            soup = BeautifulSoup(html, "html.parser")

            # generate nonce for this response
            nonce = secrets.token_urlsafe(12)

            # inject the HTML snippet into selector (safe)
            try:
                snippet = BeautifulSoup(INJECT_HTML, "html.parser")
                target = soup.select_one(INJECT_SELECTOR)
                if target:
                    target.append(snippet)
                else:
                    # fallback: append to body if selector not found, or to html
                    if soup.body:
                        soup.body.append(snippet)
                    else:
                        soup.append(snippet)
            except Exception as e:
                ctx.log.error(f"Snippet injection error for {flow.request.pretty_host}: {e}")

            # create script tag with nonce and script content
            try:
                script_tag = soup.new_tag("script")
                script_tag.attrs["nonce"] = nonce
                script_tag.string = INJECT_SCRIPT
                # append script near end of body (or html)
                if soup.body:
                    soup.body.append(script_tag)
                else:
                    soup.append(script_tag)
            except Exception as e:
                ctx.log.error(f"Script injection error for {flow.request.pretty_host}: {e}")

            # update Content-Security-Policy header if present (or set new)
            try:
                csp_header = resp.headers.get("content-security-policy")
                new_csp = add_nonce_to_csp(csp_header, nonce)
                resp.headers["content-security-policy"] = new_csp
            except Exception as e:
                ctx.log.warn(f"Failed to update CSP header for {flow.request.pretty_host}: {e}")

            # also update meta CSP tag if exists in HTML
            try:
                meta = soup.find("meta", attrs={"http-equiv": lambda v: v and v.lower() == "content-security-policy"})
                if meta and meta.has_attr("content"):
                    meta["content"] = add_nonce_to_csp(meta["content"], nonce)
            except Exception as e:
                ctx.log.warn(f"Failed to update CSP meta for {flow.request.pretty_host}: {e}")

            # set modified HTML back into response (mitmproxy will recompress as needed)
            resp.set_text(str(soup))

            ctx.log.info(f"Injected into {flow.request.pretty_host} - {flow.request.path}")

        except Exception as e:
            # Catch-all: don't let addon crash mitmproxy
            ctx.log.error(f"Unexpected injection error for {flow.request.pretty_host}: {e}")

addons = [
    Injector()
]
