# CLAUDE.md — Radar by Simple Inc
## Complete Project Context for Claude Code

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
| **VPS** | Ubuntu 24, existing, PM2-managed |
| **Primary domain** | simpleinc.in (NEVER used for outreach) |
| **Outreach domain** | trysimpleinc.com (purchased, separate GWS account) |
| **Inbox 1** | darshan@trysimpleinc.com |
| **Inbox 2** | hello@trysimpleinc.com |
| **DB** | SQLite via better-sqlite3 WAL mode at `/home/radar/db/radar.sqlite` |

---

## 2. Repository Structure

```
/home/radar/
├── findLeads.js          # Engine 1 — Lead Intelligence Engine
├── sendEmails.js         # Engine 3 — Email Sending Engine
├── sendFollowups.js      # Engine 3b — Follow-up Sequence Engine
├── checkReplies.js       # Engine 4 — Reply Intelligence Engine
├── dailyReport.js        # Engine 5 — Reporting + Alerting Engine
├── healthCheck.js        # Anti-Spam Layer 4 — blacklist + metrics
├── backup.sh             # SQLite → Backblaze B2, runs 2AM daily
├── db/
│   └── radar.sqlite      # Single WAL-mode SQLite database
├── dashboard/            # React app — radar.simpleinc.cloud
│   ├── src/
│   ├── public/
│   └── package.json
├── utils/
│   ├── db.js             # better-sqlite3 singleton
│   ├── telegram.js       # Telegram bot alerts
│   ├── contentValidator.js  # Pre-send spam/content checks
│   ├── blacklistCheck.js    # DNS-based blacklist queries
│   └── sleep.js          # randomised delay utility
├── .env                  # All secrets — never commit
├── ecosystem.config.js   # PM2 process + cron config
└── package.json
```

---

## 3. Environment Variables (.env)

```env
# ── OUTREACH IDENTITY ──────────────────────────────────────
OUTREACH_DOMAIN=trysimpleinc.com

# ── INBOXES (GWS app passwords — 2FA must be on) ───────────
INBOX_1_USER=darshan@trysimpleinc.com
INBOX_1_PASS=xxxx xxxx xxxx xxxx
INBOX_2_USER=hello@trysimpleinc.com
INBOX_2_PASS=xxxx xxxx xxxx xxxx

# ── SMTP ────────────────────────────────────────────────────
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587

# ── IMAP ────────────────────────────────────────────────────
IMAP_HOST=imap.gmail.com
IMAP_PORT=993

# ── SEND LIMITS ─────────────────────────────────────────────
DAILY_SEND_LIMIT=0           # Set to 34 after 4-week warmup
MAX_PER_INBOX=17
SEND_DELAY_MIN_MS=180000     # 3 minutes minimum between sends
SEND_DELAY_MAX_MS=420000     # 7 minutes maximum between sends
SEND_WINDOW_START_IST=9      # 9:30 AM
SEND_WINDOW_END_IST=17       # 5:30 PM

# ── AI MODELS ───────────────────────────────────────────────
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash

ANTHROPIC_API_KEY=
MODEL_HOOK=claude-sonnet-4-20250514
MODEL_BODY=claude-haiku-4-5-20251001
MODEL_CLASSIFY=claude-haiku-4-5-20251001

# ── EMAIL VERIFICATION ──────────────────────────────────────
MEV_API_KEY=                 # MyEmailVerifier

# ── ALERTS ──────────────────────────────────────────────────
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# ── SAFETY THRESHOLDS ───────────────────────────────────────
BOUNCE_RATE_HARD_STOP=0.02   # 2% — auto-pause sends
SPAM_RATE_HARD_STOP=0.001    # 0.1% — auto-pause sends
CLAUDE_DAILY_SPEND_CAP=3.00  # USD hard cap on AI spend
MAX_EMAIL_WORDS=90
MIN_EMAIL_WORDS=40
DISABLE_OPEN_TRACKING=true
DISABLE_CLICK_TRACKING=true
HTML_EMAIL=false

# ── CONTENT SPAM WORD BLOCKLIST ─────────────────────────────
SPAM_WORDS=free,guarantee,guaranteed,100%,winner,prize,congratulations,limited time,act now,click here,buy now,discount,offer,deal,no obligation,risk-free,earn money,make money,income,revenue,ROI,results,increase sales

# ── DATABASE ────────────────────────────────────────────────
DB_PATH=/home/radar/db/radar.sqlite

# ── DASHBOARD ───────────────────────────────────────────────
DASHBOARD_PORT=3001
DASHBOARD_URL=https://radar.simpleinc.cloud
DASHBOARD_PASSWORD=your_strong_password_here
JWT_SECRET=your_random_64char_secret_here
JWT_EXPIRES_IN=7d
```

