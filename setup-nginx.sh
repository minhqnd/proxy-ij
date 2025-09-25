#!/bin/bash
# setup-nginx.sh - Configure Nginx with SSL for proxy-injector

set -e

DOMAIN=${1:-proxy.minhqnd.com}
APP_PORT=${2:-3000}

echo "🌐 Setting up Nginx for domain: $DOMAIN"
echo "📡 Proxying to localhost:$APP_PORT"

# Check if nginx is installed
if ! command -v nginx > /dev/null; then
    echo "❌ Nginx is not installed. Please install it first."
    exit 1
fi

# Check if certbot is installed
if ! command -v certbot > /dev/null; then
    echo "❌ Certbot is not installed. Please install it first."
    exit 1
fi

# Create nginx configuration
NGINX_CONF="/etc/nginx/sites-available/$DOMAIN"
echo "📝 Creating Nginx configuration at $NGINX_CONF"

sudo tee "$NGINX_CONF" > /dev/null << EOF
# HTTP server block (before SSL certificate)
server {
    listen 80;
    server_name $DOMAIN;

    # Allow Let's Encrypt ACME challenge
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    # For initial setup, allow direct access to test
    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_buffering off;
    }
}
EOF

# Enable the site
echo "🔗 Enabling Nginx site..."
sudo ln -sf "$NGINX_CONF" "/etc/nginx/sites-enabled/$DOMAIN"

# Remove default site if it exists
if [ -L "/etc/nginx/sites-enabled/default" ]; then
    echo "🗑️  Removing default Nginx site..."
    sudo rm /etc/nginx/sites-enabled/default
fi

# Test nginx configuration
echo "🧪 Testing Nginx configuration..."
sudo nginx -t

# Reload nginx
echo "🔄 Reloading Nginx..."
sudo systemctl reload nginx

echo ""
echo "✅ Nginx setup completed!"
echo ""
echo "📋 Next steps:"
echo "1. Make sure your domain $DOMAIN points to this server's IP"
echo "2. Test HTTP access: curl -I http://$DOMAIN/health"
echo "3. Obtain SSL certificate: sudo certbot --nginx -d $DOMAIN"
echo "4. After SSL setup, the configuration will be automatically updated"
echo ""
echo "🔒 To get SSL certificate, run:"
echo "   sudo certbot --nginx -d $DOMAIN"
echo ""
echo "📊 Monitor logs:"
echo "   sudo tail -f /var/log/nginx/access.log"
echo "   sudo tail -f /var/log/nginx/error.log"