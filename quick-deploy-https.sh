#!/bin/bash
# quick-deploy-https.sh - Quick deploy với thông tin mặc định

echo "🚀 Quick Deploy HTTPS Proxy"
echo "==========================="

# Sử dụng thông tin từ context trước
EC2_HOST="host.minhqnd.com"
EC2_USER="ubuntu"

echo "📡 Deploying to: $EC2_USER@$EC2_HOST"
echo "📁 Working directory: $(pwd)"

# Kiểm tra files cần thiết
echo ""
echo "📋 Checking files..."
REQUIRED_FILES=("https-intercepting-proxy.js" "setup-https-interception.sh" "package.json")

for file in "${REQUIRED_FILES[@]}"; do
    if [ -f "$file" ]; then
        echo "✅ $file"
    else
        echo "❌ $file (missing)"
    fi
done

echo ""
echo "🤖 Tôi sẽ giả định bạn có SSH key và kết nối EC2."
echo "Nếu cần, chạy commands này manually:"
echo ""

echo "# 1. Upload files:"
for file in "${REQUIRED_FILES[@]}"; do
    if [ -f "$file" ]; then
        echo "scp -i your-key.pem $file $EC2_USER@$EC2_HOST:~/"
    fi
done

echo ""
echo "# 2. SSH vào EC2 và setup:"
cat << 'EOF'
ssh -i your-key.pem ubuntu@host.minhqnd.com

# Trên EC2:
sudo apt-get update
sudo apt-get install -y openssl

# Cài npm dependencies (nếu cần)
npm install

# Stop proxy cũ
pm2 stop all

# Chạy HTTPS intercepting proxy
pm2 start https-intercepting-proxy.js --name "https-proxy" --env production

# Check status
pm2 status
pm2 logs https-proxy --lines 10

# Test
curl http://localhost:8080/proxy-health
EOF

echo ""
echo "# 3. Test từ local:"
echo "./verify-https-proxy.sh"

echo ""
echo "🎯 Kết quả mong đợi:"
echo "✅ HTTP proxy: Hoạt động bình thường"
echo "✅ HTTPS CONNECT: Hoạt động (tunnel)"
echo "🔒 HTTPS Interception: Phụ thuộc certificate generation"
echo "⚠️  Certificate warnings: Bình thường cho HTTPS interception"

echo ""
echo "🧪 Test URLs sau khi deploy:"
echo "- http://example.com (injection sẽ work)"
echo "- https://example.com (cần accept certificate warning)"
echo ""
echo "Bạn muốn tôi tạo commands cụ thể để copy-paste không?"