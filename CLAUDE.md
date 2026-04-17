# CLAUDE.md — Radar by Simple Inc

Complete project context for Claude Code working in this repo.

---

## 1. Project Identity

| Field | Value |
|---|---|
| **System name** | Radar |
| **Owner** | Darshan Parmar — Simple Inc (simpleinc.in) |
| **Purpose** | Automated cold email client acquisition engine for a solo full-stack dev agency |
| **Goal** | ₹1 lakh/month recurring revenue from cold outreach to Indian SMBs and US clients |
| **Monthly expense floor** | ₹50,000 |
| **Dashboard URL** | radar.simpleinc.cloud |
| **Host** | Ubuntu 24 VPS, PM2-managed (being migrated to personal server) |
| **Primary domain** | simpleinc.in (NEVER used for outreach) |
| **Outreach domain** | trysimpleinc.com (separate GWS account) |
| **Inboxes** | darshan@trysimpleinc.com, hello@trysimpleinc.com |
| **DB (today)** | SQLite via better-sqlite3 WAL mode at `db/radar.sqlite` |
| **DB (next)** | PostgreSQL — migration planned for multi-tenant productization |

---

## 2. Repository Layout

```
/
├── src/
│   ├── engines/              # cron jobs (one per engine)
│   │   ├── findLeads.js      # Engine 1 — Lead Intelligence
│   │   ├── sendEmails.js     # Engine 3 — Email Sending
│   │   ├── sendFollowups.js  # Engine 3b — Follow-up Sequences
│   │   ├── checkReplies.js   # Engine 4 — Reply Intelligence
│   │   ├── dailyReport.js    # Engine 5 — Reporting + Alerting
│   │   └── healthCheck.js    # Anti-Spam Layer 4 — blacklist + metrics
│   ├── api/                  # Express API
│   │   ├── server.js         # bootstrap, mounts /api/* routers
│   │   ├── middleware/
│   │   │   └── auth.js       # JWT verify + password hash
│   │   └── routes/           # one file per resource
│   │       ├── auth.js          POST /api/auth/login
│   │       ├── overview.js      GET  /api/overview
│   │       ├── leads.js         CRUD /api/leads
│   │       ├── funnel.js        GET  /api/funnel
│   │       ├── sendLog.js       GET  /api/send-log
│   │       ├── replies.js       GET/PATCH/POST /api/replies
│   │       ├── sequences.js     GET  /api/sequences
│   │       ├── cronStatus.js    GET  /api/cron-status
│   │       ├── health.js        GET/PATCH /api/health
│   │       ├── costs.js         GET  /api/costs
│   │       ├── errors.js        GET/PATCH /api/errors
│   │       ├── config.js        GET/PUT   /api/config
│   │       ├── niches.js        CRUD /api/niches
│   │       └── icpRules.js      GET/PUT   /api/icp-rules
│   ├── core/                 # shared libs (used by engines + api)
│   │   ├── db/
│   │   │   └── index.js      # better-sqlite3 singleton + helpers
│   │   ├── ai/
│   │   │   ├── claude.js     # Anthropic SDK wrapper
│   │   │   └── gemini.js     # Gemini 2.5 Flash wrapper
│   │   ├── email/
│   │   │   ├── mailer.js     # SMTP send via nodemailer
│   │   │   ├── imap.js       # IMAP reads via imapflow
│   │   │   └── contentValidator.js
│   │   ├── integrations/
│   │   │   ├── telegram.js   # Bot alerts
│   │   │   ├── mev.js        # MyEmailVerifier
│   │   │   └── blacklistCheck.js  # DNS-based RBL checks
│   │   └── lib/
│   │       ├── sleep.js
│   │       └── concurrency.js
│   └── scheduler/
│       └── cron.js           # node-cron wiring for all engines
├── web/                      # React 18 + Vite SPA (radar.simpleinc.cloud)
│   ├── src/
│   │   ├── App.jsx, main.jsx, api.js, index.css
│   │   ├── pages/            # one page per dashboard view
│   │   └── components/
│   ├── index.html
│   ├── vite.config.js
│   └── package.json          # React deps isolated from backend
├── db/
│   ├── schema.sql            # SQLite DDL (loaded by initSchema())
│   └── radar.sqlite          # runtime DB (gitignored)
├── infra/
│   ├── ecosystem.config.js   # PM2 — scripts resolved relative to repo root
│   └── backup.sh             # SQLite → Backblaze B2, runs 2 AM daily
├── tests/                    # vitest, mirrors src/
│   ├── engines/
│   ├── api/
│   └── core/{db,ai,email,integrations,lib}/
├── scripts/                  # manual dev/smoke scripts (not cron-run)
│   ├── testFindLeads.js
│   └── testFullPipeline.js
├── docs/
├── .env                      # gitignored
├── .env.example
├── package.json              # backend deps + vitest
├── CLAUDE.md                 # this file
└── README.md
```

