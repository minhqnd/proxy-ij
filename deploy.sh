#!/bin/bash
# deploy.sh - EC2 deployment script for proxy-injector
# Run this on a fresh Ubuntu 22.04 or Amazon Linux 2023 EC2 instance

set -e

echo "🚀 Starting deployment of proxy-injector..."

# Detect OS
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$ID
    VER=$VERSION_ID
else
    echo "Cannot detect OS. This script supports Ubuntu 22.04 and Amazon Linux 2023"
    exit 1
fi

echo "📋 Detected OS: $OS $VER"

# Update system
echo "📦 Updating system packages..."
if [ "$OS" = "ubuntu" ]; then
    sudo apt update && sudo apt upgrade -y
    sudo apt install -y curl wget gnupg2 software-properties-common build-essential
elif [ "$OS" = "amzn" ]; then
    sudo dnf update -y
    sudo dnf install -y curl wget gnupg2 gcc gcc-c++ make
else
    echo "Unsupported OS: $OS"
    exit 1
fi

# Install Node.js 18+
echo "🟢 Installing Node.js 18..."
if [ "$OS" = "ubuntu" ]; then
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt-get install -y nodejs
elif [ "$OS" = "amzn" ]; then
    curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
    sudo dnf install -y nodejs
fi

# Verify Node installation
node_version=$(node --version)
npm_version=$(npm --version)
echo "✅ Node.js installed: $node_version"
echo "✅ npm installed: $npm_version"

# Install Nginx
echo "🌐 Installing Nginx..."
if [ "$OS" = "ubuntu" ]; then
    sudo apt install -y nginx
elif [ "$OS" = "amzn" ]; then
    sudo dnf install -y nginx
fi

# Install Certbot for Let's Encrypt
echo "🔒 Installing Certbot..."
if [ "$OS" = "ubuntu" ]; then
    sudo apt install -y certbot python3-certbot-nginx
elif [ "$OS" = "amzn" ]; then
    sudo dnf install -y certbot python3-certbot-nginx
fi

# Install PM2 globally
echo "⚡ Installing PM2..."
sudo npm install -g pm2

# Create application directory
APP_DIR="/home/$(whoami)/proxy-injector"
echo "📁 Creating application directory: $APP_DIR"

if [ -d "$APP_DIR" ]; then
    echo "⚠️  Directory already exists. Backing up..."
    mv "$APP_DIR" "${APP_DIR}.backup.$(date +%Y%m%d_%H%M%S)"
fi

mkdir -p "$APP_DIR"
cd "$APP_DIR"

# If files don't exist locally, create them
if [ ! -f "package.json" ]; then
    echo "📄 Creating package.json..."
    cat > package.json << 'EOF'
{
  "name": "proxy-injector",
  "version": "1.0.0",
  "description": "Reverse proxy that injects inline script with nonce into HTML responses",
  "main": "proxy-inject-nonce.js",
  "scripts": {
    "start": "node proxy-inject-nonce.js",
    "dev": "NODE_ENV=development node proxy-inject-nonce.js",
    "prod": "NODE_ENV=production node proxy-inject-nonce.js"
  },
  "keywords": [
    "reverse-proxy",
    "csp",
    "nonce",
    "script-injection",
    "express"
  ],
  "author": "minhqnd",
  "license": "MIT",
  "dependencies": {
    "express": "^4.18.2",
    "undici": "^6.0.0"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
EOF
fi

# Copy the main application file if it doesn't exist
if [ ! -f "proxy-inject-nonce.js" ]; then
    echo "📄 You need to copy proxy-inject-nonce.js to this directory"
    echo "📍 Current directory: $(pwd)"
    echo "⏸️  Deployment paused. Please upload your proxy-inject-nonce.js file and run:"
    echo "   npm install"
    echo "   pm2 start proxy-inject-nonce.js --name proxy-injector"
    echo "   pm2 save && pm2 startup"
    exit 0
fi

# Install dependencies
echo "📦 Installing Node.js dependencies..."
npm install

# Test the application
echo "🧪 Testing the application..."
timeout 10s node proxy-inject-nonce.js &
sleep 2
if curl -f http://localhost:3000/health > /dev/null 2>&1; then
    echo "✅ Application test passed"
    pkill -f "node proxy-inject-nonce.js" || true
else
    echo "❌ Application test failed"
    pkill -f "node proxy-inject-nonce.js" || true
    exit 1
fi

# Start with PM2
echo "🚀 Starting application with PM2..."
pm2 start proxy-inject-nonce.js --name proxy-injector
pm2 save

# Setup PM2 startup
echo "🔄 Setting up PM2 startup..."
pm2 startup systemd -u $(whoami) --hp $(eval echo ~$(whoami))

# Enable and start nginx
sudo systemctl enable nginx
sudo systemctl start nginx

# Configure firewall
echo "🔥 Configuring firewall..."
if [ "$OS" = "ubuntu" ]; then
    # Install and configure UFW
    sudo apt install -y ufw
    sudo ufw --force reset
    sudo ufw default deny incoming
    sudo ufw default allow outgoing
    sudo ufw allow 22/tcp    # SSH
    sudo ufw allow 80/tcp    # HTTP
    sudo ufw allow 443/tcp   # HTTPS
    sudo ufw allow 3000/tcp  # Node.js (optional)
    sudo ufw --force enable
    echo "✅ UFW firewall configured"
    sudo ufw status
elif [ "$OS" = "amzn" ]; then
    # Install and configure firewalld
    sudo dnf install -y firewalld
    sudo systemctl enable firewalld
    sudo systemctl start firewalld
    sudo firewall-cmd --permanent --add-service=ssh
    sudo firewall-cmd --permanent --add-service=http
    sudo firewall-cmd --permanent --add-service=https
    sudo firewall-cmd --permanent --add-port=3000/tcp
    sudo firewall-cmd --reload
    echo "✅ firewalld configured"
    sudo firewall-cmd --list-all
fi

echo ""
echo "🎉 Deployment completed successfully!"
echo ""
echo "📊 Next steps:"
echo "1. Point your domain to this server's IP address"
echo "2. Run: sudo certbot --nginx -d your-domain.com"
echo "3. Update nginx configuration to proxy_pass to localhost:3000"
echo ""
echo "📋 Useful commands:"
echo "   pm2 status                    - Check PM2 status"
echo "   pm2 logs proxy-injector      - View application logs"
echo "   pm2 restart proxy-injector   - Restart application"
echo "   sudo systemctl status nginx  - Check nginx status"
echo "   sudo nginx -t                - Test nginx configuration"
echo ""
echo "🌐 Application is running on:"
echo "   http://$(curl -s ipinfo.io/ip):3000/health"
echo "   http://localhost:3000/health"