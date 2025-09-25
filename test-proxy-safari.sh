#!/bin/bash
# test-proxy-safari.sh - Test proxy với các URL khác nhau

echo "🧪 Test Proxy cho Safari"
echo "======================="

PROXY="host.minhqnd.com:8080"

echo "1. Test HTTP example.com:"
curl -x http://$PROXY -v http://example.com 2>&1 | head -10

echo ""
echo "2. Test HTTPS example.com:"
curl -x http://$PROXY -v https://example.com 2>&1 | head -10

echo ""
echo "3. Test với domain khác - httpbin.org:"
curl -x http://$PROXY -s http://httpbin.org/user-agent

echo ""
echo "4. Test với domain khác - google.com:"
curl -x http://$PROXY -I http://google.com 2>&1 | head -5

echo ""
echo "📝 Hướng dẫn cho Safari:"
echo "1. System Preferences → Network → Advanced → Proxies"
echo "2. Bật cả 'Web Proxy (HTTP)' và 'Secure Web Proxy (HTTPS)'"
echo "3. Cả hai đều set: host.minhqnd.com:8080"
echo "4. Thử truy cập: http://example.com (không phải https://)"
echo "5. Hoặc thử: http://httpbin.org/ip để test"