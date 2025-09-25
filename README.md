# Proxy Injector

A reverse proxy server that forwards requests to https://minhqnd.com and injects inline JavaScript with proper Content Security Policy (CSP) nonce handling.

## Features

- ✅ Reverse proxy with request forwarding
- ✅ Inline script injection with CSP nonce support
- ✅ Automatic compression/decompression handling (gzip, brotli, deflate)
- ✅ CSP header and meta-tag modification
- ✅ Health check endpoint for load balancers
- ✅ Production-ready with PM2 and systemd support
- ✅ Nginx TLS termination with Let's Encrypt
- ✅ Security headers and proper error handling

## Architecture

```
Internet → Nginx (TLS) → Node.js Proxy → https://minhqnd.com
                         ↓
                    Inject Script + Nonce
                         ↓
                    Modify CSP Headers
                         ↓
                    Return to Client
```

## Quick Start (Development)

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Run the server:**
   ```bash
   npm start
   # or
   NODE_ENV=development npm run dev
   ```

3. **Test the proxy:**
   ```bash
   curl http://localhost:3000/health
   # Visit http://localhost:3000 to see the proxied site with injected button
   ```

## EC2 Production Deployment

### Prerequisites

- EC2 instance (Ubuntu 22.04 or Amazon Linux 2023)
- Domain name pointing to EC2 IP (e.g., host.minhqnd.com)
- Security groups allowing ports 22 (SSH), 80 (HTTP), 443 (HTTPS)
- (Optional) Cloudflare setup for DNS and CDN

### Automated Deployment

1. **Upload files to EC2:**
   ```bash
   scp -i your-key.pem proxy-inject-nonce.js ubuntu@your-ec2-ip:~/
   scp -i your-key.pem package.json ubuntu@your-ec2-ip:~/
   scp -i your-key.pem deploy.sh ubuntu@your-ec2-ip:~/
   ```

2. **Run deployment script:**
   ```bash
   ssh -i your-key.pem ubuntu@your-ec2-ip
   chmod +x deploy.sh
   ./deploy.sh
   ```

3. **Setup Nginx with SSL:**
   ```bash
   chmod +x setup-nginx.sh
   ./setup-nginx.sh host.minhqnd.com
   sudo certbot --nginx -d host.minhqnd.com
   ```

**Note**: If using Cloudflare, see [CLOUDFLARE-SETUP.md](CLOUDFLARE-SETUP.md) for specific instructions.

### Manual Deployment Steps

<details>
<summary>Click to expand manual deployment instructions</summary>

#### 1. System Setup

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs build-essential

# Install Nginx and Certbot
sudo apt install -y nginx certbot python3-certbot-nginx

# Install PM2 globally
sudo npm install -g pm2
```

#### 2. Application Setup

```bash
# Create application directory
mkdir -p /home/ubuntu/proxy-injector
cd /home/ubuntu/proxy-injector

# Copy your files (package.json, proxy-inject-nonce.js)
# Install dependencies
npm install

# Test the application
node proxy-inject-nonce.js
# In another terminal: curl http://localhost:3000/health
```

#### 3. PM2 Process Management

```bash
# Start with PM2
pm2 start proxy-inject-nonce.js --name proxy-injector

# Save PM2 configuration
pm2 save

# Setup PM2 startup script
pm2 startup systemd
# Follow the output instructions to run the suggested command
```

#### 4. Nginx Configuration

```bash
# Create Nginx site configuration
sudo cp nginx-proxy.conf /etc/nginx/sites-available/proxy.minhqnd.com

# Enable the site
sudo ln -s /etc/nginx/sites-available/proxy.minhqnd.com /etc/nginx/sites-enabled/

# Remove default site
sudo rm /etc/nginx/sites-enabled/default

# Test and reload Nginx
sudo nginx -t
sudo systemctl reload nginx
```

#### 5. SSL Certificate

```bash
# Obtain Let's Encrypt certificate
sudo certbot --nginx -d proxy.minhqnd.com

# Test automatic renewal
sudo certbot renew --dry-run
```

</details>

### Alternative: Systemd Service

Instead of PM2, you can use systemd:

```bash
# Copy service file
sudo cp proxy-injector.service /etc/systemd/system/

# Or use the setup script
chmod +x setup-systemd.sh
./setup-systemd.sh ubuntu