---

## 4. SQLite Schema (Complete)

```sql
-- ── LEADS ──────────────────────────────────────────────────
CREATE TABLE leads (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  discovered_at         DATETIME DEFAULT CURRENT_TIMESTAMP,

  -- Stage 1: Discovery
  business_name         TEXT,
  website_url           TEXT,
  category              TEXT,
  city                  TEXT,
  country               TEXT DEFAULT 'IN',
  search_query          TEXT,

  -- Stage 2: Extraction
  tech_stack            TEXT,          -- JSON array
  website_problems      TEXT,          -- JSON array
  last_updated          TEXT,
  has_ssl               INTEGER,
  has_analytics         INTEGER,
  owner_name            TEXT,
  owner_role            TEXT,

  -- Stage 4: Business signals
  business_signals      TEXT,          -- JSON array
  social_active         INTEGER,

  -- Stage 5: Quality judge
  website_quality_score INTEGER,       -- 1-10 (low = needs work)
  judge_reason          TEXT,
  judge_skip            INTEGER DEFAULT 0,

  -- Stage 9: ICP score
  icp_score             INTEGER,       -- 0-10
  icp_priority          TEXT,          -- A / B / C
  icp_reason            TEXT,

  -- Stage 6: Contact
  contact_name          TEXT,
  contact_email         TEXT,
  contact_confidence    TEXT,          -- high / medium / low
  contact_source        TEXT,

  -- Stage 7: Email verification
  email_status          TEXT,          -- valid / catch-all / invalid / disposable
  email_verified_at     DATETIME,

  -- Pipeline status
  status                TEXT DEFAULT 'discovered',
  -- discovered → extraction_failed → judge_skipped → email_not_found
  -- → email_invalid → icp_c → deduped → ready → queued → sent
  -- → replied → unsubscribed → bounced → nurture

  -- Stage 8: Dedup
  domain_last_contacted DATETIME,
  in_reject_list        INTEGER DEFAULT 0,

  -- Cost tracking
  gemini_tokens_used    INTEGER,
  gemini_cost_usd       REAL,
  discovery_model       TEXT,
  extraction_model      TEXT,
  judge_model           TEXT
);

-- ── EMAILS ─────────────────────────────────────────────────
CREATE TABLE emails (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id               INTEGER REFERENCES leads(id),
  sequence_step         INTEGER DEFAULT 0, -- 0=cold,1=day3,2=day7,3=day14,4=day90

  -- Sending identity
  inbox_used            TEXT,
  from_domain           TEXT DEFAULT 'trysimpleinc.com',
  from_name             TEXT,

  -- Content
  subject               TEXT,
  body                  TEXT,
  word_count            INTEGER,
  hook                  TEXT,
  contains_link         INTEGER DEFAULT 0,
  is_html               INTEGER DEFAULT 0,
  is_plain_text         INTEGER DEFAULT 1,

  -- Validation
  content_valid         INTEGER DEFAULT 1,
  validation_fail_reason TEXT,
  regenerated           INTEGER DEFAULT 0,

  -- Delivery
  status                TEXT DEFAULT 'pending',
  -- pending → sent → hard_bounce → soft_bounce → content_rejected
  sent_at               DATETIME,
  smtp_response         TEXT,
  smtp_code             INTEGER,
  message_id            TEXT,          -- stored for threading
  send_duration_ms      INTEGER,

  -- Thread headers (for follow-ups)
  in_reply_to           TEXT,
  references_header     TEXT,

  -- AI cost tracking
  hook_model            TEXT,
  body_model            TEXT,
  hook_cost_usd         REAL,
  body_cost_usd         REAL,
  total_cost_usd        REAL,

  created_at            DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ── BOUNCES ────────────────────────────────────────────────
CREATE TABLE bounces (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  email_id              INTEGER REFERENCES emails(id),
  lead_id               INTEGER REFERENCES leads(id),
  bounce_type           TEXT,          -- hard / soft
  smtp_code             INTEGER,
  smtp_message          TEXT,
  bounced_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
  retry_after           DATETIME
);

-- ── REPLIES ────────────────────────────────────────────────
CREATE TABLE replies (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id               INTEGER REFERENCES leads(id),
  email_id              INTEGER REFERENCES emails(id),
  inbox_received_at     TEXT,
  received_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
  category              TEXT,
  -- hot / schedule / soft_no / unsubscribe / ooo / other
  raw_text              TEXT,
  classification_model  TEXT,
  classification_cost_usd REAL,
  sentiment_score       INTEGER,       -- 1-5
  telegram_alerted      INTEGER DEFAULT 0,
  requeue_date          DATETIME,
  actioned_at           DATETIME,
  action_taken          TEXT           -- booked_call / replied / ignored
);

-- ── REJECT LIST ────────────────────────────────────────────
CREATE TABLE reject_list (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  email                 TEXT UNIQUE,
  domain                TEXT,
  reason                TEXT,          -- unsubscribe / hard_bounce / manual
  added_at              DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ── CRON JOB LOG ───────────────────────────────────────────
CREATE TABLE cron_log (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  job_name              TEXT,
  -- findLeads / sendEmails / sendFollowups / checkReplies
  -- dailyReport / healthCheck / backup
  scheduled_at          DATETIME,
  started_at            DATETIME,
  completed_at          DATETIME,
  duration_ms           INTEGER,
  status                TEXT,
  -- running / success / failed / skipped
  error_message         TEXT,
  records_processed     INTEGER,
  records_skipped       INTEGER,
  cost_usd              REAL,
  notes                 TEXT
);

-- ── DAILY METRICS ──────────────────────────────────────────
CREATE TABLE daily_metrics (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  date                  TEXT UNIQUE,   -- YYYY-MM-DD

  -- Lead funnel
  leads_discovered      INTEGER DEFAULT 0,
  leads_extracted       INTEGER DEFAULT 0,
  leads_judge_passed    INTEGER DEFAULT 0,
  leads_email_found     INTEGER DEFAULT 0,
  leads_email_valid     INTEGER DEFAULT 0,
  leads_icp_ab          INTEGER DEFAULT 0,
  leads_ready           INTEGER DEFAULT 0,

  -- Send funnel
  emails_attempted      INTEGER DEFAULT 0,
  emails_sent           INTEGER DEFAULT 0,
  emails_hard_bounced   INTEGER DEFAULT 0,
  emails_soft_bounced   INTEGER DEFAULT 0,
  emails_content_rejected INTEGER DEFAULT 0,

  -- Inbox breakdown
  sent_inbox_1          INTEGER DEFAULT 0,
  sent_inbox_2          INTEGER DEFAULT 0,

  -- Replies
  replies_total         INTEGER DEFAULT 0,
  replies_hot           INTEGER DEFAULT 0,
  replies_schedule      INTEGER DEFAULT 0,
  replies_soft_no       INTEGER DEFAULT 0,
  replies_unsubscribe   INTEGER DEFAULT 0,
  replies_ooo           INTEGER DEFAULT 0,
  replies_other         INTEGER DEFAULT 0,

  -- Health rates
  bounce_rate           REAL,
  reply_rate            REAL,          -- 7-day rolling
  unsubscribe_rate      REAL,

  -- API costs
  gemini_cost_usd       REAL DEFAULT 0,
  sonnet_cost_usd       REAL DEFAULT 0,
  haiku_cost_usd        REAL DEFAULT 0,
  mev_cost_usd          REAL DEFAULT 0,
  total_api_cost_usd    REAL DEFAULT 0,
  total_api_cost_inr    REAL DEFAULT 0,

  -- Anti-spam health
  domain_blacklisted    INTEGER DEFAULT 0,
  blacklist_zones       TEXT,
  mail_tester_score     REAL,          -- manual entry
  postmaster_reputation TEXT,          -- HIGH/MEDIUM/LOW/BAD/null (Phase 2)

  -- Sequence
  followups_sent        INTEGER DEFAULT 0,

  created_at            DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ── ERROR LOG ──────────────────────────────────────────────
CREATE TABLE error_log (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
  source                TEXT,
  job_name              TEXT,
  error_type            TEXT,          -- smtp_error/api_error/db_error/validation_error
  error_code            TEXT,
  error_message         TEXT,
  stack_trace           TEXT,
  lead_id               INTEGER,
  email_id              INTEGER,
  resolved              INTEGER DEFAULT 0,
  resolved_at           DATETIME
);

-- ── SEQUENCE STATE ─────────────────────────────────────────
CREATE TABLE sequence_state (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id               INTEGER UNIQUE REFERENCES leads(id),
  current_step          INTEGER DEFAULT 0,
  next_send_date        DATE,
  last_sent_at          DATETIME,
  last_message_id       TEXT,
  last_subject          TEXT,
  status                TEXT DEFAULT 'active',
  -- active / paused / completed / unsubscribed / replied
  paused_reason         TEXT,
  updated_at            DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ── INDICES ────────────────────────────────────────────────
CREATE INDEX idx_leads_status        ON leads(status);
CREATE INDEX idx_leads_icp           ON leads(icp_priority, icp_score);
CREATE INDEX idx_leads_email         ON leads(contact_email);
CREATE INDEX idx_emails_lead         ON emails(lead_id);
CREATE INDEX idx_emails_sent_at      ON emails(sent_at);
CREATE INDEX idx_emails_status       ON emails(status);
CREATE INDEX idx_replies_lead        ON replies(lead_id);
CREATE INDEX idx_cron_log_job        ON cron_log(job_name, scheduled_at);
CREATE INDEX idx_daily_metrics_date  ON daily_metrics(date);
CREATE INDEX idx_error_log_source    ON error_log(source, occurred_at);
CREATE INDEX idx_reject_list_email   ON reject_list(email);
CREATE INDEX idx_reject_list_domain  ON reject_list(domain);
```

