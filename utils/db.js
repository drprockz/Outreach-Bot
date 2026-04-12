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
