# CLAUDE.md — Outreach Agent

## Project Overview

**Name:** Outreach Agent
**Hosted at:** `outreach.simpleinc.in`
**Owner:** Darshan Parmar — Full-Stack Developer, Simple Inc
**Purpose:** Fully automated cold email outreach system. Finds leads daily, writes hyper-personalized emails using Claude AI, sends via AWS SES, monitors replies via Zoho IMAP, runs follow-up sequences, delivers a daily report to owner's personal email, and exposes a React dashboard at `outreach.simpleinc.in` for full pipeline + cost analytics.

---

## Owner Profile (Used in All Email Generation)

```
Name: Darshan Parmar
Company: Simple Inc
Website: https://www.simpleinc.in
Email: darshan@simpleinc.in
Role: Full-Stack Web Developer & Agency Owner
Experience: 4+ years
Skills: React, Vue, NestJS, Node.js, WordPress, PHP, Shopify Liquid, Headless CMS, Multi-tenant SaaS
Notable work: Custom WordPress plugins, SaaS platforms, ERP systems, e-commerce builds
Value proposition: End-to-end web development — fast delivery, clean code, modern stack
Tone: Direct, professional, no fluff
```

---

## Tech Stack

### Backend (Automation Engine)

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 20 |
| Language | JavaScript (ESM) |
| Scheduler | node-cron |
| Database | SQLite via better-sqlite3 |
| Email Send | Nodemailer + AWS SES SMTP |
| Email Receive | imapflow + mailparser |
| AI | Anthropic SDK (claude-sonnet-4-20250514) |
| Web Search | Anthropic web_search_20250305 tool |
| HTTP API | Express.js (serves dashboard data) |
| Auth | JWT (single token, stored in .env) |
| Process Manager | PM2 |
| Web Server | Nginx (reverse proxy) |
| SSL | Certbot |
| Logging | Winston |
| Hosting | Ubuntu VPS or AWS EC2 |

### Frontend (Dashboard)

| Layer | Technology |
|-------|-----------|
| Framework | React 18 (Vite) |
| Charts | Recharts |
| Font | IBM Plex Mono (Google Fonts) |
| Auth | Password login — JWT stored in localStorage |
| Build output | `dashboard/dist` — served by Nginx as static files |

---

## Full Project Structure