**Rule:** engines import from `../core/...`, API routes from `../../core/...`, tests from `../../src/...` or `../../../src/...` depending on depth. Never reintroduce `utils/` or `dashboard/`.

---

## 3. Environment Variables (.env)

```env
# ── OUTREACH IDENTITY ──────────────────────────────────────
OUTREACH_DOMAIN=trysimpleinc.com

# ── INBOXES (GWS app passwords — 2FA required) ─────────────
INBOX_1_USER=darshan@trysimpleinc.com
INBOX_1_PASS=xxxx xxxx xxxx xxxx
INBOX_2_USER=hello@trysimpleinc.com
INBOX_2_PASS=xxxx xxxx xxxx xxxx

# ── SMTP / IMAP ────────────────────────────────────────────
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
IMAP_HOST=imap.gmail.com
IMAP_PORT=993

# ── SEND LIMITS ────────────────────────────────────────────
DAILY_SEND_LIMIT=0           # Set to 34 after 4-week warmup
MAX_PER_INBOX=17
SEND_DELAY_MIN_MS=180000     # 3 minutes
SEND_DELAY_MAX_MS=420000     # 7 minutes
SEND_WINDOW_START_IST=9
SEND_WINDOW_END_IST=17

# ── AI MODELS ──────────────────────────────────────────────
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
ANTHROPIC_API_KEY=
MODEL_HOOK=claude-sonnet-4-20250514
MODEL_BODY=claude-haiku-4-5-20251001
MODEL_CLASSIFY=claude-haiku-4-5-20251001

# ── EMAIL VERIFICATION ─────────────────────────────────────
MEV_API_KEY=                 # MyEmailVerifier

# ── ALERTS ─────────────────────────────────────────────────
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# ── SAFETY THRESHOLDS ──────────────────────────────────────
BOUNCE_RATE_HARD_STOP=0.02   # 2% — auto-pause sends
SPAM_RATE_HARD_STOP=0.001    # 0.1% — auto-pause sends
CLAUDE_DAILY_SPEND_CAP=3.00  # USD
MAX_EMAIL_WORDS=90
MIN_EMAIL_WORDS=40
DISABLE_OPEN_TRACKING=true
DISABLE_CLICK_TRACKING=true
HTML_EMAIL=false

# ── DATABASE ───────────────────────────────────────────────
DB_PATH=./db/radar.sqlite    # absolute path on VPS: /home/radar/db/radar.sqlite

# ── DASHBOARD ──────────────────────────────────────────────
DASHBOARD_PORT=3001
DASHBOARD_URL=https://radar.simpleinc.cloud
DASHBOARD_PASSWORD=strong_password_here
JWT_SECRET=64char_random_here
JWT_EXPIRES_IN=7d
```

The `SPAM_WORDS` blocklist lives in `.env` and is read by `src/core/email/contentValidator.js`.

---

## 4. Engines

| Engine | File | Schedule (IST) | Purpose |
|---|---|---|---|
| Lead Intelligence | `src/engines/findLeads.js` | 09:00 Mon–Sat | 11-stage pipeline → ~34 ready leads/day |
| Email Sending | `src/engines/sendEmails.js` | 09:30 Mon–Sat | Round-robin both inboxes, plain text only |
| Follow-ups | `src/engines/sendFollowups.js` | 18:00 daily | 5-step threaded sequence |
| Reply Intelligence | `src/engines/checkReplies.js` | 14:00, 16:00, 20:00 | IMAP fetch + Haiku classify |
| Reporting | `src/engines/dailyReport.js` | 20:30 daily | Telegram digest + email digest |
| Health Check | `src/engines/healthCheck.js` | 02:00 Sun | DNS blacklist zones |
| Backup | `infra/backup.sh` | 02:00 daily | SQLite → Backblaze B2 |

All engines export `default async function` and are invoked by `src/scheduler/cron.js` (node-cron, IST timezone).

### findLeads 11-Stage Pipeline (150 raw → ~34 ready)

| # | Stage | Model | Drop rate |
|---|---|---|---|
| 1 | Discovery | Gemini Flash (grounded) | — |
| 2 | Extraction | Gemini Flash | ~10% |
| 3 | Tech fingerprinting | Gemini Flash | — |
| 4 | Business signals | Gemini Flash | — |
| G1 | Gate 1 | — | ~30% (drop modern stacks) |
| 5 | Quality judge | Gemini Flash | inline |
| 6 | DM finder | Gemini Flash | ~15% |
| 7 | Email verify | MEV | ~20% |
| G2 | Gate 2 | — | ~20% |
| 8 | Dedup + cooldown | SQLite | variable |
| G3 | Gate 3 | — | ~15% (C → nurture) |
| 9 | ICP scorer | Gemini Flash | — |
| 10 | Hook generation | Claude Sonnet 4.6 | — |
| 11 | Email body | Claude Haiku 4.5 | — |

### Daily Category Rotation
Mon D2C · Tue Real estate · Wed Funded startups · Thu Food · Fri Agencies · Sat Healthcare

---

## 5. Anti-Spam (Four Layers)

