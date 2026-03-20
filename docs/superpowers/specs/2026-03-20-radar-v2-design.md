# Radar v2 — Design Spec
**Date:** 2026-03-20
**Owner:** Darshan Parmar — Simple Inc
**Branch:** radar-v2
**Deploy target:** radar.simpleinc.cloud

---

## 1. Context & Goal

Radar is a fully automated cold email client acquisition engine for a solo full-stack dev agency. The v1 system used a single Claude Sonnet call with `web_search` to find leads and was deployed with AWS SES + Zoho IMAP. This v2 spec is a complete rewrite with:

- A proper 11-stage lead intelligence pipeline (Gemini 2.5 Flash → Claude Sonnet → Claude Haiku)
- Google Workspace SMTP/IMAP on a dedicated outreach domain (trysimpleinc.com)
- A 4-layer anti-spam engine with health monitoring
- A richer 10-table SQLite schema
- Telegram bot alerts instead of email alerts
- A 9-page React dashboard

**Success criteria:** 34 qualified, verified, ICP-scored cold emails sent daily, reply rate ≥3%, zero deliverability incidents in 8-week pilot.

---

## 2. Architecture

### Process model (PM2, 2 processes)

```
radar-cron       ← cron.js       → fires all 9 jobs on IST schedule
radar-dashboard  ← dashboard/server.js → Express API on port 3001
```

Nginx proxies `radar.simpleinc.cloud` → port 3001 for `/api/*`, serves React SPA for `/`.

### File structure

```
/home/radar/
├── package.json
├── cron.js
├── findLeads.js
├── sendEmails.js
├── sendFollowups.js
├── checkReplies.js
├── dailyReport.js
├── healthCheck.js
├── backup.sh
├── ecosystem.config.js
├── .env / .env.example / .gitignore
├── utils/
│   ├── db.js               ← better-sqlite3 singleton + schema init
│   ├── gemini.js           ← Gemini 2.5 Flash client + cost tracker
│   ├── claude.js           ← Anthropic Sonnet/Haiku client + cost tracker
│   ├── mailer.js           ← dual-inbox Nodemailer (GWS SMTP)
│   ├── imap.js             ← dual-inbox imapflow reader
│   ├── telegram.js         ← Telegram bot (stub until token ready)
│   ├── contentValidator.js ← 6-rule pre-send check
│   ├── blacklistCheck.js   ← DNS blacklist queries
│   ├── mev.js              ← MyEmailVerifier REST client
│   └── sleep.js            ← randomised delay
├── db/
│   └── radar.sqlite        ← gitignored, WAL mode
└── dashboard/
    ├── server.js           ← Express API
    ├── package.json
    └── src/                ← React 18 + Vite (Phase 5)
```

---

## 3. Database Schema (10 tables)

Full DDL in CLAUDE.md §4. Summary of tables:

| Table | Purpose |
|---|---|
| `leads` | All discovered leads with 11-stage fields + status pipeline |
| `emails` | Every email sent — content, delivery, threading, AI cost |
| `bounces` | Hard + soft bounce records |
| `replies` | Inbound replies + Haiku classification |
| `reject_list` | Permanent unsubscribe/hard-bounce list |
| `cron_log` | Job execution audit: start/end/status/cost per run |
| `daily_metrics` | Aggregated funnel + cost + health rates per day |
| `error_log` | All errors with stack trace + resolution tracking |
| `sequence_state` | Per-lead follow-up step, next send date, threading state |

Indices on: `leads.status`, `leads.icp_priority`, `leads.contact_email`, `emails.sent_at`, `emails.status`, `replies.lead_id`, `cron_log.job_name`, `daily_metrics.date`, `error_log.source`, `reject_list.email`, `reject_list.domain`.

Database singleton in `utils/db.js` — initialises schema on first run, WAL mode enabled.

---

## 4. Engine 1 — Lead Intelligence (`findLeads.js`)

### 11-stage pipeline (150 raw → 34 email-ready)

**Stages 1–9 use Gemini 2.5 Flash (free grounding, 150/day << 1,500/day limit):**

| Stage | Action | Gate |
|---|---|---|
| 1 | Discovery — web search by niche + city | — |
| 2 | Extraction — fetch URL, parse HTML, extract owner/tech/problems | Drop 404s (~10%) |
| 3 | Tech fingerprinting — CMS from meta tags + script URLs | — |
| 4 | Business signals — reviews, social vs website gap | — |
| G1 | Gate 1 | Drop: modern stack + no signals + quality ≥7 (~30%) |
| 5 | Quality judge — score 1–10 | Chained in same Gemini session as 2–4 |
| 6 | DM finder — owner name from About/JustDial, pattern email | Drop no-DM (~15%) |
| 7 | Email verify — MEV API (100 free/day) | Drop invalid/disposable (~20%) |
| G2 | Gate 2 | Drop: invalid email or low-confidence with no fallback (~20%) |
| 8 | Dedup + cooldown — SQLite check, reject_list check | Variable |
| G3 | Gate 3 | C-priority → status='nurture', not discarded (~15%) |
| 9 | ICP scorer — 0–10 score, A/B/C priority | Only A+B continue |