```
/var/www/outreach-agent/
├── CLAUDE.md                        # This file
├── Prompts.md                       # All Claude AI prompts
├── .env                             # Secrets (never commit)
├── .env.example                     # Commit this
├── .gitignore
├── package.json                     # Backend deps
├── ecosystem.config.js              # PM2 config
├── index.js                         # Entry: starts Express + registers cron jobs
│
├── db/
│   ├── schema.sql                   # Full SQLite schema
│   ├── setup.js                     # Run once on deploy: creates DB + tables
│   └── database.js                  # DB singleton + query helpers
│
├── src/
│   ├── jobs/
│   │   ├── findLeads.js             # Job 1: Find 60 leads via Claude web search
│   │   ├── sendEmails.js            # Job 2: Generate + send 50 emails via SES
│   │   ├── checkReplies.js          # Job 3: IMAP monitor + classify + alert
│   │   ├── sendFollowups.js         # Job 4: Day 3, 7, 14 follow-up sequences
│   │   └── dailyReport.js           # Job 5: HTML report → DB → personal email
│   │
│   ├── api/
│   │   ├── router.js                # Mounts all API routes on Express
│   │   ├── auth.js                  # POST /api/auth/login
│   │   ├── middleware.js            # JWT verify middleware
│   │   ├── overview.js              # GET /api/overview
│   │   ├── pipeline.js              # GET /api/pipeline, PATCH /api/pipeline/:id/status
│   │   ├── analytics.js             # GET /api/analytics
│   │   ├── costs.js                 # GET /api/costs, GET /api/costs/chart
│   │   ├── reports.js               # GET /api/reports, GET /api/reports/:date
│   │   └── emails.js                # GET /api/emails, GET /api/emails/:id
│   │
│   ├── lib/
│   │   ├── claude.js                # Anthropic SDK wrapper — all AI calls go here
│   │   ├── mailer.js                # Nodemailer + SES SMTP
│   │   ├── imap.js                  # imapflow IMAP reader
│   │   └── logger.js                # Winston logger
│   │
│   └── utils/
│       ├── emailVerifier.js         # dns.resolveMx() check before send
│       ├── delay.js                 # Random 90–180s delay between sends
│       ├── costTracker.js           # Log every API call + tokens to api_costs table
│       └── templateBuilder.js       # Build HTML daily report email
│
├── dashboard/                       # React frontend (Vite)
│   ├── package.json
│   ├── vite.config.js
│   ├── index.html
│   └── src/
│       ├── main.jsx
│       ├── App.jsx                  # Routes: Login + protected Dashboard
│       ├── api.js                   # All fetch() wrappers for Express endpoints
│       ├── components/
│       │   ├── Sidebar.jsx          # Nav with hot lead badge counter
│       │   ├── StatCard.jsx         # Reusable metric card
│       │   ├── Badge.jsx            # Lead status badge with color coding
│       │   └── CustomTooltip.jsx    # Recharts tooltip
│       └── views/
│           ├── Login.jsx            # Password screen
│           ├── Overview.jsx         # Hot alerts + stats + 7-day chart
│           ├── Pipeline.jsx         # Kanban board — 7 status columns
│           ├── Analytics.jsx        # Funnel + category bar + sequence rates
│           ├── Costs.jsx            # Budget progress + breakdown + ROI
│           ├── Reports.jsx          # Daily report list + HTML viewer
│           └── Emails.jsx           # Sent email log + body preview
│
└── logs/
    ├── app.log
    └── error.log
```

---

## Environment Variables (.env)

```env
# Anthropic
ANTHROPIC_API_KEY=

# AWS SES SMTP (Mumbai region)
SES_SMTP_HOST=email-smtp.ap-south-1.amazonaws.com
SES_SMTP_PORT=587
SES_SMTP_USER=
SES_SMTP_PASS=
SES_FROM_EMAIL=darshan@simpleinc.in
SES_FROM_NAME=Darshan Parmar

# Zoho IMAP (receiving replies)
IMAP_HOST=imap.zoho.in
IMAP_PORT=993
IMAP_USER=darshan@simpleinc.in
IMAP_PASS=

# Personal email for daily reports + hot lead alerts
REPORT_EMAIL=your.personal@gmail.com

# Dashboard auth
DASHBOARD_PASSWORD=your_strong_password_here
JWT_SECRET=your_random_64char_secret_here
JWT_EXPIRES_IN=7d

# App config
NODE_ENV=production
LOG_LEVEL=info
DAILY_SEND_LIMIT=50
LEAD_FIND_LIMIT=60
PORT=3000
```

---

## Database Schema

