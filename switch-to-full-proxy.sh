#!/bin/bash
# switch-to-full-proxy.sh - Chuyển sang HTTP proxy server đầy đủ (hỗ trợ HTTP + HTTPS)

echo "🔄 Chuyển sang Full HTTP Proxy Server"
echo "===================================="

# Stop tất cả proxy hiện tại
echo "Dừng tất cả proxy servers hiện tại..."
pm2 stop all
pm2 delete all

# Upload file mới lên EC2 (nếu chạy từ local)
if [ -f "http-proxy-server-full.js" ]; then
    echo "✅ File http-proxy-server-full.js đã tồn tại"
else
    echo "❌ File http-proxy-server-full.js không tồn tại!"
    echo "Vui lòng upload file này lên EC2 trước"
    exit 1
fi

# Chạy full proxy server
echo "Khởi động Full HTTP Proxy Server..."
pm2 start http-proxy-server-full.js --name "full-proxy" --env production

# Kiểm tra trạng thái
echo ""
echo "📊 Trạng thái PM2:"
pm2 status

echo ""
echo "📝 Logs từ Full Proxy Server:"
pm2 logs full-proxy --lines 10

echo ""
echo "🧪 Test proxy server:"
echo "curl http://host.minhqnd.com:8080/proxy-health"
curl -s http://host.minhqnd.com:8080/proxy-health | jq . 2>/dev/null || curl -s http://host.minhqnd.com:8080/proxy-health

echo ""
echo "✅ Full HTTP Proxy Server đã được khởi động!"
echo "📋 Tính năng:"
echo "   - HTTP requests: ✅"
echo "   - HTTPS CONNECT tunneling: ✅"  
echo "   - Script injection: ✅"
echo ""
echo "🔧 Cấu hình Safari:"
echo "   HTTP Proxy: host.minhqnd.com:8080"
echo "   HTTPS Proxy: host.minhqnd.com:8080"
echo ""
echo "🧪 Test URLs:"
echo "   http://example.com"
echo "   https://example.com"
echo "   http://httpbin.org/ip"
echo "   https://httpbin.org/ip"