---

## 5. PM2 + Cron Schedule (ecosystem.config.js)

```js
module.exports = {
  apps: [
    {
      name: 'radar-dashboard',
      script: 'dashboard/server.js',
      env: { NODE_ENV: 'production', PORT: 3001 }
    },
    {
      name: 'radar-cron',
      script: 'cron.js',
      watch: false
    }
  ]
};

// cron.js — IST schedule, Mon–Sat:
// 09:00 AM → findLeads.js
// 09:30 AM → sendEmails.js
// 02:00 PM → checkReplies.js  (pass 1)
// 04:00 PM → checkReplies.js  (pass 2)
// 06:00 PM → sendFollowups.js
// 08:00 PM → checkReplies.js  (pass 3)
// 08:30 PM → dailyReport.js
// 02:00 AM → backup.sh
// 02:00 AM Sunday → healthCheck.js (blacklist DNS check)
```

---

## 6. Engine 1 — Lead Intelligence Engine (`findLeads.js`)

**Purpose:** 150 raw leads/day → ~34 qualified, verified, scored, email-ready leads.

**Model assignment:**
- Stages 1–6, 9: Gemini 2.5 Flash (search grounding free tier — 150 < 1,500/day limit)
- Stage 10 (hook): Claude Sonnet 4.6
- Stage 11 (email body): Claude Haiku 4.5

