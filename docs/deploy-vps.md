# Deploying Radar to the VPS

Step-by-step runbook for deploying Radar to a fresh (or existing) Ubuntu VPS.
Target: `radar.simpleinc.cloud` on Ubuntu 24.04, PM2-managed, Postgres 16,
Nginx reverse-proxy + Let's Encrypt TLS.

Assumes:
- SSH access to the VPS as a user with `sudo` (we'll call them `darshan`
  below — substitute your actual user)
- Postgres 16 already running at `193.203.163.180:5432` with role
  `outreach_user` + database `outreach_db` (verified working from the Mac)
- Gemini API key, MEV API key, and Telegram bot token ready to paste

---

## Phase 0 — Prereqs (once, skip if done)

### 0.1 SSH in

```bash
ssh darshan@193.203.163.180
# or whatever your SSH alias / user is
```

If you're using a non-standard port or key:
```bash
ssh -p <port> -i ~/.ssh/<key> darshan@193.203.163.180
```

### 0.2 Install Node.js 20 LTS (if missing)

```bash
node --version 2>/dev/null   # check — need v20.x or v22.x
```

If missing:
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node --version   # should print v22.x
```

### 0.3 Install PM2 globally

```bash
sudo npm install -g pm2
pm2 --version   # verify
```

### 0.4 Install git + psql client (probably already there)

```bash
sudo apt install -y git postgresql-client
```

---

## Phase 1 — Clone + configure (first deploy)

### 1.1 Pick a home for the code

```bash
# Either in the login user's home:
cd ~
git clone https://github.com/<your-gh-user>/Outreach.git radar
cd radar
```

If the repo is private, use SSH clone or set up a deploy key:
```bash
git clone git@github.com:<your-gh-user>/Outreach.git radar
```

Checkout the working branch:
```bash
git checkout reach  # or main once merged
git log --oneline -3  # confirm latest commits match your local branch
```

### 1.2 Install dependencies

```bash
npm install   # installs all prod + dev deps
```

If you hit EACCES / permission errors, you're probably running as root — switch
to the login user (`su darshan`) or `chown -R darshan:darshan ~/radar`.

### 1.3 Build the dashboard SPA

The Express server serves `web/dist/` statically. Build it:

```bash
cd web
npm install
npm run build   # produces web/dist/index.html + assets
cd ..
```

### 1.4 Generate Prisma Client

```bash
npx prisma generate
# Must run ONCE per deploy so the Prisma binary matches the schema
```

### 1.5 Apply migrations to production DB

Migrations are idempotent. If the DB already has all 14 tables (it does,
from our Mac-side `prisma migrate deploy`), this is a no-op:

```bash
npx prisma migrate deploy
# Expected: "No pending migrations to apply." if already done.
```

If you want to verify from psql:
```bash
psql "postgresql://outreach_user:Drp%402011@127.0.0.1:5432/outreach_db" -c "\dt"
# If Postgres is ON this VPS, use 127.0.0.1. If it's a separate host, use the IP.
# Expect 15 tables (14 app + _prisma_migrations).
```

---

## Phase 2 — Production `.env` on the VPS

The `.env` on your Mac has dev passwords and keys. Production needs its own
set of values, NOT a copy-paste of the Mac version.

### 2.1 Copy the template and fill it in

```bash
cp .env.example .env
nano .env   # or vim, whichever you use
```

Fill these values on the VPS (the critical ones):

```bash
# ── OUTREACH IDENTITY ──
OUTREACH_DOMAIN=trysimpleinc.com

# ── INBOXES (GWS app passwords — 2FA must be on) ──
INBOX_1_USER=darshan@trysimpleinc.com
INBOX_1_PASS=<actual 16-char app password>
INBOX_2_USER=hello@trysimpleinc.com
INBOX_2_PASS=<actual 16-char app password>

# ── AI MODELS ──
GEMINI_API_KEY=<your Gemini API key>
GEMINI_MODEL=gemini-2.5-flash
ANTHROPIC_DISABLED=true
ANTHROPIC_API_KEY=
MODEL_HOOK=claude-sonnet-4-20250514
MODEL_BODY=claude-haiku-4-5-20251001
MODEL_CLASSIFY=claude-haiku-4-5-20251001
CLAUDE_DAILY_SPEND_CAP=5.00

# ── EMAIL VERIFICATION ──
MEV_API_KEY=<your MEV API key>

# ── ALERTS ──
TELEGRAM_BOT_TOKEN=<BotFather token>
TELEGRAM_CHAT_ID=<your chat id>

