#!/bin/bash
# deploy-https-proxy.sh - Deploy HTTPS intercepting proxy to EC2

echo "🚀 Deploy HTTPS Intercepting Proxy to EC2"
echo "=========================================="

# Configuration - Thay đổi theo setup của bạn
EC2_USER="ubuntu"
EC2_HOST=""  # Sẽ được hỏi nếu trống
KEY_FILE=""  # Sẽ được hỏi nếu trống

# Hỏi thông tin EC2 nếu chưa có
if [ -z "$EC2_HOST" ]; then
    echo "🔧 Cấu hình EC2:"
    read -p "Nhập EC2 IP hoặc domain (host.minhqnd.com): " EC2_HOST
fi

if [ -z "$KEY_FILE" ]; then
    read -p "Nhập đường dẫn tới SSH key (.pem file): " KEY_FILE
fi

if [ ! -f "$KEY_FILE" ]; then
    echo "❌ SSH key không tồn tại: $KEY_FILE"
    exit 1
fi

echo "📡 Connecting to: $EC2_USER@$EC2_HOST"

# 1. Upload files
echo ""
echo "📤 Uploading files to EC2..."

FILES_TO_UPLOAD=(
    "https-intercepting-proxy.js"
    "setup-https-interception.sh"
    "package.json"
)

for file in "${FILES_TO_UPLOAD[@]}"; do
    if [ -f "$file" ]; then
        echo "   Uploading $file..."
        scp -i "$KEY_FILE" "$file" "$EC2_USER@$EC2_HOST:~/"
    else
        echo "   ⚠️ File không tồn tại: $file"
    fi
done

# 2. Deploy trên EC2
echo ""
echo "🔧 Setting up HTTPS intercepting proxy on EC2..."

ssh -i "$KEY_FILE" "$EC2_USER@$EC2_HOST" << 'REMOTE_SCRIPT'
echo "🔍 Kiểm tra môi trường EC2..."

# Kiểm tra Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js chưa được cài đặt!"
    echo "📦 Cài đặt Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

# Kiểm tra PM2
if ! command -v pm2 &> /dev/null; then
    echo "📦 Cài đặt PM2..."
    sudo npm install -g pm2
fi

# Kiểm tra OpenSSL
if ! command -v openssl &> /dev/null; then
    echo "📦 Cài đặt OpenSSL..."
    sudo apt-get update
    sudo apt-get install -y openssl
fi

# Cài đặt dependencies nếu cần
if [ -f "package.json" ]; then
    echo "📦 Cài đặt npm dependencies..."
    npm install
fi

# Chạy setup script
if [ -f "setup-https-interception.sh" ]; then
    echo "🔒 Chạy HTTPS interception setup..."
    chmod +x setup-https-interception.sh
    ./setup-https-interception.sh
else
    echo "❌ setup-https-interception.sh không tồn tại!"
    
    # Fallback: chạy manual
    echo "🔄 Manual setup..."
    pm2 stop all 2>/dev/null || true
    pm2 start https-intercepting-proxy.js --name "https-proxy" --env production
fi

echo ""
echo "📊 PM2 Status:"
pm2 status

echo ""
echo "📝 Recent logs:"
pm2 logs https-proxy --lines 5

echo ""
echo "🧪 Test proxy health:"
curl -s http://localhost:8080/proxy-health | head -3

REMOTE_SCRIPT

# 3. Final verification
echo ""
echo "✅ Deployment completed!"
echo ""
echo "🔒 HTTPS Intercepting Proxy Info:"
echo "   URL: http://$EC2_HOST:8080"
echo "   Health: http://$EC2_HOST:8080/proxy-health"
echo ""
echo "🔧 Browser Configuration:"
echo "   HTTP Proxy: $EC2_HOST:8080"
echo "   HTTPS Proxy: $EC2_HOST:8080"
echo ""
echo "🧪 Test URLs:"
echo "   https://example.com (sẽ có certificate warning + injection)"
echo "   http://example.com (sẽ có injection)"
echo ""
echo "⚠️  Certificate Warnings:"
echo "   - Browser sẽ hiện security warnings cho HTTPS"
echo "   - Click 'Advanced' → 'Proceed to site' để test"
echo "   - Điều này là bình thường khi intercept HTTPS"
echo ""
echo "📋 Check status:"
echo "   ssh -i $KEY_FILE $EC2_USER@$EC2_HOST"
echo "   pm2 logs https-proxy"
echo "   pm2 status"