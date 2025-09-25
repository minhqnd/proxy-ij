#!/bin/bash
# verify-https-proxy.sh - Verify HTTPS proxy is working after deployment

echo "🔍 Verify HTTPS Intercepting Proxy"
echo "=================================="

PROXY_HOST="host.minhqnd.com:8080"

echo "📡 Testing proxy: $PROXY_HOST"
echo ""

# 1. Health check
echo "1. 🏥 Health check:"
curl -s http://$PROXY_HOST/proxy-health | jq . 2>/dev/null || curl -s http://$PROXY_HOST/proxy-health
echo ""

# 2. HTTP injection test
echo "2. 📤 HTTP injection test:"
HTTP_RESPONSE=$(curl -x http://$PROXY_HOST -s http://httpbin.org/html | grep -o "HTTPS Intercepted\|https-proxy-btn" | head -1)
if [ -n "$HTTP_RESPONSE" ]; then
    echo "✅ HTTP injection working"
else
    echo "❌ HTTP injection not detected"
fi
echo ""

# 3. HTTPS connection test
echo "3. 🔒 HTTPS connection test:"
HTTPS_CONNECT=$(curl -x http://$PROXY_HOST -v https://example.com 2>&1 | grep -o "Connection Established\|CONNECT phase completed" | head -1)
if [ -n "$HTTPS_CONNECT" ]; then
    echo "✅ HTTPS CONNECT working"
else
    echo "❌ HTTPS CONNECT failed"
fi
echo ""

# 4. Certificate generation test
echo "4. 📜 Certificate generation test:"
CERT_TEST=$(curl -x http://$PROXY_HOST -k -s https://example.com 2>/dev/null | grep -o "HTTPS Intercepted\|https-proxy-btn" | head -1)
if [ -n "$CERT_TEST" ]; then
    echo "✅ HTTPS interception + injection working"
else
    echo "❌ HTTPS interception not detected (normal if cert generation failed)"
fi
echo ""

# 5. Proxy traffic test
echo "5. 🌐 General proxy traffic test:"
IP_RESPONSE=$(curl -x http://$PROXY_HOST -s http://httpbin.org/ip | grep -o '"origin"' | head -1)
if [ -n "$IP_RESPONSE" ]; then
    echo "✅ Proxy traffic working"
    curl -x http://$PROXY_HOST -s http://httpbin.org/ip
else
    echo "❌ Proxy traffic failed"
fi
echo ""

echo "📋 Summary:"
echo "✅ = Working correctly"
echo "❌ = Needs attention"
echo ""
echo "🔧 Browser setup:"
echo "1. Proxy settings:"
echo "   HTTP Proxy: host.minhqnd.com:8080"
echo "   HTTPS Proxy: host.minhqnd.com:8080"
echo ""
echo "2. Test URLs:"
echo "   http://example.com (should show injection)"
echo "   https://example.com (certificate warning + injection)"
echo ""
echo "⚠️  Expected behavior:"
echo "   - Certificate warnings cho HTTPS là bình thường"
echo "   - Click 'Advanced' → 'Proceed' để test injection"
echo "   - HTTPS injection cần OpenSSL và certificate generation"