# ── SAFETY (CLAUDE.md §13 non-negotiables — do not weaken) ──
DAILY_SEND_LIMIT=0    # keep at 0 until you're ready to send
MAX_PER_INBOX=17
SEND_DELAY_MIN_MS=180000
SEND_DELAY_MAX_MS=420000
SEND_WINDOW_START_IST=9
SEND_WINDOW_END_IST=17
BOUNCE_RATE_HARD_STOP=0.02
SPAM_RATE_HARD_STOP=0.001
MAX_EMAIL_WORDS=90
MIN_EMAIL_WORDS=40
DISABLE_OPEN_TRACKING=true
DISABLE_CLICK_TRACKING=true
HTML_EMAIL=false
SPAM_WORDS=free,guarantee,100%,winner,act now,click here,buy now,discount,offer,risk-free

# ── DATABASE (Postgres — localhost-only if Pg is on this VPS) ──
DATABASE_URL="postgresql://outreach_user:Drp%402011@127.0.0.1:5432/outreach_db"
# DATABASE_URL_TEST only needed if running tests on the VPS (not usual)

# ── DASHBOARD ──
DASHBOARD_PORT=3001
DASHBOARD_URL=https://radar.simpleinc.cloud
DASHBOARD_PASSWORD=<pick a strong password — 16+ chars>
JWT_SECRET=<64 random hex chars — `openssl rand -hex 32`>
JWT_EXPIRES_IN=7d
```

Generate a secure JWT secret on the VPS itself:
```bash
openssl rand -hex 32
# paste the output into JWT_SECRET=
```

Lock the file down:
```bash
chmod 600 .env
```

### 2.2 `~/.pgpass` for backup script

The cron-run `backup.sh` invokes `pg_dump` under shell cron, which doesn't
have PM2's env. Postgres reads `~/.pgpass` for credentials:

```bash
echo "127.0.0.1:5432:outreach_db:outreach_user:Drp@2011" > ~/.pgpass
chmod 600 ~/.pgpass
# Test:
pg_dump -h 127.0.0.1 -U outreach_user -d outreach_db --schema-only | head -5
# Should dump schema without prompting for password
```

Replace `127.0.0.1` with `193.203.163.180` if Postgres is on a separate host.

---

## Phase 3 — Seed starter data (first deploy only)

If you want the Offer + ICP Profile + niches + config + rubric pre-filled
with the Simple Inc defaults from `scripts/seedStarterSettings.js`:

```bash
node scripts/seedStarterSettings.js
# Expected: "✅ Offer seeded", "✅ ICP Profile seeded", etc.
```

If you've already been filling these via the dashboard locally and pushed to
the same Postgres that the VPS uses, **skip this step** — the data is already
there (and the seeder is idempotent, but still, no need).

Since our current VPS Postgres already has the seed data from my run on the
Mac earlier, this is a no-op today — just verify:

```bash
psql "postgresql://outreach_user:Drp%402011@127.0.0.1:5432/outreach_db" \
  -c "SELECT CASE WHEN problem IS NOT NULL THEN 'configured' ELSE 'empty' END AS offer_state FROM offer WHERE id=1;"
