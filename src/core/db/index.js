import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import 'dotenv/config';

const __dirname = dirname(fileURLToPath(import.meta.url));

let _db;

export function getDb() {
  if (!_db) {
    _db = new Database(process.env.DB_PATH || '/home/radar/db/radar.sqlite');
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
  }
  return _db;
}

/** For tests only — close and reset the singleton so DB_PATH changes take effect */
export function resetDb() {
  if (_db) { _db.close(); _db = null; }
}

export function initSchema() {
  const sql = readFileSync(join(__dirname, '../db/schema.sql'), 'utf8');
  getDb().exec(sql);
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function bumpMetric(field, amount = 1) {
  const db = getDb();
  const d = today();
  db.prepare(`INSERT INTO daily_metrics (date) VALUES (?) ON CONFLICT(date) DO NOTHING`).run(d);
  db.prepare(`UPDATE daily_metrics SET ${field} = ${field} + ? WHERE date = ?`).run(amount, d);
}

export function logError(source, err, { jobName, errorType, errorCode, leadId, emailId } = {}) {
  getDb().prepare(
    `INSERT INTO error_log (source, job_name, error_type, error_code, error_message, stack_trace, lead_id, email_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(source, jobName || null, errorType || null, errorCode || null,
        err.message || String(err), err.stack || null, leadId || null, emailId || null);
}

export function logCron(jobName) {
  const info = getDb().prepare(
    `INSERT INTO cron_log (job_name, scheduled_at, started_at, status) VALUES (?, datetime('now'), datetime('now'), 'running') RETURNING id`
  ).get(jobName);
  return info.id;
}

export function finishCron(id, { status = 'success', recordsProcessed = 0, recordsSkipped = 0, costUsd = 0, error = null } = {}) {
  const row = getDb().prepare(`SELECT started_at FROM cron_log WHERE id = ?`).get(id);
  const durationMs = row?.started_at
    ? Date.now() - new Date(row.started_at).getTime()
    : null;
  getDb().prepare(
    `UPDATE cron_log SET completed_at=datetime('now'), duration_ms=?, status=?, records_processed=?, records_skipped=?, cost_usd=?, error_message=? WHERE id=?`
  ).run(durationMs, status, recordsProcessed, recordsSkipped, costUsd, error, id);
}

export function isRejected(email) {
  const domain = email.split('@')[1];
  const row = getDb().prepare(
    `SELECT 1 FROM reject_list WHERE email=? OR domain=? LIMIT 1`
  ).get(email, domain);
  return !!row;
}

export function getConfigMap() {
  try {
    const rows = getDb().prepare('SELECT key, value FROM config').all();
    return Object.fromEntries(rows.map(r => [r.key, r.value]));
  } catch {
    return {};
  }
}

export function getConfigInt(cfg, key, fallback) {
  const v = parseInt(cfg[key]);
  return isNaN(v) ? fallback : v;
}

export function getConfigFloat(cfg, key, fallback) {
  const v = parseFloat(cfg[key]);
  return isNaN(v) ? fallback : v;
}

export function getConfigStr(cfg, key, fallback) {
  return cfg[key] ?? fallback;
}

export function seedConfigDefaults() {
  const db = getDb();
  const defaults = [
    ['daily_send_limit', '0'],
    ['max_per_inbox', '17'],
    ['send_delay_min_ms', '180000'],
    ['send_delay_max_ms', '420000'],
    ['send_window_start', '9'],
    ['send_window_end', '17'],
    ['bounce_rate_hard_stop', '0.02'],
    ['claude_daily_spend_cap', '3.00'],
    ['find_leads_enabled', '1'],
    ['send_emails_enabled', '1'],
    ['send_followups_enabled', '1'],
    ['check_replies_enabled', '1'],
    ['icp_threshold_a', '7'],
    ['icp_threshold_b', '4'],
    ['find_leads_per_batch', '30'],
    ['find_leads_cities',        '["Mumbai","Bangalore","Delhi NCR","Pune"]'],
    ['find_leads_business_size', 'msme'],
    ['find_leads_count',         '150'],
    ['persona_name', 'Darshan Parmar'],
    ['persona_role', 'Full-Stack Developer'],
    ['persona_company', 'Simple Inc'],
    ['persona_website', 'simpleinc.in'],
    ['persona_tone', 'professional but direct'],
    ['persona_services', 'Full-stack web development, redesigns, performance optimisation, custom React apps, API integrations'],
  ];
  const stmt = db.prepare('INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)');
  for (const [key, value] of defaults) stmt.run(key, value);
}

export function seedNichesAndIcpRules() {
  const db = getDb();

  const nicheCount = db.prepare('SELECT COUNT(*) as n FROM niches').get().n;
  if (nicheCount === 0) {
    const niches = [
      [1, 'Shopify/D2C brands', 'India D2C ecommerce brand Shopify outdated website'],
      [2, 'Real estate agencies', 'Mumbai real estate agency property portal outdated website'],
      [3, 'Funded startups', 'India funded B2B startup outdated website developer needed'],
      [4, 'Restaurants/cafes', 'Mumbai restaurant cafe outdated website no online booking'],
      [5, 'Agencies/consultancies', 'Mumbai digital agency overflow web development outsource'],
      [6, 'Healthcare/salons', 'India healthcare salon clinic outdated website no booking'],
    ];
    const stmt = db.prepare('INSERT INTO niches (day_of_week, label, query, enabled, sort_order) VALUES (?, ?, ?, 1, ?)');
    niches.forEach(([day, label, query], i) => stmt.run(day, label, query, i));
  }

  const ruleCount = db.prepare('SELECT COUNT(*) as n FROM icp_rules').get().n;
  if (ruleCount === 0) {
    const rules = [
      [3,  'India-based B2C-facing (restaurant, salon, real estate, D2C)', null],
      [2,  '20+ Google reviews (established business, has budget)', null],
      [2,  'WordPress/Wix/Squarespace stack (easiest sell)', null],
      [2,  'Website last updated 2+ years ago', null],
      [1,  'Active Instagram/Facebook but neglected website', null],
      [1,  'WhatsApp Business on site but no online booking/ordering', null],
      [-2, 'Freelancer or solo consultant (low budget)', null],
      [-3, 'Already on modern stack (Next.js, custom React, Webflow)', null],
    ];
    const stmt = db.prepare('INSERT INTO icp_rules (points, label, description, enabled, sort_order) VALUES (?, ?, ?, 1, ?)');
    rules.forEach(([points, label, desc], i) => stmt.run(points, label, desc, i));
  }
}

export function addToRejectList(email, reason) {
  const domain = email.split('@')[1];
  getDb().prepare(
    `INSERT OR IGNORE INTO reject_list (email, domain, reason) VALUES (?, ?, ?)`
  ).run(email, domain, reason);
}

export function todaySentCount() {
  const row = getDb().prepare(
    `SELECT emails_sent FROM daily_metrics WHERE date=?`
  ).get(today());
  return row?.emails_sent || 0;
}

export function todayBounceRate() {
  const row = getDb().prepare(
    `SELECT emails_sent, emails_hard_bounced FROM daily_metrics WHERE date=?`
  ).get(today());
  if (!row || row.emails_sent === 0) return 0;
  return row.emails_hard_bounced / row.emails_sent;
}
