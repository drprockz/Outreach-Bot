-- ── LEADS ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leads (
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
CREATE TABLE IF NOT EXISTS emails (
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
CREATE TABLE IF NOT EXISTS bounces (
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
CREATE TABLE IF NOT EXISTS replies (
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
CREATE TABLE IF NOT EXISTS reject_list (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  email                 TEXT UNIQUE,
  domain                TEXT,
  reason                TEXT,          -- unsubscribe / hard_bounce / manual
  added_at              DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ── CRON JOB LOG ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cron_log (
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
CREATE TABLE IF NOT EXISTS daily_metrics (
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
CREATE TABLE IF NOT EXISTS error_log (
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
CREATE TABLE IF NOT EXISTS sequence_state (
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
CREATE INDEX IF NOT EXISTS idx_leads_status        ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_icp           ON leads(icp_priority, icp_score);
CREATE INDEX IF NOT EXISTS idx_leads_email         ON leads(contact_email);
CREATE INDEX IF NOT EXISTS idx_emails_lead         ON emails(lead_id);
CREATE INDEX IF NOT EXISTS idx_emails_sent_at      ON emails(sent_at);
CREATE INDEX IF NOT EXISTS idx_emails_status       ON emails(status);
CREATE INDEX IF NOT EXISTS idx_replies_lead        ON replies(lead_id);
CREATE INDEX IF NOT EXISTS idx_cron_log_job        ON cron_log(job_name, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_daily_metrics_date  ON daily_metrics(date);
CREATE INDEX IF NOT EXISTS idx_error_log_source    ON error_log(source, occurred_at);
CREATE INDEX IF NOT EXISTS idx_reject_list_email   ON reject_list(email);
CREATE INDEX IF NOT EXISTS idx_reject_list_domain  ON reject_list(domain);