# Expect: offer_state = 'configured'
```

---

## Phase 4 — Start PM2 processes

### 4.1 Start both processes

```bash
cd ~/radar
pm2 start infra/ecosystem.config.js
```

This launches two processes defined in `infra/ecosystem.config.js`:
- `radar-cron` → `src/scheduler/cron.js` (the 9-schedule node-cron)
- `radar-dashboard` → `src/api/server.js` (Express API on :3001, also serves SPA)

Verify:
```bash
pm2 list
# Expect both processes in status 'online'
```

### 4.2 Save PM2 state + enable on boot

```bash
pm2 save
pm2 startup
# Read the command it prints — copy-paste and run it with sudo.
# Example: sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u darshan --hp /home/darshan
```

Now PM2 will auto-restart both processes on VPS reboot.

### 4.3 Tail logs for first-boot issues

```bash
pm2 logs radar-cron --lines 20
pm2 logs radar-dashboard --lines 20
```

Expected output:
- `radar-cron`: `Radar cron started`
- `radar-dashboard`: `Radar dashboard running on port 3001`

If you see Prisma connection errors, double-check `DATABASE_URL` in `.env`
and that `npx prisma generate` succeeded.

### 4.4 Test the API locally on the VPS

```bash
curl -s http://127.0.0.1:3001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"password":"<YOUR_DASHBOARD_PASSWORD>"}'
# Expected: {"token":"eyJhbG..."}
```

If that returns a token, the backend is serving correctly on localhost.

---

## Phase 5 — Nginx reverse-proxy + TLS

### 5.1 Install Nginx + Certbot

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

### 5.2 Nginx server block

```bash
sudo nano /etc/nginx/sites-available/radar.simpleinc.cloud
```

Paste:

```nginx
server {
    listen 80;
    server_name radar.simpleinc.cloud;

    # Redirect all HTTP to HTTPS (Certbot will rewrite after cert issuance)
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;   # findLeads runs can take minutes
        proxy_connect_timeout 30s;
    }

    # Reasonable body limit — offer/icp-profile forms aren't huge
    client_max_body_size 1m;
}
```

Enable + reload:
```bash
sudo ln -s /etc/nginx/sites-available/radar.simpleinc.cloud /etc/nginx/sites-enabled/
sudo nginx -t   # config test
sudo systemctl reload nginx
```

### 5.3 Point DNS

At your DNS provider, create an `A` record:
- **Name:** `radar` (or `radar.simpleinc.cloud` depending on the UI)
- **Type:** A
- **Value:** `193.203.163.180` (your VPS public IP)
- **TTL:** 300 (so you can iterate quickly)

Wait 1-5 minutes, verify:
```bash
dig +short radar.simpleinc.cloud
# Expect: 193.203.163.180
```

### 5.4 Issue TLS cert

```bash
sudo certbot --nginx -d radar.simpleinc.cloud
# Follow prompts: enter email, agree to TOS, choose "Redirect HTTP to HTTPS"
```

Certbot edits the Nginx config in place, issues a cert from Let's Encrypt,
and sets up auto-renewal via `systemd-timers`. Verify:

```bash
sudo systemctl status certbot.timer
# Should be 'active (waiting)'
```

### 5.5 Hit it from your laptop

```bash
curl -I https://radar.simpleinc.cloud
# Expect: HTTP/2 200 OK (or 302 if you hit /)
```

Or just open https://radar.simpleinc.cloud in a browser — should serve the
React dashboard login page. Log in with the `DASHBOARD_PASSWORD` you set in
`.env`.

---

## Phase 6 — rclone + B2 for backups (optional but recommended)

### 6.1 Install rclone

```bash
curl https://rclone.org/install.sh | sudo bash
rclone version
```

### 6.2 Configure B2 remote

You'll need a Backblaze B2 application key (create at backblaze.com):
- `keyID`
- `applicationKey`
- bucket name (e.g. `radar-backups`)

```bash
rclone config
# Interactive:
#   n) New remote
#   name> b2
#   Storage> b2   (Backblaze B2)
#   account> <keyID>
#   key> <applicationKey>
#   hard_delete> false
#   ... accept defaults
```

Test:
```bash
rclone lsd b2:radar-backups
# Should succeed (empty or listing existing backups)
```

### 6.3 Verify backup.sh works

The `infra/backup.sh` script is invoked by the `radar-cron` process at 2 AM IST.
Test it manually once:

```bash
cd ~/radar
./infra/backup.sh
# Expect: pg_dump streams to stdout, rclone rcat pushes to b2:radar-backups/radar-YYYYMMDD-HHMMSS.dump
```

Verify in B2:
```bash
rclone lsf b2:radar-backups | head -3
# Expect the new .dump file
```

If this fails, common causes:
- `~/.pgpass` not set or wrong perms
- `rclone` remote not named `b2:` (match what the script expects)
- `radar-backups` bucket doesn't exist

---

## Phase 7 — First scheduled run verification

After PM2 is running, wait for the next scheduled time or check historical
runs from the dashboard trigger:

```bash
psql "postgresql://outreach_user:Drp%402011@127.0.0.1:5432/outreach_db" \
  -c "SELECT job_name, status, started_at, duration_ms FROM cron_log ORDER BY id DESC LIMIT 10;"
