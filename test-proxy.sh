#!/bin/bash
# test-proxy.sh - Quick proxy testing script

echo "🔧 Proxy Testing Script"
echo "======================="

# Check if proxy server is running
if ! lsof -i :8080 > /dev/null 2>&1; then
    echo "❌ Proxy server not running on port 8080"
    echo "Start it with: node http-proxy-server.js"
    exit 1
fi

echo "✅ Proxy server is running on port 8080"

# Test proxy with curl
echo ""
echo "🧪 Testing proxy with curl..."

# Test 1: Basic proxy test
echo "Test 1: Basic proxy connection"
if curl -x http://127.0.0.1:8080 -s -o /dev/null -w "%{http_code}" http://example.com | grep -q "200"; then
    echo "✅ Basic proxy connection: OK"
else
    echo "❌ Basic proxy connection: FAILED"
fi

# Test 2: Injection test
echo "Test 2: Script injection"
if curl -x http://127.0.0.1:8080 -s http://example.com | grep -q "proxy-indicator"; then
    echo "✅ Script injection: OK"
else
    echo "❌ Script injection: FAILED"
fi

# Test 3: Non-injection domain
echo "Test 3: Non-injection domain (google.com)"
if curl -x http://127.0.0.1:8080 -s -o /dev/null -w "%{http_code}" http://google.com | grep -q "200\|301\|302"; then
    echo "✅ Non-injection domain: OK (proxy working)"
    if curl -x http://127.0.0.1:8080 -s http://google.com | grep -q "proxy-indicator"; then
        echo "⚠️  Unexpected: Script found in non-injection domain"
    else
        echo "✅ No injection in non-target domain: OK"
    fi
else
    echo "❌ Non-injection domain: FAILED"
fi

echo ""
echo "📊 System Proxy Status:"
echo "HTTP Proxy: $(networksetup -getwebproxy "Wi-Fi" 2>/dev/null || echo 'Not configured')"
echo "HTTPS Proxy: $(networksetup -getsecurewebproxy "Wi-Fi" 2>/dev/null || echo 'Not configured')"

echo ""
echo "🌐 Browser Test:"
echo "1. Make sure system proxy is set to 127.0.0.1:8080"
echo "2. Visit http://example.com in browser"
echo "3. Look for '🔄 PROXIED' button in top-right corner"
echo ""
echo "🔄 To enable system proxy:"
echo "sudo networksetup -setwebproxy 'Wi-Fi' 127.0.0.1 8080"
echo "sudo networksetup -setwebproxystate 'Wi-Fi' on"
echo ""
echo "🛑 To disable system proxy:"
echo "sudo networksetup -setwebproxystate 'Wi-Fi' off"