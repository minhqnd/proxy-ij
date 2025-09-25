#!/bin/bash
# setup-ec2-proxy.sh - Setup HTTP proxy server on EC2

set -e

echo "🚀 Setting up HTTP Proxy Server on EC2..."

# Check if we're on EC2
if [ ! -f "/home/ubuntu/proxy-injector" ] && [ ! -f "/home/minhqnd/proxy-injector" ]; then
    echo "❌ This script should be run on EC2 server"
    exit 1
fi

# Determine user directory
if [ -d "/home/ubuntu" ]; then
    USER_DIR="/home/ubuntu"
    USER="ubuntu"
elif [ -d "/home/minhqnd" ]; then
    USER_DIR="/home/minhqnd"
    USER="minhqnd"
else
    USER_DIR="/home/$(whoami)"
    USER="$(whoami)"
fi

APP_DIR="$USER_DIR/proxy-injector"
echo "📁 Using app directory: $APP_DIR"

# Create directory if not exists
mkdir -p "$APP_DIR"
cd "$APP_DIR"

# Check if http-proxy-server.js exists
if [ ! -f "http-proxy-server.js" ]; then
    echo "❌ http-proxy-server.js not found"
    echo "Please upload the file first:"
    echo "scp -i your-key.pem http-proxy-server.js $USER@your-ec2-ip:$APP_DIR/"
    exit 1
fi

echo "📄 Found http-proxy-server.js"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Configure firewall
echo "🔥 Configuring firewall..."
sudo ufw allow 8080/tcp
echo "✅ Port 8080 opened"

# Stop existing proxy
echo "🛑 Stopping existing proxy..."
pm2 stop proxy-injector 2>/dev/null || echo "No existing proxy to stop"
pm2 delete proxy-injector 2>/dev/null || echo "No existing proxy to delete"

# Start HTTP proxy server
echo "🚀 Starting HTTP proxy server..."
pm2 start http-proxy-server.js --name proxy-injector
pm2 save

# Wait for startup
sleep 3

# Check if running
if pm2 list | grep -q "proxy-injector.*online"; then
    echo "✅ Proxy server started successfully"
else
    echo "❌ Failed to start proxy server"
    pm2 logs proxy-injector --lines 10
    exit 1
fi

# Test local connection
echo "🧪 Testing local connection..."
if curl -s http://localhost:8080/ > /dev/null; then
    echo "✅ Local connection: OK"
else
    echo "❌ Local connection: FAILED"
    exit 1
fi

# Get server info
SERVER_IP=$(curl -s ifconfig.me 2>/dev/null || echo "UNKNOWN")
DOMAIN=$(hostname -f 2>/dev/null || echo "host.minhqnd.com")

echo ""
echo "🎉 HTTP Proxy Server Setup Complete!"
echo ""
echo "📊 Server Information:"
echo "   Server IP: $SERVER_IP"
echo "   Domain: $DOMAIN" 
echo "   Port: 8080"
echo ""
echo "🔧 Browser Configuration:"
echo "   HTTP Proxy: $DOMAIN:8080"
echo "   HTTPS Proxy: $DOMAIN:8080"
echo ""
echo "🧪 Test Commands (from your local machine):"
echo "   curl -v http://$DOMAIN:8080/"
echo "   curl -x http://$DOMAIN:8080 http://example.com"
echo ""
echo "📋 Useful Commands:"
echo "   pm2 status"
echo "   pm2 logs proxy-injector"
echo "   pm2 restart proxy-injector"
echo "   sudo ufw status"
echo ""
echo "⚠️  Make sure to add port 8080 to your AWS Security Group!"