**Stage 10 — Hook generation (Claude Sonnet 4.6):**
One hyper-specific observation sentence about their website. Stored in `leads.hook`.

**Stage 11 — Email body (Claude Haiku 4.5):**
50–90 word plain text cold email. Hook passed as context. Stored in `leads` pre-send.

Each lead's AI cost tracked: `gemini_cost_usd`, `hook_cost_usd`, `body_cost_usd` in `leads` + `daily_metrics`.

### Category rotation (Mon–Sat)
Monday: Shopify/D2C → Tuesday: Real estate → Wednesday: Funded startups → Thursday: Restaurants/cafes → Friday: Agencies → Saturday: Healthcare/salons

### ICP scoring rubric
```
+3  India-based B2C-facing
+2  20+ Google reviews
+2  WordPress/Wix/Squarespace stack
+2  Website last updated 2+ years
+1  Active social but neglected website
+1  WhatsApp Business, no booking
-2  Freelancer/solo consultant
-3  Modern stack (Next.js/Webflow/custom React)
```

---

## 5. Engine 2 — Anti-Spam (`utils/contentValidator.js` + `healthCheck.js`)

### Layer 3: Content validator (6 rules, runs before every `sendMail`)
1. No HTML detected
2. Word count 40–90
3. No URL/link in step 0–1
4. No spam word from `SPAM_WORDS` env
5. Subject ≤8 words, no `!` or `?` or ALL CAPS
6. No unfilled `{{` variable

On fail: regenerate once. Second fail → skip lead, log `content_rejected` to `error_log`.

### Layer 4: Health monitor (`healthCheck.js`, runs Sunday 2AM)
- DNS blacklist check: `dbl.spamhaus.org`, `b.barracudacentral.org`, `multi.surbl.org`
- If listed → `DAILY_SEND_LIMIT=0` + Telegram 🚨
- Bounce rate >2% → auto-pause + Telegram 🚨 (checked before each send in `sendEmails.js`)

---

## 6. Engine 3 — Email Sending (`sendEmails.js` + `sendFollowups.js`)

### sendEmails.js — cold email send flow
1. Verify both SMTP connections at startup
2. Exit if outside 9:30 AM–5:30 PM IST or Sunday/holiday
3. Exit if `DAILY_SEND_LIMIT=0` or today's sent count reached
4. Check `bounce_rate_today` — abort if >2%
5. Pull `status='ready'`, `icp_priority IN ('A','B')`, not in `reject_list`, ORDER BY priority/score
6. Per lead: round-robin inbox (`totalSentToday % 2`), validate content, send, log bounce or success
7. Delay 180–420s between sends
8. Write session summary to `cron_log`

### sendFollowups.js — 5-step sequence
| Step | Offset | Angle | Format |
|---|---|---|---|
| 0 | Day 0 | Cold hook email | New thread |
| 1 | +3d | Short bump | Thread reply |
| 2 | +7d | Value / mini case study | Thread reply |
| 3 | +14d | Breakup | Thread reply |
| 4 | +90d | Quarterly nurture | New thread |

Threading: `In-Reply-To` + `References` headers from `sequence_state.last_message_id`.
Stop: any reply · unsubscribed · 2+ hard bounces from domain · step 4 complete.

---

## 7. Engine 4 — Reply Intelligence (`checkReplies.js`)

- imapflow connects to both GWS inboxes (imap.gmail.com:993)
- Runs at 2PM, 4PM, 8PM IST
- Each unseen message: match sender to `leads.contact_email` → classify via Claude Haiku

| Category | Action |
|---|---|
| `hot` | Telegram 🔥, `leads.status='replied'`, `sequence_state.status='replied'` |
| `schedule` | Telegram 📅, same status updates |
| `soft_no` | Re-queue sequence +14d, `sequence_state.status='paused'` |
| `unsubscribe` | `reject_list` insert, all sequences stopped |
| `ooo` | Re-queue +5d (parse return date if present) |
| `other` | Log to `replies` only |

---

## 8. Engine 5 — Reporting (`dailyReport.js`)

Runs 8:30 PM IST.

1. Aggregate today's metrics from SQLite
2. Send Telegram one-liner (format in CLAUDE.md §10)
3. Generate HTML email report via Claude Haiku
4. Send HTML digest to `darshan@simpleinc.in` via GWS SMTP
5. Store HTML + metrics in `daily_metrics` table

---

## 9. Utils Layer

