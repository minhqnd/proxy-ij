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

# ----------------------------
# Replace INJECT_HTML and INJECT_SCRIPT with the mini-browser widget below
# ----------------------------

INJECT_HTML = (
    '<div id="mini-browser-root" aria-hidden="true" '
    'style="position:fixed;right:16px;bottom:16px;z-index:2147483647;font-family:Arial,Helvetica,sans-serif">'
    '  <button id="mini-browser-toggle" title="Show mini browser" '
    '    style="all:unset;cursor:pointer;background:#0b74de;color:#fff;padding:8px 10px;border-radius:8px;'
    '    box-shadow:0 6px 14px rgba(11,116,222,0.25);font-weight:600">☰</button>'
    '</div>'
)

INJECT_SCRIPT = (
    "/* mini-browser widget script */\n"
    "(function(){\n"
    "  try{\n"
    "    if(window.__MINI_BROWSER_LOADED) return; window.__MINI_BROWSER_LOADED = true;\n"
    "    const root = document.getElementById('mini-browser-root');\n"
    "    if(!root) return;\n"
    "\n"
    "    // Create panel (hidden by default)\n"
    "    const panel = document.createElement('div');\n"
    "    panel.id = 'mini-browser-panel';\n"
    "    panel.style.cssText = 'display:none;width:420px;height:300px;position:fixed;right:16px;bottom:56px;"
    "background:rgba(255,255,255,0.98);border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,0.3);"
    "overflow:hidden;backdrop-filter:blur(4px);z-index:2147483647;border:1px solid rgba(0,0,0,0.08)';\n"
    "\n"
    "    // header\n"
    "    const header = document.createElement('div');\n"
    "    header.style.cssText = 'display:flex;gap:8px;align-items:center;padding:8px;background:linear-gradient(90deg,#f7f8fb,#fff);border-bottom:1px solid rgba(0,0,0,0.04)';\n"
    "    const backBtn = document.createElement('button'); backBtn.textContent='◀'; backBtn.title='Back';\n"
    "    const fwdBtn = document.createElement('button'); fwdBtn.textContent='▶'; fwdBtn.title='Forward';\n"
    "    const urlInput = document.createElement('input'); urlInput.type='text'; urlInput.placeholder='https://example.com';\n"
    "    const goBtn = document.createElement('button'); goBtn.textContent='Go'; goBtn.title='Go to URL';\n"
    "    const openBtn = document.createElement('button'); openBtn.textContent='Open'; openBtn.title='Open in new tab';\n"
    "    const closeBtn = document.createElement('button'); closeBtn.textContent='✕'; closeBtn.title='Close';\n"
    "\n"
    "    // tiny style for controls\n"
    "    [backBtn,fwdBtn,goBtn,openBtn,closeBtn].forEach(b=>{ b.style.cssText='padding:6px 8px;border-radius:6px;border:none;background:#eef2ff;cursor:pointer'; b.onmousedown=e=>e.stopPropagation(); });\n"
    "    urlInput.style.cssText='flex:1;padding:6px 8px;border-radius:6px;border:1px solid #dfe7ff;outline:none';\n"
    "    header.append(backBtn,fwdBtn,urlInput,goBtn,openBtn,closeBtn);\n"
    "\n"
    "    // iframe container and iframe\n"
    "    const frameWrap = document.createElement('div');\n"
    "    frameWrap.style.cssText='width:100%;height:calc(100% - 48px);background:#fff;';\n"
    "    const iframe = document.createElement('iframe');\n"
    "    iframe.style.cssText='width:100%;height:100%;border:0;display:block;';\n"
    "    iframe.setAttribute('sandbox','allow-scripts allow-forms allow-same-origin allow-popups');\n"
    "    frameWrap.appendChild(iframe);\n"
    "\n"
    "    panel.appendChild(header); panel.appendChild(frameWrap);\n"
    "    document.body.appendChild(panel);\n"
    "\n"
    "    // Toggle button behavior (root already has toggle button)\n"
    "    const toggle = document.getElementById('mini-browser-toggle');\n"
    "    let visible = false;\n"
    "    const historyStack = [];\n    const forwardStack = [];\n"
    "\n"
    "    function show(){ panel.style.display='block'; root.setAttribute('aria-hidden','false'); visible=true; }\n"
    "    function hide(){ panel.style.display='none'; root.setAttribute('aria-hidden','true'); visible=false; }\n"
    "\n"
    "    toggle.addEventListener('click', function(){ if(visible) hide(); else show(); });\n"
    "\n"
    "    // navigation helpers\n"
    "    function normalizeUrl(u){ try{ if(!u) return ''; if(u.startsWith('http://')||u.startsWith('https://')) return u; return 'https://'+u; }catch(e){return u;} }\n"
    "    function navigateTo(u, pushHistory=true){ const url=normalizeUrl(u); if(!url) return; try{ iframe.src = url; urlInput.value = url; if(pushHistory){ if(historyStack.length===0 || historyStack[historyStack.length-1] !== url){ historyStack.push(url); forwardStack.length=0; } } }catch(e){console.error(e);} }\n"
    "\n"
    "    backBtn.addEventListener('click', function(){ if(historyStack.length>1){ const cur = historyStack.pop(); forwardStack.push(cur); const prev = historyStack[historyStack.length-1]; navigateTo(prev, false); } });\n"
    "    fwdBtn.addEventListener('click', function(){ if(forwardStack.length){ const next = forwardStack.pop(); navigateTo(next, false); historyStack.push(next); } });\n"
    "    goBtn.addEventListener('click', function(){ navigateTo(urlInput.value); });\n"
    "    urlInput.addEventListener('keydown', function(e){ if(e.key==='Enter'){ navigateTo(urlInput.value); } });\n"
    "    openBtn.addEventListener('click', function(){ const u = normalizeUrl(urlInput.value); if(u) window.open(u, '_blank'); });\n"
    "    closeBtn.addEventListener('click', function(){ hide(); });\n"
    "\n"
    "    // convenience: clicking the toggle shorter (double click opens google)\n"
    "    toggle.addEventListener('dblclick', function(){ navigateTo('https://www.google.com'); show(); });\n"
    "\n"
    "    // start with Google loaded (but keep it lazy: only load when panel first shown)\n"
    "    let initiated = false;\n"
    "    function ensureInit(){ if(initiated) return; initiated=true; navigateTo('https://www.google.com'); }\n"
    "    toggle.addEventListener('click', ensureInit, { once:true });\n"
    "\n"
    "    // handle iframe load errors: show a small overlay message\n"
    "    iframe.addEventListener('load', function(){ /* clear any error overlay */ });\n"
    "    iframe.addEventListener('error', function(){ console.warn('iframe load error'); });\n"
    "\n"
    "    // small drag support for panel (optional)\n"
    "    (function(){ let dragging=false, ox=0, oy=0; header.style.cursor='grab'; header.addEventListener('mousedown', function(e){ dragging=true; ox=e.clientX; oy=e.clientY; header.style.cursor='grabbing'; e.preventDefault(); }); window.addEventListener('mousemove', function(e){ if(!dragging) return; const dx=e.clientX-ox, dy=e.clientY-oy; const rect=panel.getBoundingClientRect(); panel.style.right='auto'; panel.style.bottom='auto'; panel.style.left=Math.max(8, rect.left+dx)+'px'; panel.style.top=Math.max(8, rect.top+dy)+'px'; ox=e.clientX; oy=e.clientY; }); window.addEventListener('mouseup', function(){ if(dragging){ dragging=false; header.style.cursor='grab'; } }); })();\n"
    "\n"
    "    // make buttons look nicer via small inline style injection\n"
    "    (function(){ const style = document.createElement('style'); style.textContent = '\\n'"
    "      + '#mini-browser-panel button{background:#eef2ff;border:1px solid rgba(11,116,222,0.08);padding:6px 8px;border-radius:6px}\\n'\n"
    "      + '#mini-browser-panel input{font-size:13px}\\n'; document.head.appendChild(style); })();\n"
    "\n"
    "  }catch(err){ console.error('mini-browser init error', err); }\n"
    "})();\n"
)

