#!/bin/bash
# update-proxy.sh - Update proxy server with improved version

set -e

echo "🔄 Updating proxy server..."

# Check if we're on the EC2 server
if [ ! -f "/home/minhqnd/proxy-injector/proxy-inject-nonce.js" ]; then
    echo "❌ Not on EC2 server or proxy not deployed yet"
    echo "Run this script on EC2 server after deployment"
    exit 1
fi

# Backup current version
echo "💾 Backing up current version..."
cp /home/minhqnd/proxy-injector/proxy-inject-nonce.js /home/minhqnd/proxy-injector/proxy-inject-nonce.js.backup.$(date +%Y%m%d_%H%M%S)

# Copy new version (you need to upload this first)
if [ -f "./proxy-inject-nonce.js" ]; then
    echo "📄 Copying updated version..."
    cp ./proxy-inject-nonce.js /home/minhqnd/proxy-injector/
else
    echo "❌ Updated proxy-inject-nonce.js not found in current directory"
    echo "Please upload the updated file first"
    exit 1
fi

# Restart PM2 process
echo "🔄 Restarting PM2 process..."
cd /home/minhqnd/proxy-injector
pm2 restart proxy-injector

# Wait and check status
sleep 2
pm2 status proxy-injector

echo "✅ Proxy server updated successfully!"
echo ""
echo "📊 Check logs:"
echo "   pm2 logs proxy-injector"
echo "   pm2 logs proxy-injector --lines 50"
echo ""
echo "🧪 Test:"
echo "   curl http://localhost:3000/health"