### 11-Stage Pipeline

| # | Stage | Model | Drop rate | Notes |
|---|---|---|---|---|
| 1 | Discovery | Gemini Flash | — | Web search by niche + city. Free grounding. |
| 2 | Extraction | Gemini Flash | ~10% | Fetch URL, parse HTML, extract owner/tech/problems |
| 3 | Tech fingerprinting | Gemini Flash | — | CMS from meta tags, script URLs. No Wappalyzer ($250/mo). |
| 4 | Business signals | Gemini Flash | — | Maps age, reviews, social vs website gap. Free from HTML. |
| **G1** | **Gate 1** | — | ~30% | Drop if: modern stack + no signals + quality score ≥7 |
| 5 | Quality judge | Gemini Flash | included | Score 1–10. Chained in same session as stages 1–4. |
| 6 | DM finder | Gemini Flash | ~15% | Owner name from About/JustDial. Pattern: firstname@domain.com |
| 7 | Email verify | MEV API | ~20% | MyEmailVerifier REST. 100 free credits/day. PAYG: $0.00288/email |
| **G2** | **Gate 2** | — | ~20% | Drop if: email=invalid or low-confidence with no fallback |
| 8 | Dedup + cooldown | SQLite | variable | Contacted <90 days? In reject_list? |
| **G3** | **Gate 3** | — | ~15% | C-priority → status='nurture' (not discarded) |
| 9 | ICP scorer | Gemini Flash | ~15% | 0–10 score, A/B/C priority. Only A+B reach Sonnet. |
| 10 | Hook generation | Sonnet 4.6 | — | 1 specific sentence about their website. ~42 leads/day. |
| 11 | Email body | Haiku 4.5 | — | 50–90 word plain text. Hook passed as context. |

