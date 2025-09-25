#!/bin/bash
# check-proxy-status.sh - Kiểm tra trạng thái proxy server hiện tại

echo "🔍 Kiểm tra Proxy Server hiện tại"
echo "================================"

echo "1. Kiểm tra kết nối tới proxy server:"
echo "curl -I http://host.minhqnd.com:8080/proxy-health"
curl -I http://host.minhqnd.com:8080/proxy-health 2>/dev/null || echo "❌ Không thể kết nối"

echo ""
echo "2. Kiểm tra loại proxy server:"
echo "curl -s http://host.minhqnd.com:8080/proxy-health"
RESPONSE=$(curl -s http://host.minhqnd.com:8080/proxy-health 2>/dev/null)
echo "$RESPONSE"

if echo "$RESPONSE" | grep -q '"type":"generic-proxy"'; then
    echo ""
    echo "❌ VẤN ĐỀ: Đang chạy generic-proxy (reverse proxy)"
    echo "   - Chỉ proxy tới minhqnd.com"
    echo "   - Không thể proxy tới example.com"
    echo ""
    echo "🔧 GIẢI PHÁP: Cần chuyển sang http-proxy-server.js"
elif echo "$RESPONSE" | grep -q '"type":"http-proxy"'; then
    echo ""
    echo "✅ ĐÚNG: Đang chạy http-proxy server"
    echo "   - Có thể proxy tới bất kỳ domain nào"
else
    echo ""
    echo "❓ KHÔNG RÕ: Không thể xác định loại proxy"
fi

echo ""
echo "3. Test proxy với example.com:"
echo "curl -x http://host.minhqnd.com:8080 -I http://example.com"
curl -x http://host.minhqnd.com:8080 -I http://example.com 2>&1 | head -5

echo ""
echo "4. Test proxy với httpbin.org:"
echo "curl -x http://host.minhqnd.com:8080 -s http://httpbin.org/ip | head -3"
curl -x http://host.minhqnd.com:8080 -s http://httpbin.org/ip 2>/dev/null | head -3 || echo "❌ Không thành công"

echo ""
echo "📋 Hướng dẫn chuyển sang HTTP proxy đúng:"
echo "1. SSH vào EC2: ssh -i your-key.pem ubuntu@your-ec2-ip"
echo "2. Dừng proxy hiện tại: pm2 stop proxy-injector"
echo "3. Chạy HTTP proxy: pm2 start http-proxy-server.js --name http-proxy"
echo "4. Kiểm tra: pm2 logs http-proxy"