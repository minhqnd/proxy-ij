#!/usr/bin/env python3
"""
Mitmproxy addon: inject HTML/snippet + inline script with nonce, update or strip CSP.
All settings are defined in this file (no environment variables required).

Dependencies:
  pip install mitmproxy beautifulsoup4
Run:
  mitmdump -s src/mitmproxy-injector.py --listen-host 0.0.0.0 --listen-port 8080 --set block_global=false
"""

import secrets
from typing import Optional
from bs4 import BeautifulSoup
from mitmproxy import http, ctx

# ----------------------------
#  CONFIG (chỉnh ở đây)
# ----------------------------

# Nếu ALLOW_ALL=True thì inject mọi host; nếu False chỉ inject các host trong ALLOWED_HOSTS
ALLOW_ALL = True

# Danh sách host (chứa substring) được phép inject, ví dụ: "minhqnd.com", "localhost"
ALLOWED_HOSTS = [
    "minhqnd.com",
    # "localhost",
]

# Nếu True thì XOÁ toàn bộ Content-Security-Policy header/meta trước khi inject.
# Dùng cho test/dev. KHÔNG bật trên proxy công khai.
STRIP_CSP = True

# HTML snippet sẽ được inject (string). Có thể chứa style inline.
INJECT_HTML = (
    '<div id="injected-banner" '
    'style="position:fixed;right:12px;bottom:12px;padding:8px;background:#0b74de;'
    'color:#fff;border-radius:6px;z-index:2147483647;font-family:Arial,sans-serif">'
    'INJECTED</div>'
)

# Inline JS sẽ được inject trong thẻ <script nonce="...">...script...</script>
INJECT_SCRIPT = (
    "/* injected script */\n"
    "try {\n"
    "  const btn = document.createElement('button');\n"
    "  btn.id = 'minhqnd-inject-btn';\n"
    "  btn.textContent = 'Hi!';\n"
    "  btn.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483647;"
    "padding:10px 14px;border-radius:8px;background:#0b74de;color:white;border:none;"
    "box-shadow:0 6px 14px rgba(11,116,222,0.25);cursor:pointer;font-family:Arial,Helvetica,sans-serif';\n"
    "  btn.addEventListener('click', () => alert('hello'));\n"
    "  document.body.appendChild(btn);\n"
    "} catch(e) { console.error('injected script error', e); }\n"
)

# CSS selector để chèn INJECT_HTML (mặc định append vào <body> nếu selector không tồn tại)
INJECT_SELECTOR = "body"

# ----------------------------
#  END CONFIG
# ----------------------------

def host_allowed(host: Optional[str]) -> bool:
    if ALLOW_ALL:
        return True
    if not host:
        return False
    for h in ALLOWED_HOSTS:
        if h and h in host:
            return True
    return False

def add_nonce_to_csp(csp_value: str, nonce: str) -> str:
    """
    Thêm 'nonce-<nonce>' vào directive script-src trong header CSP string.
    Nếu không có script-src, tạo mới.
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
        ctx.log.info("Mitmproxy injector initialized (ALLOW_ALL=%s, STRIP_CSP=%s, ALLOWED_HOSTS=%s)",
                     ALLOW_ALL, STRIP_CSP, ALLOWED_HOSTS)

    def response(self, flow: http.HTTPFlow) -> None:
        """
        Called for each HTTP(S) response. We only modify text/html responses for allowed hosts.
        """
        try:
            resp = flow.response
            if resp is None:
                return

            host = flow.request.pretty_host or ""
            if not host_allowed(host):
                return  # không cho phép host này

            ctype = resp.headers.get("content-type", "").lower()
            if "text/html" not in ctype:
                return  # chỉ xử lý HTML

            # Lấy HTML đã giải nén (mitmproxy hỗ trợ)
            try:
                html = resp.get_text(strict=False)
            except Exception as e:
                ctx.log.warn("Could not get text for %s: %s", flow.request.pretty_url, e)
                return

            # Parse HTML bằng BeautifulSoup (an toàn hơn replace chuỗi)
            soup = BeautifulSoup(html, "html.parser")

            # Nếu STRIP_CSP bật: xóa header CSP và meta CSP
            if STRIP_CSP:
                if "content-security-policy" in resp.headers:
                    del resp.headers["content-security-policy"]
                if "content-security-policy-report-only" in resp.headers:
                    del resp.headers["content-security-policy-report-only"]
                # xóa meta tags CSP trong HTML
                try:
                    metas = soup.find_all("meta", attrs={"http-equiv": lambda v: v and v.lower() == "content-security-policy"})
                    for m in metas:
                        m.decompose()
                except Exception as e:
                    ctx.log.warn("Failed to strip meta CSP for %s: %s", host, e)

            # Generate nonce cho script inline
            nonce = secrets.token_urlsafe(12)

            # Inject HTML snippet vào selector (nếu không tìm thấy thì append vào body hoặc html)
            try:
                snippet = BeautifulSoup(INJECT_HTML, "html.parser")
                target = soup.select_one(INJECT_SELECTOR)
                if target:
                    target.append(snippet)
                else:
                    if soup.body:
                        soup.body.append(snippet)
                    else:
                        soup.append(snippet)
            except Exception as e:
                ctx.log.error("Snippet injection error for %s: %s", host, e)

            # Inject script tag với nonce
            try:
                script_tag = soup.new_tag("script")
                script_tag.attrs["nonce"] = nonce
                script_tag.string = INJECT_SCRIPT
                if soup.body:
                    soup.body.append(script_tag)
                else:
                    soup.append(script_tag)
            except Exception as e:
                ctx.log.error("Script injection error for %s: %s", host, e)

            # Nếu không strip CSP: cố gắng cập nhật header/meta CSP để thêm nonce (nếu header có)
            if not STRIP_CSP:
                try:
                    csp_header = resp.headers.get("content-security-policy")
                    new_csp = add_nonce_to_csp(csp_header, nonce)
                    resp.headers["content-security-policy"] = new_csp
                except Exception as e:
                    ctx.log.warn("Failed to update CSP header for %s: %s", host, e)

                try:
                    meta = soup.find("meta", attrs={"http-equiv": lambda v: v and v.lower() == "content-security-policy"})
                    if meta and meta.has_attr("content"):
                        meta["content"] = add_nonce_to_csp(meta["content"], nonce)
                except Exception as e:
                    ctx.log.warn("Failed to update CSP meta for %s: %s", host, e)

            # Ghi lại HTML đã sửa trở lại response
            try:
                resp.set_text(str(soup))
                ctx.log.info("Injected into %s %s", host, flow.request.path)
            except Exception as e:
                ctx.log.error("Failed to set modified text for %s: %s", host, e)

        except Exception as e:
            ctx.log.error("Unexpected injection error for %s: %s", getattr(flow.request, "pretty_host", "?"), e)

addons = [
    Injector()
]