### Funnel Math (to produce 34 emails/day)
```
150 discovered
→ 135 extracted (-10% 404s/parse failures)
→ 95  gate 1 passed (-30% modern stack/no signals)
→ 76  email found (-20% no DM found)
→ 63  email valid (-20% invalid/disposable)
→ 46  dedup passed (variable)
→ 42  ICP A+B (-15% C-priority → nurture)
→ 34  sent (buffer for content validation fails)
```

### Daily Category Rotation
```
Monday:    Shopify / D2C brands
Tuesday:   Real estate agencies
Wednesday: Funded startups / recently opened businesses
Thursday:  Restaurants / cafes / food businesses
Friday:    Agencies / consultancies
Saturday:  Healthcare / clinics / salons
```

### ICP Scoring Rubric
```
+3  India-based B2C-facing (restaurant, salon, real estate, D2C)
+2  20+ Google reviews (established business, has budget)
+2  WordPress/Wix/Squarespace stack (easiest sell)
+2  Website last updated 2+ years ago
+1  Active Instagram/Facebook but neglected website
+1  WhatsApp Business on site but no online booking/ordering
-2  Freelancer or solo consultant (low budget)
-3  Already on modern stack (Next.js, custom React, Webflow)
```

### Daily API Cost (150 raw leads)
| Service | Volume | Daily ₹ |
|---|---|---|
| Gemini Flash tokens | All 150 leads | ~₹37 |
| MyEmailVerifier | ~70 verifications | ~₹17 |
| Claude Sonnet (hooks) | ~42 leads | ~₹16 |
| Claude Haiku (bodies) | ~34 leads | ~₹5 |
| **Total** | | **~₹75/day** |

---

## 7. Engine 2 — Anti-Spam Engine

### Layer 1: DNS Authentication (one-time)
```
SPF:   v=spf1 include:_spf.google.com ~all
DKIM:  google._domainkey CNAME from GWS Admin → Apps → Gmail → Authenticate email
DMARC: v=DMARC1; p=none; rua=mailto:darshan@simpleinc.in
```
Verify at mxtoolbox.com/SuperTool before any send.

### Layer 2: Sending Behaviour (in sendEmails.js)
```
DAILY_SEND_LIMIT:    34 total (17/inbox)
Random delay:        180–420 seconds between each send
Send window:         9:30 AM – 5:30 PM IST only
Send days:           Mon–Sat, never Sunday
Holidays blocked:    Diwali week, Holi, Republic Day, Independence Day
Volume ramp:         Week 5=20/day, Week 6=28/day, Week 7+=34/day
Warmup:              Instantly Growth, 30–40/inbox/day, runs 24/7 always
```

### Layer 3: Content Validator (utils/contentValidator.js)
```
✗ HTML detected → reject
✗ Word count outside 40–90 → reject
✗ Any URL/link in cold email step 0–1 → reject
✗ Spam word from SPAM_WORDS env → reject
✗ Subject >8 words, contains ! or ? or ALL CAPS → reject
✗ Unfilled variable {{ detected → reject
On fail: regenerate once. Second fail → skip lead, log content_rejected.
```