```sql
-- leads: every prospect found by the lead finder
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  company TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  type TEXT,                          -- 'mumbai_biz' | 'startup' | 'agency' | 'international'
  location TEXT,
  website TEXT,
  pain_point TEXT,
  source TEXT,                        -- search query that found this lead
  email_verified INTEGER DEFAULT 0,   -- 1 if MX record valid
  created_at TEXT DEFAULT (datetime('now'))
);

-- emails: every email sent including all follow-up sequences
CREATE TABLE IF NOT EXISTS emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER REFERENCES leads(id),
  sequence INTEGER DEFAULT 1,         -- 1=cold, 2=day3, 3=day7, 4=day14
  subject TEXT,
  body TEXT,
  sent_at TEXT,
  status TEXT DEFAULT 'pending',      -- 'pending' | 'sent' | 'bounced' | 'failed'
  ses_message_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- replies: every inbound reply received + classified
CREATE TABLE IF NOT EXISTS replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_id INTEGER REFERENCES emails(id),
  lead_id INTEGER REFERENCES leads(id),
  received_at TEXT,
  raw_subject TEXT,
  raw_body TEXT,
  classification TEXT,                -- 'hot' | 'schedule' | 'soft' | 'unsubscribe' | 'ooo' | 'other'
  summary TEXT,                       -- Claude's one-line summary of the reply
  alerted INTEGER DEFAULT 0,          -- 1 if alert email already sent
  created_at TEXT DEFAULT (datetime('now'))
);

-- pipeline: current status of each lead relationship
CREATE TABLE IF NOT EXISTS pipeline (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER UNIQUE REFERENCES leads(id),
  status TEXT DEFAULT 'cold',         -- 'cold' | 'contacted' | 'hot' | 'schedule' | 'soft' | 'closed' | 'rejected' | 'dormant'
  last_contacted_at TEXT,
  next_followup_at TEXT,
  next_followup_sequence INTEGER DEFAULT 2,
  notes TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- api_costs: log every Claude API call for cost tracking dashboard
CREATE TABLE IF NOT EXISTS api_costs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job TEXT NOT NULL,                  -- 'lead_gen' | 'email_write' | 'classify' | 'alert' | 'report'
  model TEXT DEFAULT 'claude-sonnet-4-20250514',
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cost_usd REAL DEFAULT 0,
  called_at TEXT DEFAULT (datetime('now'))
);

-- daily_reports: store generated HTML so dashboard can show historical reports
CREATE TABLE IF NOT EXISTS daily_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_date TEXT UNIQUE NOT NULL,   -- 'YYYY-MM-DD'
  sent_count INTEGER DEFAULT 0,
  bounce_count INTEGER DEFAULT 0,
  reply_count INTEGER DEFAULT 0,
  hot_count INTEGER DEFAULT 0,
  schedule_count INTEGER DEFAULT 0,
  followup_count INTEGER DEFAULT 0,
  html_body TEXT,                     -- full HTML of the report email
  created_at TEXT DEFAULT (datetime('now'))
);
```

---

## Express API Routes

All routes except `POST /api/auth/login` require `Authorization: Bearer <token>` header.

```
POST   /api/auth/login              Body: { password } → { token }

GET    /api/overview                Hot leads, today stats, 7-day chart data
GET    /api/pipeline                All leads grouped by status with email history
GET    /api/pipeline/:id            Single lead — full detail + sent emails + replies
PATCH  /api/pipeline/:id/status     Body: { status } — manual status update from dashboard

GET    /api/analytics               Funnel data, by-category stats, by-sequence rates
GET    /api/costs                   Today/week/month totals, per-unit costs, breakdown by job
GET    /api/costs/chart             Daily cost array for last 30 days (for line chart)

GET    /api/reports                 List: [{ date, sent, replies, hot, schedule }]
GET    /api/reports/:date           Full HTML body for that date's report

GET    /api/emails                  Paginated sent email log (?page=1&limit=20)
GET    /api/emails/:id              Single email with full body
```

---

## Cron Schedule (index.js)

```javascript
// 9:00 AM IST — Find new leads
cron.schedule('0 9 * * *', () => findLeads(), { timezone: 'Asia/Kolkata' });

// 9:30 AM IST — Generate + send emails (runs async, spreads over 4hrs internally)
cron.schedule('30 9 * * *', () => sendEmails(), { timezone: 'Asia/Kolkata' });

// 2:00 PM IST — Check replies
cron.schedule('0 14 * * *', () => checkReplies(), { timezone: 'Asia/Kolkata' });

// 4:00 PM IST — Check replies again
cron.schedule('0 16 * * *', () => checkReplies(), { timezone: 'Asia/Kolkata' });

// 6:00 PM IST — Send due follow-ups
cron.schedule('0 18 * * *', () => sendFollowups(), { timezone: 'Asia/Kolkata' });

// 8:00 PM IST — Final reply check
cron.schedule('0 20 * * *', () => checkReplies(), { timezone: 'Asia/Kolkata' });

// 8:30 PM IST — Generate + send daily report
cron.schedule('30 20 * * *', () => dailyReport(), { timezone: 'Asia/Kolkata' });
```

