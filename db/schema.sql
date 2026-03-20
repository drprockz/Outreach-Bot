CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company TEXT,
  website TEXT,
  contact_name TEXT,
  contact_email TEXT UNIQUE,
  niche TEXT,
  city TEXT,
  cms TEXT,
  business_signals TEXT,
  quality_score INTEGER,
  icp_score INTEGER,
  icp_priority TEXT,
  hook TEXT,
  email_subject TEXT,
  email_body TEXT,
  status TEXT DEFAULT 'new',
  gemini_cost_usd REAL DEFAULT 0,
  hook_cost_usd REAL DEFAULT 0,
  body_cost_usd REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER REFERENCES leads(id),
  sequence_step INTEGER DEFAULT 0,
  inbox TEXT,
  subject TEXT,
  body TEXT,
  message_id TEXT,
  status TEXT DEFAULT 'pending',
  sent_at TEXT,
  ai_cost_usd REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bounces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_id INTEGER REFERENCES emails(id),
  lead_id INTEGER REFERENCES leads(id),
  bounce_type TEXT,
  raw_error TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER REFERENCES leads(id),
  email_id INTEGER REFERENCES emails(id),
  inbox TEXT,
  subject TEXT,
  body TEXT,
  classification TEXT,
  classify_cost_usd REAL DEFAULT 0,
  received_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reject_list (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE,
  domain TEXT,
  reason TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cron_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_name TEXT,
  started_at TEXT,
  finished_at TEXT,
  status TEXT,
  leads_found INTEGER DEFAULT 0,
  emails_sent INTEGER DEFAULT 0,
  cost_usd REAL DEFAULT 0,
  error TEXT
);

CREATE TABLE IF NOT EXISTS daily_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT UNIQUE,
  leads_found INTEGER DEFAULT 0,
  emails_sent INTEGER DEFAULT 0,
  bounces INTEGER DEFAULT 0,
  replies INTEGER DEFAULT 0,
  hot_replies INTEGER DEFAULT 0,
  gemini_cost_usd REAL DEFAULT 0,
  sonnet_cost_usd REAL DEFAULT 0,
  haiku_cost_usd REAL DEFAULT 0,
  total_cost_usd REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS error_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT,
  message TEXT,
  stack TEXT,
  resolved INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sequence_state (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER UNIQUE REFERENCES leads(id),
  current_step INTEGER DEFAULT 0,
  next_send_at TEXT,
  last_message_id TEXT,
  last_references TEXT,
  status TEXT DEFAULT 'active',
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_icp_priority ON leads(icp_priority);
CREATE INDEX IF NOT EXISTS idx_leads_contact_email ON leads(contact_email);
CREATE INDEX IF NOT EXISTS idx_emails_sent_at ON emails(sent_at);
CREATE INDEX IF NOT EXISTS idx_emails_status ON emails(status);
CREATE INDEX IF NOT EXISTS idx_replies_lead_id ON replies(lead_id);
CREATE INDEX IF NOT EXISTS idx_cron_log_job_name ON cron_log(job_name);
CREATE INDEX IF NOT EXISTS idx_daily_metrics_date ON daily_metrics(date);
CREATE INDEX IF NOT EXISTS idx_error_log_source ON error_log(source);
CREATE INDEX IF NOT EXISTS idx_reject_list_email ON reject_list(email);
CREATE INDEX IF NOT EXISTS idx_reject_list_domain ON reject_list(domain);