# ----------------------------
# End of widget code
# ----------------------------


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
        # Use a single formatted string for logging (mitmproxy log methods accept one message)
        msg = f"Mitmproxy injector initialized (ALLOW_ALL={ALLOW_ALL}, STRIP_CSP={STRIP_CSP}, ALLOWED_HOSTS={ALLOWED_HOSTS})"
        ctx.log.info(msg)

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
                return  # host not allowed

            ctype = resp.headers.get("content-type", "").lower()
            if "text/html" not in ctype:
                return  # only process HTML

            # Get decoded HTML (mitmproxy handles decompression)
            try:
                html = resp.get_text(strict=False)
            except Exception as e:
                ctx.log.warn(f"Could not get text for {flow.request.pretty_url}: {e}")
                return

            # Parse HTML with BeautifulSoup
            soup = BeautifulSoup(html, "html.parser")

            # If STRIP_CSP: remove header CSP and meta CSP
            if STRIP_CSP:
                if "content-security-policy" in resp.headers:
                    del resp.headers["content-security-policy"]
                if "content-security-policy-report-only" in resp.headers:
                    del resp.headers["content-security-policy-report-only"]
                # remove meta CSP tags
                try:
                    metas = soup.find_all("meta", attrs={"http-equiv": lambda v: v and v.lower() == "content-security-policy"})
                    for m in metas:
                        m.decompose()
                except Exception as e:
                    ctx.log.warn(f"Failed to strip meta CSP for {host}: {e}")

            # Generate nonce for inline script
            nonce = secrets.token_urlsafe(12)

            # Inject HTML snippet into selector (or fallback to body/html)
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
                ctx.log.error(f"Snippet injection error for {host}: {e}")

            # Inject script tag with nonce
            try:
                script_tag = soup.new_tag("script")
                script_tag.attrs["nonce"] = nonce
                script_tag.string = INJECT_SCRIPT
                if soup.body:
                    soup.body.append(script_tag)
                else:
                    soup.append(script_tag)
            except Exception as e:
                ctx.log.error(f"Script injection error for {host}: {e}")

            # If not stripping CSP, try to update header/meta CSP to include the nonce
            if not STRIP_CSP:
                try:
                    csp_header = resp.headers.get("content-security-policy")
                    new_csp = add_nonce_to_csp(csp_header, nonce)
                    resp.headers["content-security-policy"] = new_csp
                except Exception as e:
                    ctx.log.warn(f"Failed to update CSP header for {host}: {e}")

                try:
                    meta = soup.find("meta", attrs={"http-equiv": lambda v: v and v.lower() == "content-security-policy"})
                    if meta and meta.has_attr("content"):
                        meta["content"] = add_nonce_to_csp(meta["content"], nonce)
                except Exception as e:
                    ctx.log.warn(f"Failed to update CSP meta for {host}: {e}")

            # Write modified HTML back into response
            try:
                resp.set_text(str(soup))
                ctx.log.info(f"Injected into {host} {flow.request.path}")
            except Exception as e:
                ctx.log.error(f"Failed to set modified text for {host}: {e}")

        except Exception as e:
            ctx.log.error(f"Unexpected injection error for {getattr(flow.request, 'pretty_host', '?')}: {e}")

addons = [
    Injector()
]
