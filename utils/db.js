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

export function logError(source, err) {
  getDb().prepare(
    `INSERT INTO error_log (source, message, stack) VALUES (?, ?, ?)`
  ).run(source, err.message || String(err), err.stack || null);
}

export function logCron(jobName) {
  const info = getDb().prepare(
    `INSERT INTO cron_log (job_name, started_at, status) VALUES (?, datetime('now'), 'running') RETURNING id`
  ).get(jobName);
  return info.id;
}

export function finishCron(id, { status = 'ok', leadsFound = 0, emailsSent = 0, costUsd = 0, error = null } = {}) {
  getDb().prepare(
    `UPDATE cron_log SET finished_at=datetime('now'), status=?, leads_found=?, emails_sent=?, cost_usd=?, error=? WHERE id=?`
  ).run(status, leadsFound, emailsSent, costUsd, error, id);
}

export function isRejected(email) {
  const domain = email.split('@')[1];
  const row = getDb().prepare(
    `SELECT 1 FROM reject_list WHERE email=? OR domain=? LIMIT 1`
  ).get(email, domain);
  return !!row;
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
    `SELECT emails_sent, bounces FROM daily_metrics WHERE date=?`
  ).get(today());
  if (!row || row.emails_sent === 0) return 0;
  return row.bounces / row.emails_sent;
}
