# Production Deployment Runbook

How to take Radar from a clean checkout to a running production instance on the VPS at `radar.simpleinc.cloud`.

## Prerequisites

- Ubuntu 22.04+ VPS with at least 2GB RAM
- Node.js 20 LTS, npm 10+
- PostgreSQL 14+ with the `radar` database created
- Redis 7+ running on `localhost:6379`
- Nginx with TLS via Let's Encrypt
- PM2 installed globally: `npm install -g pm2`

## 1. Environment

Copy `.env.example` → `.env` and fill in REAL values:

```env
# JWT — required, must be ≥32 chars and NOT the default. Generate with:
#   openssl rand -hex 32
JWT_SECRET=<64-char-hex>
JWT_EXPIRES_IN=7d

# Dashboard password — used only by the legacy auth flow (single-tenant
# operator console). Productized customers don't use this — they sign in
# via Google OAuth or OTP. Still required by the legacy server to boot.
DASHBOARD_PASSWORD=<strong-random-password>

# Database
DATABASE_URL=postgresql://radar_user:<password>@localhost:5432/radar

# Redis
REDIS_URL=redis://localhost:6379

# Google OAuth (optional — leave blank to disable, OTP still works)
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
GOOGLE_CALLBACK_URL=https://radar.simpleinc.cloud/auth/google/callback

# Razorpay — fill all 3 from dashboard, see razorpay-setup.md
RAZORPAY_KEY_ID=rzp_live_...
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=<openssl rand -hex 32, paste in dashboard too>

# Production cookie domain
NODE_ENV=production
DASHBOARD_URL=https://radar.simpleinc.cloud
DASHBOARD_PORT=3002

# CORS — comma-separated allowlist. Production has just the dashboard domain.
CORS_ALLOWED_ORIGINS=https://radar.simpleinc.cloud

# Telegram alerts (optional but strongly recommended for ops)
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...

# AI / engine secrets (existing — preserve from current deploy)
GEMINI_API_KEY=...
ANTHROPIC_API_KEY=...
INBOX_1_USER=darshan@trysimpleinc.com
INBOX_1_PASS=<gws app password>
# ... etc
```

**The server REFUSES to boot if `JWT_SECRET` or `DASHBOARD_PASSWORD` is missing or set to a known-insecure default.**

## 2. Build

```bash
cd /home/radar/Outreach
git pull origin main
npm install
npm run build:shared
npm run build:api
npm run build:web
```

Verify outputs:
- `packages/shared/dist/index.js` exists
- `apps/api/dist/server.js` exists
- `apps/api/dist/workers/index.js` exists
- `apps/web/dist/index.html` exists

## 3. Migrate database

```bash
npx prisma migrate deploy --schema=prisma/schema.prisma
```

Verify with:
```bash
psql $DATABASE_URL -c "\d orgs"
psql $DATABASE_URL -c "SELECT count(*) FROM plans"  # expect 4
```

## 4. Nginx config

Copy `infra/nginx-radar.conf` → `/etc/nginx/sites-available/radar`, symlink to `sites-enabled`, ensure the WebSocket map is in `nginx.conf`'s `http {}` block:

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
```

Issue a TLS cert:
```bash
certbot --nginx -d radar.simpleinc.cloud
```

Test + reload:
```bash
nginx -t && systemctl reload nginx
```

## 5. PM2 — start the v2 stack

```bash
pm2 start infra/ecosystem.config.cjs --only radar-api-v2,radar-workers-v2,radar-dashboard
pm2 save
pm2 startup  # follow the printed command to install systemd unit
```

**Do NOT start `radar-cron-legacy`** — `radar-workers-v2` owns the schedule. Running both will duplicate every email send.

Verify:
```bash
pm2 list
pm2 logs radar-api-v2 --lines 30
pm2 logs radar-workers-v2 --lines 30
```

You should see:
- `radar-api-v2`: `Radar API started` on port 3002
- `radar-workers-v2`: `workers booting` (count: 7), `scheduler started`
- `radar-dashboard`: `Radar dashboard running on port 3001`, `Radar legacy cron module loaded but schedules NOT registered`

## 6. Smoke tests

```bash
# Public health check
curl https://radar.simpleinc.cloud/health
# {"ok":true,"ts":...}

# Auth: send yourself an OTP
curl -X POST https://radar.simpleinc.cloud/api/otp/send \
  -H "Content-Type: application/json" \
  -d '{"email":"darshanrajeshparmar@gmail.com"}'
# {"message":"OTP sent"}

# Browse to https://radar.simpleinc.cloud/login → enter email → check inbox →
# enter 6-digit code → land on dashboard
```

## 7. Post-deploy verification

After 24 hours of running, verify:

```bash
# No legacy cron firings
psql $DATABASE_URL -c "
  SELECT job_name, count(*) FROM cron_log
  WHERE started_at > NOW() - INTERVAL '24 hours'
  GROUP BY job_name ORDER BY job_name;
