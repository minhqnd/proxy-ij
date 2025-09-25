#!/bin/bash
# test-https-injection-local.sh - Test HTTPS injection locally

echo "🔒 Test HTTPS Injection Locally"
echo "==============================="

echo "1. Khởi động HTTPS intercepting proxy local..."
node https-intercepting-proxy.js &
PROXY_PID=$!
sleep 3

echo ""
echo "2. Test HTTP injection (should work):"
curl -x http://localhost:8080 -s http://example.com/test | grep -o "HTTPS Intercepted" || echo "❌ HTTP injection failed"

echo ""
echo "3. Test HTTPS health check:"
curl -s http://localhost:8080/proxy-health | jq .supports 2>/dev/null || curl -s http://localhost:8080/proxy-health

echo ""
echo "4. Test certificate generation:"
mkdir -p certs
echo "📁 Certificate directory created"

echo ""
echo "5. Certificate warning test:"
echo "   Browser sẽ hiện certificate warning cho HTTPS"
echo "   Đây là điều bình thường khi intercept HTTPS"

# Cleanup
echo ""
echo "🛑 Stopping local proxy..."
kill $PROXY_PID 2>/dev/null

echo ""
echo "✅ Local test completed!"
echo ""
echo "📋 Để deploy lên EC2:"
echo "   1. Upload https-intercepting-proxy.js lên EC2"
echo "   2. Chạy: ./setup-https-interception.sh"
echo "   3. Test với browser proxy settings"
echo ""
echo "⚠️  Lưu ý:"
echo "   - HTTPS injection cần certificate warnings"
echo "   - Chỉ dùng cho development"
echo "   - Production nên dùng HTTP injection hoặc service worker"