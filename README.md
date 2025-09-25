# Content Injection Proxy (Mitmproxy-only)

This project uses Mitmproxy to perform HTTPS interception (MITM) and inject custom HTML/JS into webpages on the fly. It provides a small Python addon and simple run scripts.

## ✨ Features

- HTTPS interception via Mitmproxy (HTTP/1.1, HTTP/2, WebSockets)
- HTML content injection using a configurable snippet
- CSP-aware script injection (nonces handled automatically)
- Simple configuration via environment variables

## 🧱 Project structure

```
.
├── package.json
├── requirements.txt            # Python deps: mitmproxy, bs4
├── scripts
│   └── install-ca-macos.sh     # Helper to trust Mitmproxy CA on macOS
├── src
│   └── mitmproxy-injector.py   # Mitmproxy addon for HTTPS interception
└── README.md
```

## ⚙️ Requirements

- Node.js 18 or newer (required for native `fetch` / `undici` stream support).
- npm 9+ (bundled with Node 18).
- Python 3.8+ and pip (for Mitmproxy HTTPS interception).
- Mitmproxy: `pip install mitmproxy`.

## 🚀 Local development

See Quick start. This project now uses Mitmproxy exclusively for interception; there is no separate Node.js reverse proxy server.

## 🔧 Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `INTERCEPT_DOMAINS` | `example.com` | Comma-separated list of hosts to inject into. Leave empty to inject everywhere. |
| `INJECT_HTML` | Floating banner | HTML snippet appended to the configured selector. |
| `INJECT_SCRIPT` | _empty_ | Inline JavaScript injected with a CSP nonce. |
| `INJECT_SELECTOR` | `body` | CSS selector to inject into. |

Set environment variables as needed before running mitmdump (see Quick start above).

<!-- Health check removed: Mitmproxy provides its own web UI via mitmweb if needed. -->

## ☁️ Deploying HTTPS Intercepting Proxy on Amazon EC2

Below is a simple end-to-end walkthrough for deploying the HTTPS intercepting proxy on an Ubuntu-based EC2 instance. This sets up the proxy server that clients can connect to for MITM HTTPS interception.

1. **SSH into the instance**
   ```bash
   ssh -i /path/to/key.pem ubuntu@your-ec2-ip
   ```

2. **Install Python and Mitmproxy**
   ```bash
   sudo apt-get update
   sudo apt-get install -y python3 python3-pip git
   
   # Install Mitmproxy
   sudo pip3 install mitmproxy
   ```

3. **Clone your repository** (or copy the project files)
   ```bash
   git clone https://github.com/your-org/content-proxy.git
   cd content-proxy
   # No Node install required for mitmproxy-only mode
   ```

4. **Configure environment variables**
   Create a `.env` file (same directory) or export variables. Example:
   ```bash
   cat <<'EOF' > .env
   INTERCEPT_DOMAINS="example.com,docs.example.com"
   INJECT_HTML='<div class="banner">Injected by EC2 Proxy</div>'
   EOF
   ```

5. **Run the proxy**
   ```bash
   npm run intercept
   ```

   The proxy now listens on port 8080 inside the instance for HTTPS interception.

6. **(Optional) Keep it running with systemd**

   Store environment variables in a dedicated file:
   ```bash
   sudo tee /etc/content-proxy.env > /dev/null <<'EOF'
   INTERCEPT_DOMAINS=example.com
   INJECT_HTML='<div class="banner">Managed by ACME CMS</div>'
   EOF
   ```

   Create a systemd service file:
   ```bash
   sudo tee /etc/systemd/system/content-proxy.service > /dev/null <<'EOF'
   [Unit]
   Description=HTTPS Intercepting Proxy
   After=network.target

   [Service]
   EnvironmentFile=/etc/content-proxy.env
   WorkingDirectory=/home/ubuntu/content-proxy
   ExecStart=/usr/bin/npm run intercept
   Restart=always
   RestartSec=5
   User=ubuntu

   [Install]
   WantedBy=multi-user.target
   EOF

   sudo systemctl daemon-reload
   sudo systemctl enable --now content-proxy.service
   ```

7. **Expose the proxy port**
   - Open security-group ports (TCP 8080) in your EC2 security group.
   - Clients will connect to `your-ec2-ip:8080` as their proxy server.

8. **Copy CA certificate to your local machine**
   After starting the proxy, the CA is generated at `~/.mitmproxy/mitmproxy-ca-cert.pem` on the server. Copy it:
   ```bash
   scp ubuntu@your-ec2-ip:~/.mitmproxy/mitmproxy-ca-cert.pem ~/ec2-ca.pem
   ```