# Manual systemd commands
sudo systemctl daemon-reload
sudo systemctl enable proxy-injector
sudo systemctl start proxy-injector
sudo systemctl status proxy-injector
```

## Configuration

### Environment Variables

- `PORT` - Server port (default: 3000)
- `NODE_ENV` - Environment mode (development/production)

### Target Origin

Edit `proxy-inject-nonce.js` to change the target:

```javascript
const TARGET_ORIGIN = 'https://minhqnd.com'; // Change this
```

## How It Works

### Script Injection

The proxy injects a button in the bottom-right corner that displays "Hi!" and shows an alert when clicked:

```javascript
// Injected script creates a styled button
const btn = document.createElement('button');
btn.textContent = 'Hi!';
btn.addEventListener('click', () => alert('hello'));
document.body.appendChild(btn);
```

### CSP Nonce Handling

1. **Generate unique nonce** for each request
2. **Add nonce attribute** to injected script tag
3. **Modify CSP headers** to include the nonce
4. **Handle meta-tag CSP** if present in HTML

Example CSP modification:
```
Before: script-src 'self'
After:  script-src 'self' 'nonce-AbC123XyZ=='
```

### Compression Handling

The proxy automatically:
- Removes `accept-encoding` from upstream requests
- Decompresses gzip/brotli/deflate responses
- Injects scripts into decompressed HTML
- Updates `content-length` header

## Monitoring & Troubleshooting

### Health Check

```bash
curl https://proxy.minhqnd.com/health
```

Response:
```json
{
  "status": "healthy",
  "timestamp": "2025-01-01T12:00:00.000Z",
  "target": "https://minhqnd.com",
  "uptime": 3600
}
```

### Logs

**PM2 logs:**
```bash
pm2 logs proxy-injector
pm2 logs proxy-injector --lines 100
```

**Systemd logs:**
```bash
sudo journalctl -u proxy-injector -f
sudo journalctl -u proxy-injector --since today
```

**Nginx logs:**
```bash
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

### Common Issues

**1. Script not injecting:**
- Check if response is `text/html`
- Verify CSP headers in Network tab
- Check browser console for CSP violations

**2. CSP blocking script:**
- Ensure nonce is properly added to CSP header
- Check for meta-tag CSP conflicts
- Verify script has correct nonce attribute

**3. Compression issues:**
- Verify upstream response is properly decompressed
- Check `content-length` header matches body size

**4. SSL certificate issues:**
```bash
sudo certbot renew --dry-run
sudo systemctl status certbot.timer
```

### Performance Monitoring

**PM2 monitoring:**
```bash
pm2 monit
pm2 show proxy-injector
```

**System resources:**
```bash
htop
iostat -x 1
netstat -tlnp | grep :3000
```

## Security Considerations

### Production Security

1. **Use nonce-based CSP** instead of `'unsafe-inline'`
2. **Keep SSL certificates updated** with automatic renewal
3. **Monitor logs** for unusual activity
4. **Use firewall rules** to restrict access
5. **Regular security updates** for system packages

### Legal & Ethical Notes

- Only use this proxy for domains you own or have permission to modify
- Consider server-side injection instead of MITM for production applications
- Respect target site's terms of service and robots.txt
- Implement rate limiting for production use

## File Structure

```
proxy-injector/
├── proxy-inject-nonce.js      # Main application
├── package.json               # Dependencies and scripts
├── deploy.sh                  # Automated deployment script
├── setup-nginx.sh             # Nginx configuration script
├── setup-systemd.sh           # Systemd service setup
├── nginx-proxy.conf           # Nginx configuration template
├── proxy-injector.service     # Systemd service file
└── README.md                  # This file
```

## Development

### Testing Locally

1. Start the proxy server
2. Visit `http://localhost:3000`
3. Look for the "Hi!" button in bottom-right corner
4. Check browser DevTools for CSP headers and console logs

### Adding Features

- **Rate limiting:** Add express-rate-limit middleware
- **Caching:** Implement response caching with Redis
- **Logging:** Add structured logging with Winston
- **Monitoring:** Add Prometheus metrics
- **Multiple targets:** Support routing to different origins

## License

MIT License - feel free to use and modify for your own projects.

## Support

For issues and questions:
- Check the troubleshooting section above
- Review application and nginx logs
- Test with curl commands for debugging
- Verify DNS and SSL certificate status