### Layer 4: Health Monitoring (Phase 1 — low volume)
```
Bounce rate    >2.0% → DAILY_SEND_LIMIT=0 + Telegram 🚨
Unsub rate     >1.0% rolling 7d → Telegram ⚠️
Blacklist check  Weekly DNS: dbl.spamhaus.org / b.barracudacentral.org / multi.surbl.org
If listed → DAILY_SEND_LIMIT=0 + Telegram 🚨

Postmaster Tools API: Phase 2 only (needs 100+ Gmail recipients/day)
mail-tester.com: Manual weekly check every Monday. Target 9–10/10.
```

---

## 8. Engine 3 — Email Sending Engine

### sendEmails.js Flow
```
1. Verify SMTP connections for both inboxes at startup
2. Check IST time — exit if outside send window
3. Check Sunday/holiday list — exit if true
4. Check DAILY_SEND_LIMIT against today's SQLite count
5. Check bounce_rate_today — if >2% pause immediately
6. Pull lead queue: status='ready', not in reject_list, icp_priority IN ('A','B')
   ORDER BY icp_priority ASC, icp_score DESC
7. For each lead:
   a. Round-robin inbox: totalSentToday % 2
   b. Generate email body via Haiku (hook already in lead record)
   c. Run contentValidator — regenerate once on fail, skip on second fail
   d. transporter.sendMail() — plain text only, no html field
   e. Success → update lead.status='sent', write to emails table with message_id
   f. 5xx → log hard bounce, add to reject_list, recheck bounce rate
   g. 4xx → log soft bounce, schedule retry +24h
   h. await sleep(randomBetween(MIN_DELAY, MAX_DELAY))
8. Write session summary to cron_log
```

### sendFollowups.js — 5-Step Sequence
| Step | Day offset | Angle | Format |
|---|---|---|---|
| 0 | Day 0 | Cold — specific website problem hook | New email |
| 1 | +3 days | Short bump — "Just checking if this landed" | Thread reply |
| 2 | +7 days | Value angle — mini case study / specific result | Thread reply |
| 3 | +14 days | Breakup — "I'll leave you alone after this" | Thread reply |
| 4 | +90 days | Quarterly nurture — seasonal check-in | New thread |

**Threading:** `inReplyTo` = `message_id` of previous email. `references` header chained.
Store in `sequence_state` table. Subject = "Re: {original subject}" for steps 1–3.

**Stop conditions:** any reply received · unsubscribed · 2+ hard bounces from domain · step 4 completed

---

## 9. Engine 4 — Reply Intelligence Engine (`checkReplies.js`)

**Library:** imapflow (NOT node-imap — deprecated/unmaintained)
**Schedule:** 2:00 PM, 4:00 PM, 8:00 PM IST daily
**Connects to:** Both inboxes via imap.gmail.com:993 with app passwords

### Classification (Claude Haiku)
```
Categories: hot / schedule / soft_no / unsubscribe / ooo / other

hot        → Telegram 🔥 "Hot lead: {name} — {company}" + update lead status
schedule   → Telegram 📅 "Wants to schedule: {name}" + update lead status
soft_no    → Re-queue +14 days, pause sequence
unsubscribe→ Add to reject_list permanently, stop all sequences
ooo        → Re-queue +5 days, parse return date if present
other      → Log only, no action
```

---

## 10. Engine 5 — Reporting + Alerting (`dailyReport.js`)

**Schedule:** 8:30 PM IST

**Telegram daily one-liner:**
```
📊 Radar — {DD MMM}
🔍 Found: {discovered} → ✉️ Sent: {sent} → 💬 Replied: {total_replies}
🔥 Hot: {hot} | 📅 Schedule: {schedule} | 🚫 Unsub: {unsubscribe}
📈 Reply rate: {rate}% | Bounce: {bounce_rate}% | Cost: ₹{inr}
```

**Email digest:** HTML report to darshan@simpleinc.in with full funnel, cron status, errors.

---

