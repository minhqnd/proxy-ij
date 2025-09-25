#!/bin/bash
# setup-reverse-proxy-dns.sh - Setup reverse proxy với DNS control

echo "🌐 Setup Reverse Proxy với DNS Control"
echo "======================================"

# Configuration
PROXY_DOMAIN="proxy.minhqnd.com"
ORIGIN_HOST="minhqnd.com"
EMAIL="your-email@example.com"  # Thay bằng email thật cho Let's Encrypt

echo "📋 Configuration:"
echo "   Proxy Domain: $PROXY_DOMAIN"
echo "   Origin Host: $ORIGIN_HOST"
echo "   SSL Email: $EMAIL"
echo ""

# 1. Cài đặt dependencies
echo "📦 Cài đặt dependencies..."
sudo apt-get update
sudo apt-get install -y nginx certbot python3-certbot-nginx

# 2. Stop existing services
echo "🛑 Dừng services hiện tại..."
pm2 stop all 2>/dev/null || true
sudo systemctl stop nginx 2>/dev/null || true

# 3. Cài đặt npm dependencies
if [ -f "package.json" ]; then
    echo "📦 Cài đặt npm dependencies..."
    npm install
fi

# 4. Start reverse proxy server
echo "🚀 Khởi động reverse proxy server..."
pm2 start reverse-proxy-dns.js --name "reverse-proxy" --env production

# 5. Configure Nginx
echo "🔧 Cấu hình Nginx..."
sudo tee /etc/nginx/sites-available/$PROXY_DOMAIN > /dev/null << EOF
server {
    listen 80;
    server_name $PROXY_DOMAIN;

    # Tạm thời cho Let's Encrypt
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    # Reverse proxy tới Node.js
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        
        # Buffer settings for better performance
        proxy_buffering on;
        proxy_buffer_size 128k;
        proxy_buffers 4 256k;
        proxy_busy_buffers_size 256k;
        
        # Timeout settings
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
}
EOF

# Enable site
sudo ln -sf /etc/nginx/sites-available/$PROXY_DOMAIN /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# Test nginx config
echo "✅ Testing Nginx configuration..."
sudo nginx -t

if [ $? -eq 0 ]; then
    echo "✅ Nginx configuration OK"
    sudo systemctl start nginx
    sudo systemctl enable nginx
else
    echo "❌ Nginx configuration error!"
    exit 1
fi

# 6. Setup SSL với Let's Encrypt
echo "🔒 Setting up SSL với Let's Encrypt..."
echo "⚠️  Đảm bảo DNS đã được setup trước khi chạy:"
echo "   $PROXY_DOMAIN A record → $(curl -s ifconfig.me)"
echo ""

read -p "DNS đã được setup? (y/N): " dns_ready
if [[ $dns_ready =~ ^[Yy]$ ]]; then
    echo "🔒 Obtaining SSL certificate..."
    sudo certbot --nginx -d $PROXY_DOMAIN --non-interactive --agree-tos --email $EMAIL
    
    if [ $? -eq 0 ]; then
        echo "✅ SSL certificate obtained successfully!"
    else
        echo "❌ SSL certificate setup failed. Check DNS and try again."
        echo "Manual command: sudo certbot --nginx -d $PROXY_DOMAIN"
    fi
else
    echo "⏭️  Skipping SSL setup. Run manually after DNS:"
    echo "   sudo certbot --nginx -d $PROXY_DOMAIN --email $EMAIL"
fi

# 7. Final status check
echo ""
echo "📊 Final Status Check:"
echo "====================="

echo "PM2 Status:"
pm2 status

echo ""
echo "Nginx Status:"
sudo systemctl status nginx --no-pager -l

echo ""
echo "Test reverse proxy:"
curl -s http://localhost:3000/proxy-health | head -5

echo ""
echo "✅ Setup completed!"
echo ""
echo "📋 Next Steps:"
echo "   1. Setup DNS: $PROXY_DOMAIN A record → $(curl -s ifconfig.me 2>/dev/null)"
echo "   2. Test HTTP: http://$PROXY_DOMAIN/proxy-status"
echo "   3. Setup SSL: sudo certbot --nginx -d $PROXY_DOMAIN"
echo "   4. Test HTTPS: https://$PROXY_DOMAIN"
echo ""
echo "🎯 Expected Result:"
echo "   - https://$PROXY_DOMAIN shows content from $ORIGIN_HOST"
echo "   - Button '🔄 Reverse Proxy Active' appears on page"
echo "   - No certificate warnings"
echo "   - Works on all browsers"
echo ""
echo "🔧 Troubleshooting:"
echo "   - Check DNS: nslookup $PROXY_DOMAIN"
echo "   - Check logs: pm2 logs reverse-proxy"
echo "   - Check nginx: sudo tail -f /var/log/nginx/error.log"