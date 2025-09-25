#!/bin/bash
# test.sh - Simple test script to verify the proxy setup

set -e

echo "🧪 Testing proxy-injector setup..."

# Check if Node.js is available
if ! command -v node > /dev/null; then
    echo "❌ Node.js is not installed"
    exit 1
fi

NODE_VERSION=$(node --version)
echo "✅ Node.js version: $NODE_VERSION"

# Check if required files exist
REQUIRED_FILES=("package.json" "proxy-inject-nonce.js")
for file in "${REQUIRED_FILES[@]}"; do
    if [ -f "$file" ]; then
        echo "✅ Found: $file"
    else
        echo "❌ Missing: $file"
        exit 1
    fi
done

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
else
    echo "✅ Dependencies already installed"
fi

# Start server in background for testing
echo "🚀 Starting server for testing..."
PORT=3001 node proxy-inject-nonce.js &
SERVER_PID=$!

# Wait for server to start
sleep 3

# Test health endpoint
echo "🏥 Testing health endpoint..."
if curl -f http://localhost:3001/health > /dev/null 2>&1; then
    echo "✅ Health check passed"
else
    echo "❌ Health check failed"
    kill $SERVER_PID 2>/dev/null || true
    exit 1
fi

# Test basic proxy functionality
echo "🔗 Testing proxy functionality..."
RESPONSE=$(curl -s -I http://localhost:3001/)
if echo "$RESPONSE" | grep -q "HTTP/.*200\|HTTP/.*301\|HTTP/.*302"; then
    echo "✅ Proxy response received"
else
    echo "❌ Proxy test failed"
    echo "Response headers:"
    echo "$RESPONSE"
fi

# Clean up
echo "🧹 Cleaning up..."
kill $SERVER_PID 2>/dev/null || true
wait $SERVER_PID 2>/dev/null || true

echo ""
echo "🎉 Basic tests completed!"
echo ""
echo "📋 Next steps for deployment:"
echo "1. Upload files to your EC2 instance"
echo "2. Run ./deploy.sh on the server"
echo "3. Configure your domain to point to EC2 IP"
echo "4. Run ./setup-nginx.sh your-domain.com"
echo "5. Get SSL certificate with certbot"