# EC2 Setup Guide

## 🚀 **Tạo EC2 Instance**

### **1. Launch Instance:**
- **AMI**: Ubuntu 22.04 LTS hoặc Amazon Linux 2023
- **Instance Type**: t3.micro (free tier) hoặc t3.small
- **Storage**: 8GB minimum (20GB recommended)
- **Key Pair**: Tạo hoặc chọn key pair có sẵn

### **2. Cấu hình Security Group:**

**Inbound Rules:**
```
Type          Protocol    Port Range    Source        Description
SSH           TCP         22            My IP         SSH Access
HTTP          TCP         80            0.0.0.0/0     HTTP Traffic  
HTTPS         TCP         443           0.0.0.0/0     HTTPS Traffic
Custom TCP    TCP         3000          My IP         Node.js (Optional)
```

**Outbound Rules:**
```
All traffic   All         All           0.0.0.0/0     Allow outbound
```

## 🌐 **DNS Configuration**

### **1. Domain Setup:**
```bash
# Point your domain to EC2
proxy.minhqnd.com   A    YOUR_EC2_PUBLIC_IP
```

### **2. Verify DNS:**
```bash
nslookup proxy.minhqnd.com
dig proxy.minhqnd.com
```

## ⚙️ **Deployment Commands**

### **1. Connect to EC2:**
```bash
ssh -i your-key.pem ubuntu@your-ec2-ip
# or for Amazon Linux
ssh -i your-key.pem ec2-user@your-ec2-ip
```

### **2. Upload Files:**
```bash
# From local machine
scp -i your-key.pem package.json ubuntu@your-ec2-ip:~/
scp -i your-key.pem proxy-inject-nonce.js ubuntu@your-ec2-ip:~/
scp -i your-key.pem deploy.sh ubuntu@your-ec2-ip:~/
scp -i your-key.pem setup-*.sh ubuntu@your-ec2-ip:~/
```

### **3. Run Deployment:**
```bash
# On EC2 server
chmod +x deploy.sh
./deploy.sh
```

### **4. Setup Nginx + SSL:**
```bash
./setup-nginx.sh proxy.minhqnd.com
sudo certbot --nginx -d proxy.minhqnd.com
```

## 🔍 **Testing Setup**

### **1. Test Node.js App:**
```bash
curl http://your-ec2-ip:3000/health
```

### **2. Test Nginx:**
```bash
curl http://proxy.minhqnd.com/health
```

### **3. Test HTTPS:**
```bash
curl https://proxy.minhqnd.com/health
```

### **4. Test Proxy:**
```bash
# Should show minhqnd.com content with injected button
curl -v https://proxy.minhqnd.com/
```

## 🛠️ **Manual Port Configuration**

### **AWS CLI Commands:**
```bash
# Get your Security Group ID
aws ec2 describe-instances --instance-ids i-1234567890abcdef0

# Add rules
aws ec2 authorize-security-group-ingress \
    --group-id sg-xxxxxxxxx \
    --protocol tcp \
    --port 22 \
    --cidr $(curl -s ifconfig.me)/32

aws ec2 authorize-security-group-ingress \
    --group-id sg-xxxxxxxxx \
    --protocol tcp \
    --port 80 \
    --cidr 0.0.0.0/0

aws ec2 authorize-security-group-ingress \
    --group-id sg-xxxxxxxxx \
    --protocol tcp \
    --port 443 \
    --cidr 0.0.0.0/0
```

### **Server Firewall:**
```bash
# Ubuntu UFW
sudo ufw status
sudo ufw allow 22
sudo ufw allow 80  
sudo ufw allow 443
sudo ufw enable

# Amazon Linux firewalld
sudo systemctl status firewalld
sudo firewall-cmd --list-all
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
```

## 🚨 **Troubleshooting**

### **Common Issues:**

**1. Cannot connect to port 80/443:**
- Check Security Group inbound rules
- Check server firewall: `sudo ufw status`
- Verify Nginx is running: `sudo systemctl status nginx`

**2. Node.js app not starting:**
- Check application logs: `pm2 logs proxy-injector`
- Verify port 3000 is not in use: `netstat -tlnp | grep 3000`
- Check dependencies: `npm install`

**3. SSL certificate issues:**
- Verify domain points to correct IP: `nslookup proxy.minhqnd.com`
- Check certbot logs: `sudo tail -f /var/log/letsencrypt/letsencrypt.log`
- Ensure port 80 is accessible for ACME challenge

**4. Firewall blocking traffic:**
```bash
# Ubuntu - temporarily disable to test
sudo ufw disable
# Test your connection
sudo ufw enable

# Amazon Linux - check rules
sudo firewall-cmd --list-all
sudo firewall-cmd --permanent --add-port=80/tcp
sudo firewall-cmd --reload
```

## 📋 **Port Summary**

| Port | Purpose | Access | Required |
|------|---------|--------|----------|
| 22 | SSH | Your IP only | Yes |
| 80 | HTTP/Nginx | Public | Yes |
| 443 | HTTPS/SSL | Public | Yes |
| 3000 | Node.js | Optional | No |

**Notes:**
- Port 3000 chỉ cần mở khi test trực tiếp Node.js app
- Sau khi Nginx hoạt động ổn định, có thể đóng port 3000
- Always keep port 22 restricted to your IP để bảo mật