## 11. Dashboard — radar.simpleinc.cloud

React 18 + Express API. Nginx reverse-proxy. Reads SQLite directly via Express routes.

### Pages

#### Overview (Home)
- Metric cards: leads discovered / emails sent today+week+month / active sequences / hot leads 7d / reply rate 7d / bounce rate today / API cost this month
- **Funnel waterfall:** Discovered → Extracted → Judge Passed → Email Found → Email Valid → ICP A+B → Sent → Replied (with counts + % drop at each stage)
- Send activity heatmap (GitHub-style, last 90 days)

#### Lead Pipeline
- Full leads table with filters: status / priority / category / city / tech stack / date range
- Columns: business name + URL / category / city / tech stack badges / ICP score / priority / contact / email status / business signals / status / discovered at
- Click lead → detail panel showing all extracted data, hook text, all emails sent, all replies, sequence state

#### Send Log
- Every email sent: timestamp / business name / **from inbox** / **from domain** / subject / word count / sequence step / delivery status / SMTP code / **send duration ms** / hook model / body model / cost ₹ / reply received
- Aggregates: total sent / hard bounces / soft bounces / content rejected / avg duration / total cost
- Filters: inbox / status / date range / sequence step

#### Reply Feed
- Real-time feed of all inbound replies
- Columns: received at / from / category badge / sentiment / reply preview / inbox received at / actioned status
- Hot and Schedule pinned to top in green
- Action buttons: Mark actioned / Add to reject list

#### Sequence Tracker
- Per-lead sequence state: business / step / next send date / last sent / subject chain / status
- Aggregates: active / paused / completed / replied / unsubscribed

#### Cron Job Status ⚡ (Critical ops panel)
**Shows daily status of all 9 jobs:**

```
Job card format:
┌──────────────────────────────────────────────┐
│ findLeads.js              🟢 SUCCESS          │
│ Scheduled: 09:00 AM   Started: 09:00:04 AM   │
│ Completed: 09:04:31 AM  Duration: 4m 27s     │
│ Records: 147 found / 3 skipped               │
│ API cost: ₹38.40                             │
└──────────────────────────────────────────────┘
```

**Status indicators:**
- 🟢 SUCCESS — completed normally
- 🔴 FAILED — threw an error (error message shown inline)
- 🟡 RUNNING — currently in progress
- ⚫ NOT TRIGGERED — scheduled time passed >30 min ago, no cron_log entry exists (critical red alert)
- ⬜ SKIPPED — ran but exited early (outside window / limit reached / etc.)

**All 9 jobs tracked:**
1. findLeads — 09:00 AM
2. sendEmails — 09:30 AM
3. checkReplies pass 1 — 02:00 PM
4. checkReplies pass 2 — 04:00 PM
5. sendFollowups — 06:00 PM
6. checkReplies pass 3 — 08:00 PM
7. dailyReport — 08:30 PM
8. healthCheck — 02:00 AM Sunday
9. backup — 02:00 AM daily

**NOT TRIGGERED detection:**
```js
// For each job: if scheduled_at was >30 min ago AND no cron_log entry today → NOT TRIGGERED
// Surface as red banner alert at top of cron status page
// Telegram alert sent automatically: "⚫ findLeads NOT TRIGGERED at 09:00 AM"
```

**Job history:** Last 30 runs per job — date / duration / status / records / cost / error.

#### Health Monitor
- Domain blacklist status (last checked) — per zone with ✅/🚨
- Sending health gauges: bounce rate / unsubscribe rate / spam rate
  - Green <threshold / Amber approaching / Red exceeded = PAUSED
- Inbox health: SMTP + IMAP connection status, last successful send for each inbox
- mail-tester.com score: manual entry field with date
- Postmaster reputation: manual entry (Phase 2 — shows "insufficient volume" note in Phase 1)

#### Cost Tracker
- Daily stacked bar chart (30 days): Gemini / Sonnet / Haiku / MEV
- Monthly cost table: per service, calls/month, unit cost, total ₹
- Per-email avg cost (₹)
- Model A/B comparison table (when testing alternate models)

#### Error Log
- Table: occurred at / source / job / error type / code / message / lead ID / email ID / resolved
- Unresolved count badge on nav
- Filters: source / error type / resolved / date range

