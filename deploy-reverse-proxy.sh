#!/bin/bash
# deploy-reverse-proxy.sh - Deploy reverse proxy với DNS control

echo "🌐 Deploy Reverse Proxy với DNS Control"
echo "======================================="

# Files to upload
FILES_TO_UPLOAD=(
    "reverse-proxy-dns.js"
    "setup-reverse-proxy-dns.sh"
    "package.json"
)

# Configuration
EC2_HOST="host.minhqnd.com"
EC2_USER="ubuntu"
PROXY_DOMAIN="proxy.minhqnd.com"

echo "📡 Target: $EC2_USER@$EC2_HOST"
echo "🌐 Proxy Domain: $PROXY_DOMAIN"
echo ""

# Check files
echo "📋 Checking files..."
for file in "${FILES_TO_UPLOAD[@]}"; do
    if [ -f "$file" ]; then
        echo "✅ $file"
    else
        echo "❌ $file (missing)"
    fi
done

echo ""
echo "📋 Manual Deployment Commands:"
echo "=============================="

echo ""
echo "# 1. Upload files (thay your-key.pem):"
for file in "${FILES_TO_UPLOAD[@]}"; do
    if [ -f "$file" ]; then
        echo "scp -i your-key.pem $file $EC2_USER@$EC2_HOST:~/"
    fi
done

echo ""
echo "# 2. SSH và setup:"
cat << 'EOF'
ssh -i your-key.pem ubuntu@host.minhqnd.com

# Trên EC2:
chmod +x setup-reverse-proxy-dns.sh
./setup-reverse-proxy-dns.sh
EOF

echo ""
echo "# 3. Setup DNS trước khi chạy SSL:"
cat << EOF
# Trong Cloudflare DNS cho minhqnd.com:
# Type: A
# Name: proxy
# Content: $(curl -s ifconfig.me 2>/dev/null || echo "YOUR-EC2-IP")
# TTL: Auto
# Proxy Status: OFF (DNS Only - màu xám)
EOF

echo ""
echo "# 4. Sau khi setup DNS, chạy SSL:"
echo "sudo certbot --nginx -d proxy.minhqnd.com --email your-email@example.com"

echo ""
echo "# 5. Test URLs:"
echo "http://proxy.minhqnd.com/proxy-status"
echo "https://proxy.minhqnd.com (sau khi có SSL)"

echo ""
echo "🎯 Expected Results:"
echo "==================="
echo "✅ https://proxy.minhqnd.com hiển thị nội dung từ minhqnd.com"
echo "✅ Button '🔄 Reverse Proxy Active' xuất hiện trên page"
echo "✅ Không có certificate warnings"
echo "✅ Hoạt động trên tất cả browsers"
echo "✅ CSP headers được modify để allow script injection"

echo ""
echo "🔧 Environment Variables (optional):"
echo "export ORIGIN_HOST=minhqnd.com"
echo "export PROXY_DOMAIN=proxy.minhqnd.com"
echo "export ORIGIN_PROTOCOL=https"

echo ""
echo "📋 Troubleshooting:"
echo "=================="
echo "- Check PM2: pm2 logs reverse-proxy"
echo "- Check Nginx: sudo tail -f /var/log/nginx/error.log"
echo "- Check SSL: sudo certbot certificates"
echo "- Test origin: curl -I https://minhqnd.com"
echo "- Check DNS: nslookup proxy.minhqnd.com"