1. **DNS auth** — SPF, DKIM (google._domainkey CNAME), DMARC p=none
2. **Sending behavior** — 34/day cap, 3–7 min random delays, 9:30–17:30 IST, Mon–Sat, holidays blocked
3. **Content validator** — plain text only, 40–90 words, no URLs in step 0–1, SPAM_WORDS blocklist, regenerate once on fail
4. **Health monitoring** — bounce >2% → DAILY_SEND_LIMIT=0; unsub >1% 7d rolling → Telegram; weekly DNS blacklist check; manual mail-tester.com entry

---

## 6. Dashboard (web/)

React 18 + Vite SPA served by the same Express server from `web/dist`. Nginx reverse-proxies `radar.simpleinc.cloud` → `localhost:3001`.

Pages: Overview · Lead Pipeline · Send Log · Reply Feed · Sequence Tracker · Cron Job Status · Health Monitor · Cost Tracker · Error Log · Engine Config · ICP Rules · Email Persona · Funnel Analytics.

Auth: password → bcrypt → JWT (7-day). `requireAuth` middleware guards everything except `POST /api/auth/login`.

---

## 7. Non-Negotiable Rules

1. **Plain text only.** Never `html:` in nodemailer.
2. **No tracking pixels, opens, or clicks.**
3. **No links in cold step 0 or 1.**
4. **`contentValidator` runs before every send.**
5. **Bounce rate checked before each send.** >2% = immediate stop.
6. **Send window enforced** (9:30–17:30 IST, Mon–Sat).
7. **`cron_log` written at start AND end.** status transitions running → success/failed.
8. **All errors → `error_log`.** Never swallow.
9. **Follow-ups use inReplyTo + references headers.**
10. **`reject_list` is absolute.** No code bypasses it.
11. **`DAILY_SEND_LIMIT=0` = hard stop.**
12. **All AI calls log model + cost** to `emails` and `daily_metrics`.
13. **From domain MUST be `trysimpleinc.com`.** Assert before send.
14. **simpleinc.in is never used for outreach.**
15. **ICP C → `status='nurture'`**, not discarded.
16. **Gemini grounding stays on free tier.** 150 queries/day << 1,500/day.

---

## 8. Roadmap

### Phase 1 — Warmup + Pilot (Weeks 1–8, current)
1 domain, 2 inboxes, India targets (Mumbai, Bangalore, Delhi NCR, Pune). Ramp: 0 → 20 → 28 → 34/day.

### Phase 1.5 — Productization prep (next ~1 month)
- Move to personal server
- **SQLite → PostgreSQL** (load-bearing for multi-tenancy)
- Add `tenant_id` to every table (nullable, default=1)
- PWA polish on `web/` for phone-first ops monitoring
- No signup/billing UI yet — manually provisioned tenants

### Phase 2 — Scale (Months 2–3)
2nd domain + 4 more inboxes → 68/day. Postmaster API once volume allows. US East Coast window 19:30–21:30 IST.

### Phase 3 — Multi-tenant SaaS (Months 4–6)
3 domains, 9 inboxes, 150/day. Redis + BullMQ. Productized as "done-for-you outbound setup" retainer.

---

## 9. Tech Stack

| Layer | Tool |
|---|---|
| Runtime | Node.js 20+ LTS, ES modules |
| Process | PM2 (`infra/ecosystem.config.js`) |
| Scheduler | node-cron (`src/scheduler/cron.js`) |
| DB | better-sqlite3 (Postgres planned) |
| SMTP | nodemailer |
| IMAP | imapflow |
| AI search/extract | @google/generative-ai (Gemini 2.5 Flash) |
| AI writing | @anthropic-ai/sdk (Sonnet 4.6 + Haiku 4.5) |
| Email verify | axios + MEV REST |
| Alerts | node-telegram-bot-api |
| Dashboard FE | React 18 + Vite + recharts |
| Dashboard API | Express 4 |
| Auth | bcrypt + jsonwebtoken |
| Tests | vitest |
| Web server | Nginx reverse-proxy |
| Backup | rclone → Backblaze B2 |

---

## 10. Local Dev Commands

```bash
# Backend (tests + one-off engine runs)
npm install
npm test                     # all 109 tests
npm test -- engines          # just engine tests

# Run a single engine manually
node src/engines/findLeads.js

# Dashboard (web frontend)
cd web && npm install && npm run dev   # vite dev server, proxies /api to :3001

# API server (serves dashboard in prod from web/dist)
node src/api/server.js

# Production (VPS)
pm2 start infra/ecosystem.config.js
pm2 logs radar-cron
pm2 logs radar-dashboard
```

---

## 11. Monthly Cost Reference

| Item | ₹/mo |
|---|---|
| AI/API | ~1,875 |
| Instantly Growth warmup | 3,100 |
| GWS 2 inboxes | 420 |
| trysimpleinc.com | 70 |
| VPS | existing |
| **Total** | **~5,465** |

ROI: 1 client @ ₹40,000 = 7.3× monthly system cost.
