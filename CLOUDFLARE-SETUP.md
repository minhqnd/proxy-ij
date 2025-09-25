# Setup với Cloudflare

## ☁️ **Cloudflare Configuration**

Vì bạn đã setup Cloudflare cho `host.minhqnd.com`, có một số điểm cần lưu ý:

### **1. 🔧 Cloudflare SSL Mode**

Kiểm tra SSL/TLS mode trong Cloudflare Dashboard:

**Recommended: "Full (strict)"**
```
Browser ←→ Cloudflare (HTTPS) ←→ Your Server (HTTPS)
```

**Alternative: "Flexible" (less secure)**  
```
Browser ←→ Cloudflare (HTTPS) ←→ Your Server (HTTP)
```

### **2. 🌐 DNS Settings**

Trong Cloudflare DNS:
```
Type: A
Name: host (or @)  
Content: YOUR_EC2_PUBLIC_IP
Proxy status: 🟠 Proxied (recommended)
```

### **3. 🔒 SSL Certificate Options**

#### **Option A: Let's Encrypt + Cloudflare (Recommended)**
```bash
# Setup như bình thường
./setup-nginx.sh host.minhqnd.com
sudo certbot --nginx -d host.minhqnd.com

# Cloudflare sẽ verify qua HTTP-01 challenge
```

#### **Option B: Cloudflare Origin Certificate**
1. Trong Cloudflare Dashboard → SSL/TLS → Origin Server
2. Create Certificate cho `host.minhqnd.com`
3. Download certificate files
4. Upload lên server:

```bash
# Upload certificates to server
sudo mkdir -p /etc/ssl/cloudflare
sudo nano /etc/ssl/cloudflare/host.minhqnd.com.pem    # Origin certificate
sudo nano /etc/ssl/cloudflare/host.minhqnd.com.key   # Private key

# Update nginx config
sudo nano /etc/nginx/sites-available/host.minhqnd.com
```

### **4. 🛡️ Security Settings**

**Cloudflare Settings to Enable:**
- ✅ **Always Use HTTPS**: ON
- ✅ **HSTS**: Enable
- ✅ **Minimum TLS Version**: 1.2
- ✅ **Bot Fight Mode**: ON (optional)
- ✅ **DDoS Protection**: ON (automatic)

### **5. 🚀 Performance Settings**

**Speed Optimizations:**
- ✅ **Auto Minify**: HTML, CSS, JS
- ✅ **Brotli**: ON
- ✅ **HTTP/2**: ON
- ✅ **Caching Level**: Standard

### **6. 🔍 Testing với Cloudflare**

```bash
# Test direct to server (bypass Cloudflare)
curl -H "Host: host.minhqnd.com" http://YOUR_EC2_IP/health

# Test through Cloudflare
curl https://host.minhqnd.com/health

# Check if proxied through Cloudflare
curl -I https://host.minhqnd.com/health | grep -i cf-ray
```

### **7. ⚠️ Potential Issues với Cloudflare**

#### **Issue 1: SSL Verification**
Nếu certbot fail:
```bash
# Temporarily set DNS to "DNS only" (grey cloud)
# Run certbot
sudo certbot --nginx -d host.minhqnd.com
# Then enable proxy again (orange cloud)
```

#### **Issue 2: Real IP Detection**
Nginx sẽ nhận IP của Cloudflare thay vì client IP:

```nginx
# Add to nginx config
real_ip_header CF-Connecting-IP;
set_real_ip_from 173.245.48.0/20;
set_real_ip_from 103.21.244.0/22;
set_real_ip_from 103.22.200.0/22;
# ... (add all Cloudflare IP ranges)
```

#### **Issue 3: Rate Limiting**
Cloudflare có rate limiting, có thể affect proxy requests:
- Set appropriate cache rules
- Monitor Cloudflare Analytics

### **8. 📋 Deployment Steps với Cloudflare**

```bash
# 1. Verify DNS resolution
nslookup host.minhqnd.com
dig host.minhqnd.com

# 2. Deploy application
./deploy.sh

# 3. Setup nginx
./setup-nginx.sh host.minhqnd.com

# 4. Get SSL certificate
sudo certbot --nginx -d host.minhqnd.com

# 5. Test everything
curl https://host.minhqnd.com/health
curl https://host.minhqnd.com/
```

### **9. 🔧 Cloudflare Page Rules (Optional)**

Tạo Page Rule để optimize caching:

**Rule 1: Cache API responses**
```
URL Pattern: host.minhqnd.com/api/*
Settings: Cache Level = Cache Everything, Edge Cache TTL = 2 hours
```

**Rule 2: Bypass cache for dynamic content**  
```
URL Pattern: host.minhqnd.com/*
Settings: Cache Level = Bypass
```

### **10. 📊 Monitoring**

**Cloudflare Analytics:**
- Traffic analytics
- Security events  
- Performance metrics

**Server Monitoring:**
```bash
# Nginx logs
sudo tail -f /var/log/nginx/host.minhqnd.com.access.log

# Application logs  
pm2 logs proxy-injector

# System resources
htop
```

## ✅ **Quick Commands cho Setup**

```bash
# Complete setup với existing Cloudflare
./setup-nginx.sh host.minhqnd.com
sudo certbot --nginx -d host.minhqnd.com

# Test từng bước
curl -I http://host.minhqnd.com/health        # HTTP
curl -I https://host.minhqnd.com/health       # HTTPS  
curl -s https://host.minhqnd.com/ | grep Hi   # Check injection
```