---

## Lead Target Categories (Rotated Daily)

| Day | Category | Search Query |
|-----|----------|-------------|
| Mon | Mumbai local businesses | "Mumbai small business owner no website OR outdated website" |
| Tue | Indian startups | "Indian B2B startup CTO hiring freelance React developer remote" |
| Wed | Small digital agencies | "Mumbai digital marketing agency outsource web development overflow" |
| Thu | International clients | "UK OR Australia small business website redesign freelance developer" |
| Fri | E-commerce brands | "India D2C ecommerce brand Shopify developer needed" |
| Sat | Real estate / finance | "Mumbai real estate agency property portal web developer" |
| Sun | Healthcare / education | "India edtech OR healthtech startup MVP web developer freelance" |

---

## Email Sequence Rules

| Sequence | Day | Trigger | Max Length |
|----------|-----|---------|-----------|
| 1 — Cold outreach | Day 0 | Lead verified + added to pipeline | 150 words |
| 2 — Bump | Day 3 | No reply to seq 1 | 30 words |
| 3 — Value add | Day 7 | No reply to seq 2 | 80 words |
| 4 — Breakup | Day 14 | No reply to seq 3 | 50 words |

After sequence 4 with no reply → `status = dormant`. Revisit in 90 days.

---

## Reply Classification Logic

| Class | Trigger signals | Action |
|-------|----------------|--------|
| `hot` | "interested", "what's your rate", "sounds good", "let's discuss", "can you help" | Alert email → pipeline = hot |
| `schedule` | "call", "meet", "zoom", "calendar", "availability", "when are you free" | Alert email → pipeline = schedule |
| `soft` | "maybe later", "not now", "send portfolio", "reach out in X months" | Queue 14-day followup → pipeline = soft |
| `unsubscribe` | "not interested", "remove me", "unsubscribe", "stop emailing" | pipeline = rejected, never contact again |
| `ooo` | "out of office", "on leave", "vacation", "automatic reply" | Re-queue original sequence +5 days |
| `other` | Everything else | Log only, no pipeline change |

---

## Cost Tracking

Every Claude API call must log to `api_costs` via `costTracker.js`:

```javascript
// Sonnet 4 pricing as of 2025
const INPUT_COST_PER_1K  = 0.003;   // $0.003 per 1k input tokens
const OUTPUT_COST_PER_1K = 0.015;   // $0.015 per 1k output tokens

export function logCost(db, { job, inputTokens, outputTokens }) {
  const cost = (inputTokens / 1000 * INPUT_COST_PER_1K) +
               (outputTokens / 1000 * OUTPUT_COST_PER_1K);
  db.prepare(`
    INSERT INTO api_costs (job, input_tokens, output_tokens, cost_usd)
    VALUES (?, ?, ?, ?)
  `).run(job, inputTokens, outputTokens, cost);
}
```

Extract token counts from every Anthropic response:
```javascript
const response = await anthropic.messages.create({ ... });
logCost(db, {
  job: 'email_write',
  inputTokens: response.usage.input_tokens,
  outputTokens: response.usage.output_tokens
});
```

---

## Anti-Spam Rules (Enforced in Code)

- Random delay between sends: `90000 + Math.random() * 90000` ms — never fixed
- Never send before 9:00 AM IST or after 6:00 PM IST
- Never send on Sundays (`new Date().getDay() === 0`)
- Hard daily limit: check `DAILY_SEND_LIMIT` env var before each send
- Skip these email prefixes: `info`, `admin`, `support`, `hello`, `contact`, `team`, `no-reply`, `noreply`
- Verify MX record with `dns.resolveMx()` — skip lead if no MX records found
- Cold email body: plain text only — no HTML tags, no images, no tracking pixels
- No links in cold email body — CTA is always "reply to this email"
- Unsubscribe requests: mark `pipeline.status = rejected` same day, never contact again

