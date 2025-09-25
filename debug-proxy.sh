#!/bin/bash
# debug-proxy.sh - Debug proxy server connection issues

echo "🔍 Proxy Server Debug Script"
echo "============================"

# Variables
PROXY_HOST="host.minhqnd.com"
PROXY_PORT="8080"
LOCAL_PORT="8080"

echo "📋 Testing proxy server: ${PROXY_HOST}:${PROXY_PORT}"
echo ""

# Test 1: Basic connectivity to proxy server
echo "Test 1: Basic connectivity to proxy server"
echo "Command: telnet ${PROXY_HOST} ${PROXY_PORT}"
if timeout 5s bash -c "</dev/tcp/${PROXY_HOST}/${PROXY_PORT}" 2>/dev/null; then
    echo "✅ Port ${PROXY_PORT} is OPEN on ${PROXY_HOST}"
else
    echo "❌ Port ${PROXY_PORT} is CLOSED or FILTERED on ${PROXY_HOST}"
    echo "   - Check if proxy server is running"
    echo "   - Check if port 8080 is open in AWS Security Group"
    echo "   - Check if UFW firewall allows port 8080"
fi

echo ""

# Test 2: HTTP GET to proxy status page
echo "Test 2: HTTP GET to proxy status page"
echo "Command: curl -v -m 10 http://${PROXY_HOST}:${PROXY_PORT}/"
curl -v -m 10 http://${PROXY_HOST}:${PROXY_PORT}/ 2>&1 | head -20
echo ""

# Test 3: Test proxy functionality
echo "Test 3: Test proxy functionality"
echo "Command: curl -x http://${PROXY_HOST}:${PROXY_PORT} -v -m 10 http://example.com"
curl -x http://${PROXY_HOST}:${PROXY_PORT} -v -m 10 http://example.com 2>&1 | head -20
echo ""

# Test 4: Check if local proxy server is running (if testing locally)
echo "Test 4: Check if local proxy server might be running"
if lsof -i :${LOCAL_PORT} > /dev/null 2>&1; then
    echo "✅ Something is running on local port ${LOCAL_PORT}"
    lsof -i :${LOCAL_PORT}
else
    echo "❌ Nothing running on local port ${LOCAL_PORT}"
fi

echo ""

# Test 5: DNS resolution
echo "Test 5: DNS resolution for ${PROXY_HOST}"
if nslookup ${PROXY_HOST} > /dev/null 2>&1; then
    echo "✅ DNS resolution OK"
    nslookup ${PROXY_HOST}
else
    echo "❌ DNS resolution failed"
fi

echo ""

# Test 6: Current proxy settings
echo "Test 6: Current system proxy settings"
if command -v networksetup > /dev/null 2>&1; then
    echo "HTTP Proxy:"
    networksetup -getwebproxy "Wi-Fi" 2>/dev/null || echo "Not configured"
    echo "HTTPS Proxy:"
    networksetup -getsecurewebproxy "Wi-Fi" 2>/dev/null || echo "Not configured"
else
    echo "networksetup not available (not macOS)"
fi

echo ""
echo "🔧 Troubleshooting Steps:"
echo "1. Make sure proxy server is running on EC2:"
echo "   ssh -i your-key.pem ubuntu@your-ec2-ip"
echo "   pm2 status"
echo "   pm2 logs proxy-injector"
echo ""
echo "2. Check if port 8080 is open:"
echo "   sudo ufw status"
echo "   sudo ufw allow 8080/tcp"
echo ""
echo "3. Check AWS Security Group:"
echo "   Add inbound rule: TCP port 8080 from 0.0.0.0/0"
echo ""
echo "4. Test proxy server locally on EC2:"
echo "   curl http://localhost:8080/"
echo "   curl -x http://localhost:8080 http://example.com"