---

## 12. Tech Stack

| Layer | Tool | Purpose |
|---|---|---|
| Runtime | Node.js 20+ LTS | All backend scripts |
| Process mgr | PM2 | Keep alive, cron scheduling |
| Scheduler | node-cron | Job scheduling within PM2 |
| Database | better-sqlite3 | WAL-mode SQLite |
| Email send | nodemailer | SMTP via GWS smtp.gmail.com:587 |
| Email read | imapflow | IMAP via GWS imap.gmail.com:993 |
| Env vars | dotenv | .env loading |
| Alerts | node-telegram-bot-api | Telegram notifications |
| AI search/extract | @google/generative-ai | Gemini 2.5 Flash |
| AI writing | @anthropic-ai/sdk | Claude Sonnet + Haiku |
| Email verification | axios + MEV REST API | MyEmailVerifier |
| Dashboard FE | React 18 | Dashboard UI |
| Dashboard API | Express | SQLite → REST JSON |
| Web server | Nginx | Reverse proxy → radar.simpleinc.cloud |
| Backup | rclone | SQLite → Backblaze B2 |

---

## 13. Non-Negotiable Rules

1. **Plain text emails only.** Never use `html:` field in Nodemailer. Never.
2. **No tracking pixels. No open tracking. No click tracking.** Ever.
3. **No links in cold email step 0 or step 1.** Only from step 2 if natural.
4. **contentValidator runs before every sendMail call.** No exceptions.
5. **Bounce rate checked before each send.** >2% = DAILY_SEND_LIMIT=0 + abort immediately.
6. **Send window enforced.** No sends outside 9:30 AM – 5:30 PM IST.
7. **cron_log written at job start AND end.** status='running' → 'success'/'failed'.
8. **All errors written to error_log table.** Never swallow silently.
9. **Follow-ups use inReplyTo + references headers.** Never send as new emails.
10. **reject_list is permanent and absolute.** No code bypasses it.
11. **DAILY_SEND_LIMIT=0 is a hard stop.** Nothing sends if this is 0.
12. **All AI calls log model + cost** to emails table and daily_metrics.
13. **From domain must be trysimpleinc.com.** Assert this before any send.
14. **simpleinc.in is never touched for outreach.** Zero exceptions.
15. **ICP C-priority → status='nurture'**, not discarded. Re-queue potential in Phase 2.
16. **Gemini grounding stays on free tier.** 150 queries/day << 1,500/day limit.

---

## 14. Phase Roadmap

### Phase 1 (Weeks 1–8) — Current
- 1 domain (trysimpleinc.com), 1 GWS account, 2 inboxes, 34 emails/day
- India targets: Mumbai, Bangalore, Delhi NCR, Pune
- Weeks 1–4: DAILY_SEND_LIMIT=0 (warmup only)
- Week 5: 20/day soft launch
- Week 6: 28/day
- Week 7+: 34/day full pilot
- Monitoring: SMTP codes + Haiku reply classification + weekly mail-tester.com
- No Postmaster API (volume insufficient — needs 100+ Gmail/day)

### Phase 2 (Months 2–3)
- 2nd domain + 4 more inboxes → 68 emails/day
- Enable Postmaster Tools API
- US East Coast window: 7:30–9:30 PM IST
- SQLite → PostgreSQL if >200 emails/day
- GlockApps inbox placement testing ($12/mo)

### Phase 3 (Months 4–6)
- 3 domains, 9 inboxes, 150 emails/day
- International (US, UK, Australia)
- Redis + BullMQ for queue management
- Productise: "done-for-you outbound setup" retainer offering

---

## 15. Monthly Cost Reference

| Item | Cost/month |
|---|---|
| AI / API (Engine 1) | ~₹1,875 |
| Instantly Growth (warmup) | ₹3,100 |
| GWS 2 inboxes (Leads Monky) | ₹420 |
| trysimpleinc.com domain | ₹70 |
| Ubuntu VPS | existing |
| **Total** | **~₹5,465** |

ROI: 1 client at ₹40,000 = 7.3× monthly system cost.
