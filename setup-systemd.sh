#!/bin/bash
# setup-systemd.sh - Setup proxy-injector as a systemd service

set -e

USER=${1:-ubuntu}
APP_DIR="/home/$USER/proxy-injector"
SERVICE_FILE="proxy-injector.service"

echo "🔧 Setting up proxy-injector as systemd service..."
echo "👤 User: $USER"
echo "📁 App directory: $APP_DIR"

# Check if the application directory exists
if [ ! -d "$APP_DIR" ]; then
    echo "❌ Application directory does not exist: $APP_DIR"
    echo "Please run deploy.sh first or create the application directory."
    exit 1
fi

# Check if the service file exists
if [ ! -f "$SERVICE_FILE" ]; then
    echo "❌ Service file not found: $SERVICE_FILE"
    echo "Please make sure $SERVICE_FILE exists in the current directory."
    exit 1
fi

# Create a customized service file with the correct user
TEMP_SERVICE=$(mktemp)
sed "s/User=ubuntu/User=$USER/g; s/Group=ubuntu/Group=$USER/g; s|/home/ubuntu/proxy-injector|$APP_DIR|g" "$SERVICE_FILE" > "$TEMP_SERVICE"

# Install the service file
echo "📝 Installing systemd service file..."
sudo cp "$TEMP_SERVICE" "/etc/systemd/system/proxy-injector.service"
rm "$TEMP_SERVICE"

# Set proper permissions
sudo chmod 644 "/etc/systemd/system/proxy-injector.service"

# Reload systemd daemon
echo "🔄 Reloading systemd daemon..."
sudo systemctl daemon-reload

# Enable the service
echo "✅ Enabling proxy-injector service..."
sudo systemctl enable proxy-injector

# Stop PM2 if it's running the same app
if command -v pm2 > /dev/null; then
    echo "🛑 Stopping PM2 process (if running)..."
    pm2 stop proxy-injector 2>/dev/null || true
    pm2 delete proxy-injector 2>/dev/null || true
fi

# Start the service
echo "🚀 Starting proxy-injector service..."
sudo systemctl start proxy-injector

# Check status
sleep 2
if sudo systemctl is-active --quiet proxy-injector; then
    echo "✅ Service is running successfully!"
else
    echo "❌ Service failed to start. Checking logs..."
    sudo systemctl status proxy-injector --no-pager
    exit 1
fi

echo ""
echo "🎉 Systemd service setup completed!"
echo ""
echo "📋 Useful commands:"
echo "   sudo systemctl status proxy-injector     - Check service status"
echo "   sudo systemctl restart proxy-injector    - Restart service"
echo "   sudo systemctl stop proxy-injector       - Stop service"
echo "   sudo systemctl start proxy-injector      - Start service"
echo "   sudo journalctl -u proxy-injector -f     - View live logs"
echo "   sudo journalctl -u proxy-injector --since today  - View today's logs"
echo ""
echo "🔍 Current status:"
sudo systemctl status proxy-injector --no-pager