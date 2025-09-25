#!/bin/bash
# switch-to-http-proxy.sh - Switch from reverse proxy to HTTP proxy server

echo "🔄 Switching to HTTP Proxy Server"
echo "================================="

# Stop current proxy-injector
echo "Stopping current proxy-injector..."
pm2 stop proxy-injector

# Start HTTP proxy server
echo "Starting HTTP proxy server on port 8080..."
pm2 start http-proxy-server.js --name "http-proxy" --env production

# Show status
echo ""
echo "PM2 Status:"
pm2 status

echo ""
echo "Logs from HTTP proxy server:"
pm2 logs http-proxy --lines 10

echo ""
echo "✅ HTTP proxy server should now be running on port 8080"
echo "Test with: curl -x http://host.minhqnd.com:8080 http://example.com"