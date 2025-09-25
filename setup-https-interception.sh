#!/bin/bash
# setup-https-interception.sh - Setup HTTPS intercepting proxy

echo "🔒 Setup HTTPS Intercepting Proxy"
echo "=================================="

# Kiểm tra OpenSSL
if ! command -v openssl &> /dev/null; then
    echo "❌ OpenSSL không được cài đặt!"
    echo "📦 Cài đặt OpenSSL:"
    echo "   macOS: brew install openssl"
    echo "   Ubuntu: sudo apt-get install openssl"
    exit 1
fi

echo "✅ OpenSSL đã được cài đặt"

# Tạo thư mục certificates
mkdir -p certs
echo "📁 Tạo thư mục certificates: ./certs"

# Tạo Root CA (Certificate Authority)
if [ ! -f "certs/rootCA.key" ]; then
    echo "🔐 Tạo Root CA..."
    openssl genrsa -out certs/rootCA.key 4096
    openssl req -x509 -new -nodes -key certs/rootCA.key -sha256 -days 3650 -out certs/rootCA.crt -subj "/C=VN/ST=HCM/L=HCM/O=DevProxy/CN=DevProxy Root CA"
    echo "✅ Root CA đã được tạo: certs/rootCA.crt"
else
    echo "✅ Root CA đã tồn tại"
fi

# Stop proxy hiện tại và chạy HTTPS intercepting proxy
echo ""
echo "🔄 Chuyển sang HTTPS Intercepting Proxy..."
pm2 stop all 2>/dev/null || true
pm2 start https-intercepting-proxy.js --name "https-proxy" --env production

echo ""
echo "📊 Trạng thái PM2:"
pm2 status

echo ""
echo "📝 Logs từ HTTPS Proxy:"
pm2 logs https-proxy --lines 10

echo ""
echo "🧪 Test proxy:"
curl -s http://host.minhqnd.com:8080/proxy-health | jq . 2>/dev/null || curl -s http://host.minhqnd.com:8080/proxy-health

echo ""
echo "✅ HTTPS Intercepting Proxy đã được khởi động!"
echo ""
echo "⚠️  QUAN TRỌNG - Certificate Warnings:"
echo "   1. Browser sẽ hiện warnings cho HTTPS sites"
echo "   2. Điều này là bình thường khi intercept HTTPS"
echo "   3. Chỉ dùng cho development/testing"
echo ""
echo "🔧 Cấu hình Browser:"
echo "   HTTP Proxy: host.minhqnd.com:8080"
echo "   HTTPS Proxy: host.minhqnd.com:8080"
echo ""
echo "🧪 Test HTTPS Injection:"
echo "   https://example.com (sẽ có certificate warning)"
echo ""
echo "📋 Import Root Certificate (để giảm warnings):"
echo "   1. Download: http://host.minhqnd.com:8080/rootCA.crt"
echo "   2. Keychain Access → Import → Trust"