9. **Install CA locally and configure client proxy**
   On your local machine:
   ```bash
   # Install CA (macOS example)
   sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ~/ec2-ca.pem
   
   # Configure system proxy
   networksetup -setwebproxy "Wi-Fi" your-ec2-ip 8080
   networksetup -setsecurewebproxy "Wi-Fi" your-ec2-ip 8080
   networksetup -setwebproxystate "Wi-Fi" on
   networksetup -setsecurewebproxystate "Wi-Fi" on
   ```

10. **Test the setup**
    ```bash
    curl --proxy your-ec2-ip:8080 --max-time 10 https://example.com
    ```
    Should return HTML with injected content. Open a browser to `https://example.com` to see the injection in action.

11. **Turn off proxy when done**
    ```bash
    networksetup -setwebproxystate "Wi-Fi" off
    networksetup -setsecurewebproxystate "Wi-Fi" off
    ```

## 🛡️ HTTPS intercepting proxy (system-wide)

When you need real browsers to connect to the original domain (for example `https://example.com`) while still injecting content, run the HTTPS intercepting proxy using **Mitmproxy**. Mitmproxy is a powerful, open-source HTTPS proxy that allows intercepting, inspecting, modifying, and replaying web traffic.

### Prerequisites

Install Mitmproxy (requires Python 3.8+):
```bash
pip install mitmproxy
```

### Local proxy setup

If running the proxy on your local machine:

1. **Start the proxy**
   ```bash
   export INTERCEPT_DOMAINS="example.com,docs.example.com"
   export INJECT_HTML='<div class="banner">Injected over HTTPS 🎯</div>'
   npm run intercept
   ```

2. **Trust the CA certificate**
   Mitmproxy automatically generates certificates. To install the CA:
   - Open your browser and go to `http://mitm.it` while the proxy is running.
   - Follow the instructions to download and install the certificate for your OS.

   Alternatively, for macOS:
   ```bash
   # The CA is usually at ~/.mitmproxy/mitmproxy-ca-cert.pem
   sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ~/.mitmproxy/mitmproxy-ca-cert.pem
   ```

3. **Configure your system proxy**
   ```bash
   networksetup -setwebproxy "Wi-Fi" 127.0.0.1 8080
   networksetup -setsecurewebproxy "Wi-Fi" 127.0.0.1 8080
   networksetup -setwebproxystate "Wi-Fi" on
   networksetup -setsecurewebproxystate "Wi-Fi" on
   ```

4. **Browse through the proxy**
   Open the browser and navigate to any domain covered by `INTERCEPT_DOMAINS`.

### Remote proxy setup (server-based)

If running the proxy on a remote server (e.g., EC2) and connecting from your local machine:

1. **Start the proxy on the server**
   SSH into your server and run:
   ```bash
   export INTERCEPT_DOMAINS="example.com"
   npm run intercept
   ```
   Use PM2 or systemd to keep it running in the background.

2. **Copy the CA certificate to your local machine**
   ```bash
   scp ubuntu@your-server-ip:~/.mitmproxy/mitmproxy-ca-cert.pem ~/mitmproxy-ca.pem
   ```
   Replace `your-server-ip` with your server's IP address.

3. **Trust the CA certificate locally (macOS)**
   ```bash
   sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ~/mitmproxy-ca.pem
   ```

4. **Configure your local system proxy**
   Point to the server's proxy port:
   ```bash
   networksetup -setwebproxy "Wi-Fi" your-server-ip 8080
   networksetup -setsecurewebproxy "Wi-Fi" your-server-ip 8080
   networksetup -setwebproxystate "Wi-Fi" on
   networksetup -setsecurewebproxystate "Wi-Fi" on
   ```

5. **Browse through the proxy**
   Open your browser and navigate to `https://example.com`. The proxy will intercept and inject content.

6. **Turn off the proxy when done**
   ```bash
   networksetup -setwebproxystate "Wi-Fi" off
   networksetup -setsecurewebproxystate "Wi-Fi" off
   ```

> ⚠️ **Security warning:** Do NOT distribute the generated CA broadly. Anyone who trusts it allows the proxy to read their HTTPS traffic.

### Environment variables for intercept mode

| Variable | Default | Description |
|----------|---------|-------------|
| `INTERCEPT_DOMAINS` | `example.com` | Comma-separated list of hosts to inject into. Leave empty to intercept every domain (not recommended). |
| `INJECT_HTML` | Floating banner | HTML snippet appended to the configured selector. |
| `INJECT_SCRIPT` | _empty_ | Inline JavaScript injected with a CSP nonce. |
| `INJECT_SELECTOR` | `body` | CSS selector that should receive the HTML snippet. |

## 🧭 Next steps

- Add authentication to protect any proxy mode you expose publicly.
- Persist different snippets per path or domain.
- Automate certificate deployment for larger teams (e.g., via MDM).

## 📄 License

MIT
