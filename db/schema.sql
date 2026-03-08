-- leads: every prospect found by the lead finder
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  company TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  type TEXT,
  location TEXT,
  website TEXT,
  pain_point TEXT,
  source TEXT,
  email_verified INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- emails: every email sent including all follow-up sequences
CREATE TABLE IF NOT EXISTS emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER REFERENCES leads(id),
  sequence INTEGER DEFAULT 1,
  subject TEXT,
  body TEXT,
  sent_at TEXT,
  status TEXT DEFAULT 'pending',
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
  classification TEXT,
  summary TEXT,
  alerted INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- pipeline: current status of each lead relationship
CREATE TABLE IF NOT EXISTS pipeline (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER UNIQUE REFERENCES leads(id),
  status TEXT DEFAULT 'cold',
  last_contacted_at TEXT,
  next_followup_at TEXT,
  next_followup_sequence INTEGER DEFAULT 2,
  notes TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- api_costs: log every Claude API call for cost tracking dashboard
CREATE TABLE IF NOT EXISTS api_costs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job TEXT NOT NULL,
  model TEXT DEFAULT 'claude-sonnet-4-20250514',
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cost_usd REAL DEFAULT 0,
  called_at TEXT DEFAULT (datetime('now'))
);

-- daily_reports: store generated HTML so dashboard can show historical reports
CREATE TABLE IF NOT EXISTS daily_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_date TEXT UNIQUE NOT NULL,
  sent_count INTEGER DEFAULT 0,
  bounce_count INTEGER DEFAULT 0,
  reply_count INTEGER DEFAULT 0,
  hot_count INTEGER DEFAULT 0,
  schedule_count INTEGER DEFAULT 0,
  followup_count INTEGER DEFAULT 0,
  html_body TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