"
# Each engine should appear exactly the number of times its schedule expects.
# If any appears 2× the expected count → both schedulers are firing. Fix immediately.

# Check failed jobs
pm2 logs radar-workers-v2 --lines 200 | grep -i "fail\|error"

# Bull Board
# Browse to https://radar.simpleinc.cloud/admin/queues (must be logged in as superadmin)
```

## 8. Backups

The cron-driven `backup.sh` (legacy script that uses rclone → Backblaze B2) runs at 02:00 IST daily:
```bash
crontab -e
# 0 2 * * *  /home/radar/Outreach/infra/backup.sh > /var/log/radar-backup.log 2>&1
```

Verify a backup is uploaded:
```bash
rclone ls b2:radar-backups | tail -3
```

Test a restore on a separate DB at least once per quarter.

## 9. Rolling deploys

For zero-downtime updates:

```bash
git pull origin main
npm install
npm run build:shared && npm run build:api && npm run build:web
npx prisma migrate deploy

# PM2 reload (zero-downtime cluster reload)
pm2 reload radar-api-v2
pm2 reload radar-workers-v2
pm2 reload radar-dashboard
```

If a migration changes a schema in a non-additive way (column drops, type changes), do a maintenance window:
```bash
pm2 stop all
npx prisma migrate deploy
pm2 start all
```

## 10. Common issues

### "JWT_SECRET is missing or set to a known-insecure default"
The server refused to boot. Set a real `JWT_SECRET` in `.env` (≥32 chars, NOT the example value).

### "Refusing to run findLeads: 2 active orgs detected"
The multi-tenant guard is working correctly — engines are still single-tenant. See `docs/runbooks/multi-tenant-pipeline-migration.md`. Either deactivate the 2nd org or complete the migration.

### Razorpay webhook returns 400 "Invalid signature"
Either `RAZORPAY_WEBHOOK_SECRET` doesn't match the value in Razorpay dashboard, OR the request was tampered en route, OR there's a body-parser stripping whitespace before HMAC. Check `Express.json({ verify })` is intact in `server.ts`.

### Cookies not setting on login
Production requires HTTPS — cookies have `secure: true` automatically when `NODE_ENV=production`. Verify TLS cert is valid: `curl -I https://radar.simpleinc.cloud/health`.

### Worker job stuck in "running" forever
A previous worker process crashed mid-job. The legacy cron's stale-lock sweeper auto-recovers these on boot if you start `radar-cron-legacy` once. Or manually:
```sql
UPDATE cron_log SET status='failed', completed_at=NOW(), error_message='manual recovery'
WHERE status='running' AND started_at < NOW() - INTERVAL '1 hour';
```

### Telegram alert spam from worker failures
`apps/api/src/workers/index.ts` only alerts after BullMQ exhausts all retries (3 attempts by default). If you get spam, the underlying error is real — check Bull Board for the failure message. Disable temporarily by unsetting `TELEGRAM_BOT_TOKEN`.

## 11. Onboarding a new customer (manual provisioning, no signup yet)

Until self-serve signup is fully wired with billing UI:

```bash
# Connect to prod DB
psql $DATABASE_URL

# Create the org
INSERT INTO orgs (name, slug, status) VALUES ('Acme Corp', 'acme-corp', 'trial')
  RETURNING id;
-- note the new org id

# Create an admin user (or upsert the email)
INSERT INTO users (email) VALUES ('founder@acme.com') RETURNING id;
-- note the user id

# Add the membership
INSERT INTO org_memberships (org_id, user_id, role)
  VALUES (<new_org_id>, <new_user_id>, 'owner');

# Trial subscription (14-day from now)
INSERT INTO org_subscriptions (org_id, plan_id, status, trial_ends_at)
  VALUES (<new_org_id>, 1, 'trial', NOW() + INTERVAL '14 days');
```

⚠️ **Do not flip the org's `status` from `trial` to `active` until the multi-tenant pipeline migration is complete** (see `multi-tenant-pipeline-migration.md`). The runtime guard will refuse to run engines for >1 active org.

## 12. Going off-call

You should set up monitoring for at minimum:

- Uptime: `https://radar.simpleinc.cloud/health` returns 200 every minute
- Disk: `/var/log` and `/var/lib/postgresql` not above 80%
- Postgres connections: `SELECT count(*) FROM pg_stat_activity` < 80
- Bounce rate: `SELECT bounce_rate FROM daily_metrics ORDER BY date DESC LIMIT 1` < 0.02
- Telegram: bot is online (`/start` returns a message)

The Telegram alert on worker failures is the minimum operational signal. Add Sentry or Datadog when you have a quiet weekend.