---

## Dashboard Views Summary

| View | Data source | Key content |
|------|------------|-------------|
| Overview | `/api/overview` | Hot lead alert panel, 4 stat cards, 7-day line chart |
| Pipeline | `/api/pipeline` | Kanban — 7 columns, click card to expand full history |
| Analytics | `/api/analytics` | Bar funnel, category performance, sequence reply rate bars |
| Costs | `/api/costs` + `/api/costs/chart` | Budget bar, cost cards, breakdown by job type, ROI cards |
| Reports | `/api/reports` + `/api/reports/:date` | Sidebar list + HTML report iframe/render |
| Emails | `/api/emails` | List + body preview, filter by status/sequence |

---

## Nginx Config

```nginx
server {
    listen 443 ssl;
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
    }

    ssl_certificate /etc/letsencrypt/live/outreach.simpleinc.in/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/outreach.simpleinc.in/privkey.pem;
}

server {
    listen 80;
    server_name outreach.simpleinc.in;
    return 301 https://$host$request_uri;
}
```

---

## PM2 Config (ecosystem.config.js)

```javascript
export default {
  apps: [{
    name: 'outreach-agent',
    script: './index.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '300M',
    env: { NODE_ENV: 'production' },
    log_file: './logs/app.log',
    error_file: './logs/error.log',
    time: true
  }]
};
```

---

## Deployment Steps

```bash
# 1. Clone + install backend
cd /var/www
git clone <repo> outreach-agent
cd outreach-agent
npm install

# 2. Build dashboard
cd dashboard && npm install && npm run build && cd ..

# 3. Environment
cp .env.example .env
nano .env

# 4. Database setup (run once)
node db/setup.js

# 5. PM2
pm2 start ecosystem.config.js
pm2 save && pm2 startup

# 6. Nginx
sudo nano /etc/nginx/sites-available/outreach.simpleinc.in
sudo ln -s /etc/nginx/sites-available/outreach.simpleinc.in /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# 7. SSL
sudo certbot --nginx -d outreach.simpleinc.in
```

---

## Key Decisions & Rationale

| Decision | Reason |
|----------|--------|
| SQLite over PostgreSQL | Zero ops, single-user, backup is just `cp db/leads.db` |
| AWS SES over Zoho/Brevo | Highest IP reputation, 62k free/mo from EC2 |
| Zoho IMAP for receiving | Keep existing inbox, no migration needed |
| Plain text cold emails | Better deliverability, more human |
| Express API + React dashboard | Jobs run independently, dashboard reads DB via REST |
| JWT auth for dashboard | Simple single-user auth, no user table needed |
| node-cron over BullMQ | No Redis dependency for single-server tool |
| imapflow over node-imap | Actively maintained, Promise-based |
| Log every API call to DB | Exact cost visibility, not estimates |
| Store report HTML in DB | Dashboard shows any historical report without re-generating |

---

## What This Tool Does NOT Do

- No LinkedIn outreach (email only)
- No A/B testing (one generated email per lead per sequence)
- No open/click tracking (intentional — hurts deliverability)
- No multi-user access (single owner)
- No external CRM sync (SQLite is the CRM)
- No auto-reply to hot leads (you reply manually after alert)

---

## Monthly Cost Summary

| Item | Cost |
|------|------|
| AWS SES (from EC2 — 62k/mo free) | ₹0 |
| Claude API | ~₹1,260 |
| Existing VPS / EC2 free tier | ₹0 |
| Domain simpleinc.in (existing) | ₹0 |
| **Total** | **~₹1,260/mo** |
