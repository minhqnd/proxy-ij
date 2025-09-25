# Content Management Proxy

A lightweight Node.js proxy toolkit that can run in three modes:

- **Reverse proxy** – fetches pages from a target origin (for example `https://example.com`), injects HTML/snippets, and serves the modified response to clients.
- **Forward HTTP proxy** – (optional) system proxy for plain HTTP traffic that injects content per domain.
- **HTTPS intercepting proxy** – full man-in-the-middle (MITM) proxy that generates certificates on the fly, decrypts HTTPS responses, and injects custom content before re-encrypting them.

Use it to preview or control content without touching the origin infrastructure directly.

## ✨ Features

- **Full reverse proxy** for any HTTP(S) origin.
- **HTML content injection** using a configurable snippet.
- **CSP-aware script injection** (uses nonces and updates `Content-Security-Policy`).
- **Compression aware**: transparently handles Brotli, gzip and deflate payloads.
- **HTTPS interception** using Mitmproxy for man-in-the-middle capabilities.
- **Simple configuration** via environment variables.
- **Health check endpoint** for monitoring (`/health`).

## 🧱 Project structure

```
.
├── package.json
├── package-lock.json
├── scripts
│   └── install-ca-macos.sh
├── src
│   ├── https-interceptor.js  # Legacy (replaced by mitmproxy-injector.py)
│   ├── mitmproxy-injector.py # Mitmproxy addon for HTTPS interception
│   └── server.js
└── README.md
```

## ⚙️ Requirements

- Node.js 18 or newer (required for native `fetch` / `undici` stream support).
- npm 9+ (bundled with Node 18).
- Python 3.8+ and pip (for Mitmproxy HTTPS interception).
- Mitmproxy: `pip install mitmproxy`.

## 🚀 Local development

```bash
# Install dependencies
npm install

# Start the proxy (defaults to https://example.com)
npm run dev

# Visit through the proxy
open http://localhost:3000
```

By default the reverse proxy forwards to `https://example.com` and injects a small banner at the bottom-right of every HTML page. Modify the environment variables below to adapt it to your needs.

## 🔧 Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Local port to listen on. |
| `TARGET_ORIGIN` | `https://example.com` | Upstream site you want to proxy and modify. |
| `INJECTION_HTML` | Banner snippet | HTML snippet appended to every proxied HTML body. You can include inline styles or scripts. |

Use a local `.env` file (ignored by git) or export variables in your shell before starting the server:

```bash
export TARGET_ORIGIN="https://intranet.yourcompany.com"
export INJECTION_HTML='<div class="banner">Managed by ACME CMS</div>'
npm start
```

## 🧪 Health check

The proxy exposes `GET /health` which returns JSON containing the current configuration and timestamp. Useful for monitoring or load balancers.

## ☁️ Deploying on Amazon EC2

Below is a simple end-to-end walkthrough for an Ubuntu-based EC2 instance. Adjust commands for other distributions as needed.

1. **SSH into the instance**
   ```bash
   ssh -i /path/to/key.pem ubuntu@your-ec2-ip
   ```

2. **Install Node.js 18 and Git**
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
   sudo apt-get install -y nodejs git
   ```

3. **Clone your repository** (or copy the project files)
   ```bash
   git clone https://github.com/your-org/content-proxy.git
   cd content-proxy
   npm install
   ```

4. **Configure environment variables**
   Create a `.env` file (same directory) or export variables. Example:
   ```bash
   cat <<'EOF' > .env
   PORT=3000
   TARGET_ORIGIN="https://example.com"
   INJECTION_HTML='<div class="banner">Managed by ACME CMS</div>'
   EOF
   ```

5. **Run the proxy**
   ```bash
   npm start
   ```

   The service now listens on port 3000 inside the instance.

6. **(Optional) Keep it running with systemd**

   Store environment variables in a dedicated file:
   ```bash
   sudo tee /etc/content-proxy.env > /dev/null <<'EOF'
   PORT=3000
   TARGET_ORIGIN=https://example.com
   INJECTION_HTML='<div class="banner">Managed by ACME CMS</div>'
   EOF
   ```

   Create a systemd service file:
   ```bash
   sudo tee /etc/systemd/system/content-proxy.service > /dev/null <<'EOF'
   [Unit]
   Description=Content Management Proxy
   After=network.target

   [Service]
   EnvironmentFile=/etc/content-proxy.env
   WorkingDirectory=/home/ubuntu/content-proxy
   ExecStart=/usr/bin/npm start
   Restart=always
   RestartSec=5
   User=ubuntu

   [Install]
   WantedBy=multi-user.target
   EOF

   sudo systemctl daemon-reload
   sudo systemctl enable --now content-proxy.service
   ```

7. **Expose the proxy**
   - Open security-group ports (e.g. TCP 80/443 or 3000).
   - Optionally put Nginx in front for TLS termination with Let’s Encrypt.

8. **Verify**
   ```bash
   curl http://your-ec2-ip:3000/health
   ```

### Using Nginx for HTTPS termination (optional)

1. Install Nginx:
   ```bash
   sudo apt-get install -y nginx
   ```
2. Configure a server block (replace `proxy.example.com` with your domain):
   ```bash
   sudo tee /etc/nginx/sites-available/content-proxy > /dev/null <<'EOF'
   server {
     listen 80;
     server_name proxy.example.com;

     location / {
       proxy_pass http://127.0.0.1:3000;
       proxy_set_header Host $host;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;
     }
   }
   EOF

   sudo ln -sf /etc/nginx/sites-available/content-proxy /etc/nginx/sites-enabled/content-proxy
   sudo systemctl reload nginx
   ```
3. Issue a Let’s Encrypt certificate with Certbot:
   ```bash
   sudo apt-get install -y certbot python3-certbot-nginx
   sudo certbot --nginx -d proxy.example.com
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