| File | Responsibility |
|---|---|
| `utils/db.js` | `better-sqlite3` singleton, `initSchema()`, WAL mode, named query helpers |
| `utils/gemini.js` | `@google/generative-ai` client, all Gemini calls, INR cost tracker |
| `utils/claude.js` | `@anthropic-ai/sdk` client, Sonnet + Haiku calls, USD/INR cost tracker |
| `utils/mailer.js` | Two Nodemailer transporters (inbox1, inbox2), `sendMail(inbox, opts)` |
| `utils/imap.js` | imapflow, `fetchUnseen(inbox)` → message array |
| `utils/telegram.js` | `node-telegram-bot-api`, `sendAlert(msg)` — stubs to console.log if no token |
| `utils/contentValidator.js` | `validate(subject, body, step)` → `{ valid, reason }` |
| `utils/blacklistCheck.js` | `checkDomain(domain)` → `{ clean, zones[] }` |
| `utils/mev.js` | `verifyEmail(email)` → `{ status, confidence }` |
| `utils/sleep.js` | `sleep(minMs, maxMs)` — random delay |

---

## 10. Dashboard API (`dashboard/server.js`)

Express on port 3001. JWT auth (single password). All routes except `/api/auth/login` require `Authorization: Bearer <token>`.

### API routes

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/auth/login` | `{ password }` → `{ token }` |
| GET | `/api/overview` | Metric cards, funnel waterfall, 90-day heatmap |
| GET | `/api/leads` | Paginated leads table with filters |
| GET | `/api/leads/:id` | Full lead detail + emails + replies + sequence state |
| GET | `/api/send-log` | Paginated email send log with filters |
| GET | `/api/replies` | All replies, hot/schedule pinned first |
| GET | `/api/sequences` | Per-lead sequence state + aggregates |
| GET | `/api/cron-status` | Today's 9 job statuses + NOT TRIGGERED detection |
| GET | `/api/cron-status/:job/history` | Last 30 runs for a job |
| GET | `/api/health` | Blacklist status, bounce/unsub rates, inbox health |
| GET | `/api/costs` | Daily stacked chart (30d), monthly table, per-email avg |
| GET | `/api/errors` | Error log with filters |
| PATCH | `/api/leads/:id/status` | Manual status update |
| PATCH | `/api/errors/:id/resolve` | Mark error resolved |

### Dashboard pages (React 18 + Vite, Phase 5)

1. **Overview** — metric cards, funnel waterfall, 90-day send heatmap
2. **Lead Pipeline** — filterable table + detail panel
3. **Send Log** — every email with SMTP details + cost
4. **Reply Feed** — classified replies, hot/schedule pinned
5. **Sequence Tracker** — per-lead step + next send date
6. **Cron Status** — 9-job cards with NOT TRIGGERED detection
7. **Health Monitor** — blacklist, bounce/unsub gauges, inbox connectivity
8. **Cost Tracker** — stacked bar chart, monthly breakdown
9. **Error Log** — unresolved badge, resolve action

---

## 11. Build Phases

| Phase | Deliverables |
|---|---|
| **1 — Foundation** | `package.json`, `utils/db.js` (schema + WAL), `utils/sleep.js`, `utils/telegram.js` (stub), `.env.example`, `ecosystem.config.js`, `cron.js` skeleton |
| **2 — Engine 1** | `utils/gemini.js`, `utils/claude.js`, `utils/mev.js`, `findLeads.js` (all 11 stages) |
| **3 — Anti-spam layer** | `utils/contentValidator.js`, `utils/blacklistCheck.js`, `healthCheck.js` |
| **4 — Engines 3+4+5** | `utils/mailer.js`, `utils/imap.js`, `sendEmails.js`, `sendFollowups.js`, `checkReplies.js`, `dailyReport.js`, `backup.sh` |
| **5 — Dashboard** | `dashboard/server.js` (Express API), React app (all 9 pages) |

---

## 12. Non-Negotiables (from CLAUDE.md §13)

1. Plain text emails only — no `html:` field in Nodemailer
2. No tracking pixels, open tracking, or click tracking
3. No links in cold email step 0 or step 1
4. `contentValidator` runs before every `sendMail`
5. Bounce rate >2% = immediate hard stop + Telegram alert
6. Send window 9:30 AM–5:30 PM IST only
7. `cron_log` written at job start AND end
8. All errors written to `error_log` — never swallow silently
9. Follow-ups use `In-Reply-To` + `References` headers
10. `reject_list` is permanent — no code bypasses it
11. `DAILY_SEND_LIMIT=0` is a hard stop
12. All AI calls log model + cost to `daily_metrics`
13. From domain must assert `trysimpleinc.com` before every send
14. `simpleinc.in` is never used for outreach
15. ICP C-priority → `status='nurture'`, not discarded
16. Gemini grounding stays on free tier (150/day)

---

## 13. Open Items

- **Telegram bot:** `TELEGRAM_BOT_TOKEN` not yet configured. `utils/telegram.js` must stub gracefully (console.log) when token absent — no errors thrown.
- **Warmup period:** `DAILY_SEND_LIMIT=0` in `.env` until Week 5. Instantly Growth warmup runs independently on both inboxes.
- **Backblaze B2:** `backup.sh` uses `rclone` — credentials configured separately on VPS, not in this repo.
