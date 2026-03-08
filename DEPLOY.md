# Deployment Guide — Outreach Agent

Complete step-by-step guide to deploy the Outreach Agent on a fresh Ubuntu server at `outreach.simpleinc.in`.

---

## Prerequisites

- Ubuntu 22.04+ VPS (or AWS EC2 free tier)
- Domain `outreach.simpleinc.in` pointed to your server IP (A record in DNS)
- SSH access to server
- A Zoho Mail account for `darshan@simpleinc.in` (already existing)

---

## Step 1: Generate API Keys

### 1.1 Anthropic API Key (Claude)

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Sign up / Log in
3. Navigate to **API Keys** in the left sidebar
4. Click **Create Key**
5. Name it `outreach-agent`
6. Copy the key (starts with `sk-ant-...`)
7. Add billing — Claude Sonnet 4 costs ~$6-10/month for this use case
8. Save the key — you'll need it for `.env`

### 1.2 AWS SES SMTP Credentials

1. Go to [AWS Console](https://console.aws.amazon.com) > **SES** (Simple Email Service)
2. Select region **Asia Pacific (Mumbai) — ap-south-1**

**Verify your domain:**
3. Go to **Verified identities** > **Create identity**
4. Select **Domain** > Enter `simpleinc.in`
5. Enable **Easy DKIM** (recommended)
6. AWS gives you 3 CNAME records — add these to your DNS registrar
7. Wait for verification (usually 5-30 minutes)

**Verify sender email:**
8. Also verify `darshan@simpleinc.in` as an identity (AWS sends a confirmation email)

**Move out of sandbox:**
9. Go to **Account dashboard** > **Request production access**
10. Fill in: Use case = "Transactional emails for my web development freelance business"
11. Set daily sending quota request to 200
12. Wait for approval (usually 24-48 hours)

**Generate SMTP credentials:**
13. Go to **SMTP settings** in left sidebar
14. Click **Create SMTP credentials**
15. Note the SMTP endpoint: `email-smtp.ap-south-1.amazonaws.com`
16. Username and password are generated — **copy both immediately** (password shown only once)

### 1.3 Zoho IMAP App Password

1. Go to [accounts.zoho.in/home](https://accounts.zoho.in/home)
2. Navigate to **Security** > **App Passwords**
3. Click **Generate New Password**
4. App name: `outreach-agent`
5. Copy the generated password — this is your `IMAP_PASS`

### 1.4 Dashboard Password & JWT Secret

Generate a strong JWT secret:
```bash
openssl rand -hex 32
```

Choose a dashboard login password (this is the single password for `outreach.simpleinc.in`).

---

## Step 2: Server Setup

SSH into your server:

```bash
ssh root@YOUR_SERVER_IP
```

### 2.1 System Updates

```bash
apt update && apt upgrade -y
```

### 2.2 Install Node.js 20

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
node -v  # Should show v20.x.x
```

### 2.3 Install Build Tools (for better-sqlite3)

```bash
apt install -y build-essential python3
```

### 2.4 Install PM2

```bash
npm install -g pm2
```

### 2.5 Install Nginx

```bash
apt install -y nginx
systemctl enable nginx
systemctl start nginx
```

### 2.6 Install Certbot (SSL)

```bash
apt install -y certbot python3-certbot-nginx
```

---

## Step 3: Deploy the Application

### 3.1 Clone the Repository

```bash
mkdir -p /var/www
cd /var/www
git clone YOUR_REPO_URL outreach-agent
cd outreach-agent
```

If not using git, upload files via `scp`:
```bash
# From your local machine:
scp -r /Users/drprockz/Projects/Outreach/* root@YOUR_SERVER_IP:/var/www/outreach-agent/
```

### 3.2 Install Backend Dependencies

```bash
cd /var/www/outreach-agent
npm install
```

This compiles `better-sqlite3` natively — takes ~30 seconds.

### 3.3 Build Dashboard

```bash
cd dashboard
npm install
npm run build
cd ..
```

This creates `dashboard/dist/` with the production React build.

### 3.4 Configure Environment

```bash
cp .env.example .env
nano .env
```

Fill in all values:

```env
# Anthropic — from Step 1.1
ANTHROPIC_API_KEY=sk-ant-your-key-here

# AWS SES SMTP — from Step 1.2
SES_SMTP_HOST=email-smtp.ap-south-1.amazonaws.com
SES_SMTP_PORT=587
SES_SMTP_USER=your-smtp-username
SES_SMTP_PASS=your-smtp-password
SES_FROM_EMAIL=darshan@simpleinc.in
SES_FROM_NAME=Darshan Parmar

# Zoho IMAP — from Step 1.3
IMAP_HOST=imap.zoho.in
IMAP_PORT=993
IMAP_USER=darshan@simpleinc.in
IMAP_PASS=your-zoho-app-password

# Personal email for alerts + daily reports
REPORT_EMAIL=your.personal@gmail.com

# Dashboard auth — from Step 1.4
DASHBOARD_PASSWORD=your-strong-password
JWT_SECRET=your-64-char-hex-secret
JWT_EXPIRES_IN=7d

# App config
NODE_ENV=production
LOG_LEVEL=info
DAILY_SEND_LIMIT=50
LEAD_FIND_LIMIT=60
PORT=3000
```

Save: `Ctrl+O` > `Enter` > `Ctrl+X`

### 3.5 Initialize Database

```bash
node db/setup.js
```

Output: `Database initialized successfully.`

This creates `outreach.db` with all 6 tables.

---

## Step 4: Configure Nginx

### 4.1 Create Site Config

```bash
nano /etc/nginx/sites-available/outreach.simpleinc.in
```

Paste:

```nginx
server {
    listen 80;
    server_name outreach.simpleinc.in;

    # Serve built React dashboard
    root /var/www/outreach-agent/dashboard/dist;
    index index.html;

    # React SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Proxy all /api requests to Express
    location /api {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
    }
}
```

### 4.2 Enable the Site

```bash
ln -s /etc/nginx/sites-available/outreach.simpleinc.in /etc/nginx/sites-enabled/
```

Remove default site if it conflicts:
```bash
rm -f /etc/nginx/sites-enabled/default
```

### 4.3 Test & Reload Nginx

```bash
nginx -t
systemctl reload nginx
```

---

## Step 5: SSL Certificate (HTTPS)

Make sure your DNS A record for `outreach.simpleinc.in` points to this server's IP, then:

```bash
certbot --nginx -d outreach.simpleinc.in
```

Follow the prompts:
- Enter email for renewal notices
- Agree to terms
- Select redirect HTTP to HTTPS (option 2)

Certbot auto-modifies your Nginx config to add SSL. Auto-renewal is set up automatically via a systemd timer.

Verify auto-renewal:
```bash
certbot renew --dry-run
```

---

## Step 6: Start with PM2

### 6.1 Start the Application

```bash
cd /var/www/outreach-agent
pm2 start ecosystem.config.js
```

### 6.2 Verify It's Running

```bash
pm2 status
pm2 logs outreach-agent --lines 20
```

You should see:
```
Outreach Agent started — Express API + 7 cron jobs registered
Express API listening on port 3000
```

### 6.3 Enable Auto-Start on Reboot

```bash
pm2 save
pm2 startup
```

PM2 gives you a command to run — copy and execute it. This ensures the app starts on server reboot.

---

## Step 7: Verify Everything

### 7.1 Test Dashboard

Open `https://outreach.simpleinc.in` in your browser.

You should see the login page with the gradient background. Log in with your `DASHBOARD_PASSWORD`.

### 7.2 Test API

```bash
# From the server:
curl -s http://localhost:3000/api/auth/login \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"password":"your-dashboard-password"}' | head -c 100
```

Should return `{"token":"eyJ..."}`.

### 7.3 Test Email Sending (Dry Run)

```bash
cd /var/www/outreach-agent
node src/scripts/testLeadGen.js
```

This calls Claude to find leads without saving to DB — verifies your Anthropic key works.

### 7.4 Check Logs

```bash
# Real-time logs
pm2 logs outreach-agent

# Or read log files
tail -50 /var/www/outreach-agent/logs/app.log
tail -20 /var/www/outreach-agent/logs/error.log
```

---

## Step 8: DNS Records Summary

Add these records at your domain registrar for `simpleinc.in`:

| Type | Name | Value | Purpose |
|------|------|-------|---------|
| A | outreach | YOUR_SERVER_IP | Points subdomain to server |
| CNAME | (from AWS) | (from AWS) | DKIM record 1 |
| CNAME | (from AWS) | (from AWS) | DKIM record 2 |
| CNAME | (from AWS) | (from AWS) | DKIM record 3 |
| TXT | @ | `v=spf1 include:amazonses.com ~all` | SPF for SES |
| TXT | _dmarc | `v=DMARC1; p=none; rua=mailto:darshan@simpleinc.in` | DMARC policy |

The SPF and DMARC records improve email deliverability.

---

## Daily Operations

### Cron Schedule (runs automatically)

| Time (IST) | Job |
|-------------|-----|
| 9:00 AM | Find 60 new leads |
| 9:30 AM | Send cold emails (up to 50) |
| 2:00 PM | Check for replies |
| 4:00 PM | Check for replies again |
| 6:00 PM | Send due follow-ups |
| 8:00 PM | Final reply check |
| 8:30 PM | Generate and send daily report |

### Monitor & Manage

```bash
# View real-time logs
pm2 logs outreach-agent

# Restart after code changes
pm2 restart outreach-agent

# Check process status
pm2 status

# View app metrics (CPU, memory)
pm2 monit
```

### Backup Database

```bash
# Manual backup
cp /var/www/outreach-agent/outreach.db /var/www/outreach-agent/outreach.db.backup

# Automated daily backup (add to crontab)
crontab -e
# Add this line:
0 2 * * * cp /var/www/outreach-agent/outreach.db /var/www/backups/outreach-$(date +\%Y\%m\%d).db
```

### Update Code

```bash
cd /var/www/outreach-agent
git pull origin main
npm install
cd dashboard && npm install && npm run build && cd ..
pm2 restart outreach-agent
```

---

## Troubleshooting

### App won't start
```bash
# Check for syntax errors
node index.js
# Check PM2 error logs
pm2 logs outreach-agent --err --lines 50
```

### Dashboard shows blank page
```bash
# Rebuild the frontend
cd /var/www/outreach-agent/dashboard
npm run build
# Verify dist exists
ls -la dist/
# Reload Nginx
systemctl reload nginx
```

### Emails not sending
```bash
# Check if SES is out of sandbox
# Check app logs for SES errors
grep -i "ses\|smtp\|send" /var/www/outreach-agent/logs/error.log
# Verify SES credentials
node -e "
import 'dotenv/config';
console.log('Host:', process.env.SES_SMTP_HOST);
console.log('User:', process.env.SES_SMTP_USER ? 'SET' : 'MISSING');
console.log('Pass:', process.env.SES_SMTP_PASS ? 'SET' : 'MISSING');
"
```

### IMAP not reading replies
```bash
# Test IMAP connection manually
node -e "
import 'dotenv/config';
import { fetchUnseenEmails } from './src/lib/imap.js';
const emails = await fetchUnseenEmails();
console.log('Found', emails.length, 'unseen emails');
"
```

### SSL certificate renewal fails
```bash
certbot renew --dry-run
# If it fails, check Nginx config
nginx -t
```

### Database is locked
```bash
# This shouldn't happen with WAL mode, but if it does:
pm2 stop outreach-agent
# Wait a moment, then restart
pm2 start outreach-agent
```

---

## Security Checklist

- [ ] `.env` file has restrictive permissions: `chmod 600 .env`
- [ ] `.env` is in `.gitignore` (never committed)
- [ ] Firewall allows only ports 22, 80, 443: `ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw enable`
- [ ] Dashboard password is strong (12+ characters)
- [ ] JWT secret is random 64-char hex
- [ ] SSH uses key-based auth (disable password auth)
- [ ] Server auto-updates enabled: `apt install unattended-upgrades`
- [ ] PM2 runs as non-root user (optional but recommended)

---

## Cost Summary

| Item | Monthly Cost |
|------|-------------|
| Claude API (Sonnet 4) | ~$6-10 (~Rs 500-850) |
| AWS SES (62k free from EC2) | Rs 0 |
| VPS / EC2 free tier | Rs 0 |
| Domain (existing) | Rs 0 |
| SSL (Let's Encrypt) | Rs 0 |
| **Total** | **~Rs 500-850/month** |