```

At 09:00 IST tomorrow (or whatever the next scheduled time is in
`src/scheduler/cron.js`), a new row should appear with `started_at` within
10s of the scheduled time.

---

## Phase 8 — Sending switch-on (when you're ready)

**DO NOT** flip `DAILY_SEND_LIMIT` until you've:

1. Confirmed `trysimpleinc.com` is NOT blacklisted (already verified ✓)
2. Done SPF + DKIM + DMARC DNS setup for `trysimpleinc.com`
3. Run a mail-tester.com sanity check (upload at least one email manually
   via the dashboard's Send Log page, score must be ≥9/10)
4. Warmed the domain via Instantly or similar for 4 weeks (per CLAUDE.md §8)
5. Reviewed the first batch of drafted emails in `/send-log` (status='pending')
   and confirmed copy quality

When ready, flip the switch:

```bash
# Via dashboard: go to /settings/engines and set daily_send_limit to a small number like 5
# OR via psql:
psql "postgresql://outreach_user:Drp%402011@127.0.0.1:5432/outreach_db" \
  -c "UPDATE config SET value='5' WHERE key='daily_send_limit';"
```

Also update the `.env` override:
```bash
nano ~/radar/.env
# Change DAILY_SEND_LIMIT=0 to DAILY_SEND_LIMIT=5
pm2 restart radar-cron radar-dashboard
```

Starting low (5/day) and ramping to 34/day over 4 weeks is the plan per
CLAUDE.md §8 Phase 1.

---

## Phase 9 — Ongoing operations

### Deploy a new version

```bash
cd ~/radar
git pull origin reach
npm install                    # if deps changed
cd web && npm install && npm run build && cd ..   # rebuild SPA if web/ changed
npx prisma generate            # if schema changed
npx prisma migrate deploy      # if new migrations present
pm2 restart radar-cron radar-dashboard
pm2 logs --lines 20           # verify clean boot
```

### Check health

```bash
pm2 list                      # both processes 'online'
pm2 logs radar-cron --lines 50
psql "$DATABASE_URL" -c "SELECT job_name, status, started_at FROM cron_log ORDER BY id DESC LIMIT 10;"
```

### Pause sending (emergency kill switch)

From the dashboard Engine Config page, OR:
```bash
psql "$DATABASE_URL" -c "UPDATE config SET value='0' WHERE key='daily_send_limit';"
# No restart needed — sendEmails reads this on every run
```

### View alerts

Check your Telegram chat for alerts from `TELEGRAM_CHAT_ID` — the system
posts pipeline summaries, bounce warnings, blacklist flags, and daily
reports automatically.

---

## Common issues

| Symptom | Cause | Fix |
|---|---|---|
| `pm2 list` shows 'errored' | Prisma binary mismatch | `npx prisma generate` then `pm2 restart` |
| Dashboard returns 502 | Backend not running | `pm2 start infra/ecosystem.config.js` |
| Dashboard returns 404 for `/leads` | SPA not built | `cd web && npm run build` |
| Login returns 401 with correct password | `JWT_SECRET` changed since last login — localStorage token stale | Clear browser localStorage, login again |
| `findLeads` fail_fast "offer.problem not configured" | Seeder not run on this DB | `node scripts/seedStarterSettings.js` |
| Nginx 500 on Certbot step | Port 80 blocked by firewall | `sudo ufw allow 80/tcp && sudo ufw allow 443/tcp` |
| Cron not firing at scheduled time | `radar-cron` not running, or VPS clock in wrong TZ | `pm2 list` + `timedatectl` (TZ should be UTC; Asia/Kolkata is handled per-cron by node-cron) |
| Backups not appearing in B2 | `~/.pgpass` wrong, or rclone remote not 'b2' | Run `./infra/backup.sh` manually to see error |

---

## Quick-reference checklist

Paste this into your SSH session and work through it top-to-bottom on the
first deploy:

- [ ] Node 22 LTS installed
- [ ] PM2 installed globally
- [ ] Repo cloned to `~/radar`, branch `reach` checked out
- [ ] `npm install` clean
- [ ] `cd web && npm install && npm run build` clean
- [ ] `npx prisma generate` clean
- [ ] `.env` populated with production secrets (all keys non-empty except `ANTHROPIC_API_KEY`)
- [ ] `.env` chmod 600
- [ ] `~/.pgpass` written, chmod 600
- [ ] `pm2 start infra/ecosystem.config.js` — both processes 'online'
- [ ] `pm2 save` + `pm2 startup` command run with sudo
- [ ] Nginx + Certbot — `https://radar.simpleinc.cloud` serves the login page
- [ ] rclone B2 remote configured, `./infra/backup.sh` tested manually
- [ ] First `findLeads` cron entry appears in `cron_log` at the next scheduled time
- [ ] Telegram alert received from `dailyReport` at 20:30 IST

Once all boxes ticked, the VPS is autonomous — PM2 restarts processes on
crashes, systemd restarts PM2 on reboots, Certbot auto-renews TLS, and
cron fires on schedule.
