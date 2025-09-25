#!/bin/bash
# run-direct.sh - Run Node.js directly without Nginx (for testing)

set -e

echo "🚀 Running Node.js proxy directly on port 80/443..."

# Check if running as root (needed for ports 80/443)
if [ "$EUID" -ne 0 ]; then
    echo "❌ Need root privileges to bind to ports 80/443"
    echo "Options:"
    echo "1. Run as root: sudo ./run-direct.sh"
    echo "2. Use different port: PORT=8080 node proxy-inject-nonce.js"
    echo "3. Use Nginx as reverse proxy (recommended)"
    exit 1
fi

# Install dependencies if not installed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Check if port 80 is in use
if netstat -tlnp 2>/dev/null | grep -q ":80 "; then
    echo "⚠️  Port 80 is already in use. Stopping other services..."
    # Stop nginx if running
    systemctl stop nginx 2>/dev/null || true
    # Stop apache if running  
    systemctl stop apache2 2>/dev/null || true
fi

echo "🔧 Starting Node.js proxy on port 80..."
echo "⚠️  Note: This runs without SSL. For HTTPS, use Nginx setup."

# Run Node.js on port 80
PORT=80 NODE_ENV=production node proxy-inject-nonce.js