#!/bin/bash
# test-reverse-proxy.sh - Test reverse proxy sau khi deploy

echo "🧪 Test Reverse Proxy DNS Setup"
echo "==============================="

PROXY_DOMAIN="proxy.minhqnd.com"
ORIGIN_HOST="minhqnd.com"

echo "🌐 Testing: $PROXY_DOMAIN"
echo "🎯 Origin: $ORIGIN_HOST"
echo ""

# 1. DNS Resolution Test
echo "1. 🔍 DNS Resolution Test:"
if command -v nslookup > /dev/null; then
    nslookup $PROXY_DOMAIN | grep "Address:" | tail -1
else
    echo "   nslookup not available, using dig..."
    dig +short $PROXY_DOMAIN | head -1
fi

# 2. HTTP Connectivity Test
echo ""
echo "2. 📡 HTTP Connectivity Test:"
HTTP_STATUS=$(curl -w "%{http_code}" -s -o /dev/null http://$PROXY_DOMAIN/proxy-health)
if [ "$HTTP_STATUS" = "200" ]; then
    echo "✅ HTTP connection OK ($HTTP_STATUS)"
else
    echo "❌ HTTP connection failed ($HTTP_STATUS)"
fi

# 3. HTTPS Connectivity Test (if SSL exists)
echo ""
echo "3. 🔒 HTTPS Connectivity Test:"
HTTPS_STATUS=$(curl -w "%{http_code}" -s -o /dev/null https://$PROXY_DOMAIN/proxy-health 2>/dev/null)
if [ "$HTTPS_STATUS" = "200" ]; then
    echo "✅ HTTPS connection OK ($HTTPS_STATUS)"
else
    echo "❌ HTTPS connection failed ($HTTPS_STATUS) - SSL chưa setup?"
fi

# 4. Health Check Test
echo ""
echo "4. 💚 Health Check Test:"
HEALTH_RESPONSE=$(curl -s http://$PROXY_DOMAIN/proxy-health 2>/dev/null)
if echo "$HEALTH_RESPONSE" | grep -q "reverse-proxy-dns"; then
    echo "✅ Reverse proxy health check OK"
    echo "$HEALTH_RESPONSE" | head -3
else
    echo "❌ Health check failed or wrong response"
fi

# 5. Origin Content Test
echo ""
echo "5. 🎯 Origin Content Test:"
ORIGIN_CONTENT=$(curl -s http://$PROXY_DOMAIN/ 2>/dev/null | head -10 | grep -i "title\|h1" | head -1)
if [ -n "$ORIGIN_CONTENT" ]; then
    echo "✅ Origin content retrieved:"
    echo "   $ORIGIN_CONTENT"
else
    echo "❌ No content from origin"
fi

# 6. Script Injection Test
echo ""
echo "6. 💉 Script Injection Test:"
INJECTION_TEST=$(curl -s http://$PROXY_DOMAIN/ 2>/dev/null | grep -o "reverse-proxy-btn\|Reverse Proxy Active")
if [ -n "$INJECTION_TEST" ]; then
    echo "✅ Script injection detected"
else
    echo "❌ Script injection not found"
fi

# 7. SSL Certificate Test (if HTTPS works)
echo ""
echo "7. 📜 SSL Certificate Test:"
if [ "$HTTPS_STATUS" = "200" ]; then
    CERT_INFO=$(echo | openssl s_client -servername $PROXY_DOMAIN -connect $PROXY_DOMAIN:443 2>/dev/null | openssl x509 -noout -issuer -subject 2>/dev/null)
    if echo "$CERT_INFO" | grep -q "Let's Encrypt"; then
        echo "✅ Let's Encrypt certificate found"
    else
        echo "ℹ️  Certificate info:"
        echo "$CERT_INFO"
    fi
else
    echo "⏭️  HTTPS not available, skipping cert test"
fi

# 8. Performance Test
echo ""
echo "8. ⚡ Performance Test:"
RESPONSE_TIME=$(curl -w "%{time_total}" -s -o /dev/null http://$PROXY_DOMAIN/proxy-status 2>/dev/null)
echo "   Response time: ${RESPONSE_TIME}s"

# Summary
echo ""
echo "📋 Test Summary:"
echo "==============="

if [ "$HTTP_STATUS" = "200" ]; then
    echo "✅ HTTP proxy: Working"
else
    echo "❌ HTTP proxy: Failed"
fi

if [ "$HTTPS_STATUS" = "200" ]; then
    echo "✅ HTTPS proxy: Working"
else
    echo "⚠️  HTTPS proxy: Not ready (setup SSL)"
fi

if [ -n "$INJECTION_TEST" ]; then
    echo "✅ Script injection: Working"
else
    echo "❌ Script injection: Failed"
fi

echo ""
echo "🎯 Next Steps:"
if [ "$HTTP_STATUS" != "200" ]; then
    echo "   1. Check PM2: pm2 logs reverse-proxy"
    echo "   2. Check Nginx: sudo systemctl status nginx"
    echo "   3. Check DNS: nslookup $PROXY_DOMAIN"
fi

if [ "$HTTPS_STATUS" != "200" ]; then
    echo "   1. Setup SSL: sudo certbot --nginx -d $PROXY_DOMAIN"
    echo "   2. Check DNS propagation: nslookup $PROXY_DOMAIN"
fi

if [ -z "$INJECTION_TEST" ]; then
    echo "   1. Check logs: pm2 logs reverse-proxy"
    echo "   2. Check origin connectivity: curl -I https://$ORIGIN_HOST"
fi

echo ""
echo "🔗 Test URLs:"
echo "   Status page: http://$PROXY_DOMAIN/proxy-status"
echo "   Health check: http://$PROXY_DOMAIN/proxy-health"
echo "   Main site: http://$PROXY_DOMAIN/"
if [ "$HTTPS_STATUS" = "200" ]; then
    echo "   HTTPS main: https://$PROXY_DOMAIN/"
fi