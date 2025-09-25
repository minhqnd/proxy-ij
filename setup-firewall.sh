#!/bin/bash
# setup-firewall.sh - Configure server firewall for proxy-injector

set -e

echo "🛡️ Configuring server firewall..."

# Detect OS and configure firewall
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$ID
else
    echo "Cannot detect OS"
    exit 1
fi

if [ "$OS" = "ubuntu" ]; then
    echo "📋 Configuring UFW (Ubuntu Firewall)..."
    
    # Install UFW if not present
    sudo apt install -y ufw
    
    # Reset to defaults
    sudo ufw --force reset
    
    # Default policies
    sudo ufw default deny incoming
    sudo ufw default allow outgoing
    
    # Allow SSH (be careful not to lock yourself out!)
    sudo ufw allow 22/tcp
    echo "✅ SSH (22) allowed"
    
    # Allow HTTP
    sudo ufw allow 80/tcp
    echo "✅ HTTP (80) allowed"
    
    # Allow HTTPS
    sudo ufw allow 443/tcp
    echo "✅ HTTPS (443) allowed"
    
    # Allow Node.js port (optional, for direct access)
    sudo ufw allow 3000/tcp
    echo "✅ Node.js (3000) allowed"
    
    # Enable UFW
    sudo ufw --force enable
    echo "✅ UFW enabled"
    
    # Show status
    sudo ufw status numbered
    
elif [ "$OS" = "amzn" ]; then
    echo "📋 Configuring firewalld (Amazon Linux)..."
    
    # Install and start firewalld
    sudo dnf install -y firewalld
    sudo systemctl enable firewalld
    sudo systemctl start firewalld
    
    # Add services
    sudo firewall-cmd --permanent --add-service=ssh
    sudo firewall-cmd --permanent --add-service=http
    sudo firewall-cmd --permanent --add-service=https
    
    # Add custom port for Node.js
    sudo firewall-cmd --permanent --add-port=3000/tcp
    
    # Reload firewall
    sudo firewall-cmd --reload
    
    echo "✅ Firewall configured for Amazon Linux"
    sudo firewall-cmd --list-all
else
    echo "⚠️  Unsupported OS for automatic firewall configuration: $OS"
    echo "Please configure firewall manually"
fi

echo ""
echo "🎉 Firewall configuration completed!"
echo ""
echo "📋 Open ports:"
echo "   22  - SSH"
echo "   80  - HTTP (Nginx)"
echo "   443 - HTTPS (Nginx)" 
echo "   3000 - Node.js (optional)"
echo ""
echo "⚠️  Important:"
echo "   - Make sure you can SSH before disconnecting"
echo "   - Test HTTP/HTTPS access after SSL setup"
echo "   - Port 3000 is optional and can be closed after Nginx setup"