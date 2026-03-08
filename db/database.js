import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'outreach.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// --- Schema ---

export function initSchema() {
  const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
  db.exec(schema);
}

// --- Leads ---

export function insertLead({ name, company, email, type, location, website, pain_point, source }) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO leads (name, company, email, type, location, website, pain_point, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  return stmt.run(name, company, email, type, location, website, pain_point, source);
}

export function markEmailVerified(leadId) {
  db.prepare('UPDATE leads SET email_verified = 1 WHERE id = ?').run(leadId);
}

export function getLeadByEmail(email) {
  return db.prepare('SELECT * FROM leads WHERE email = ?').get(email);
}

export function getLeadById(id) {
  return db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
}

// --- Emails ---

export function insertEmail({ lead_id, sequence, subject, body }) {
  const stmt = db.prepare(`
    INSERT INTO emails (lead_id, sequence, subject, body)
    VALUES (?, ?, ?, ?)
  `);
  return stmt.run(lead_id, sequence, subject, body);
}

export function updateEmailStatus(emailId, status, sesMessageId = null) {
  db.prepare(`
    UPDATE emails SET status = ?, ses_message_id = ?, sent_at = datetime('now')
    WHERE id = ?
  `).run(status, sesMessageId, emailId);
}

export function getEmailById(id) {
  return db.prepare('SELECT * FROM emails WHERE id = ?').get(id);
}

export function getLastEmailForLead(leadId) {
  return db.prepare(`
    SELECT * FROM emails WHERE lead_id = ? ORDER BY sequence DESC LIMIT 1
  `).get(leadId);
}

export function getTodaysSentCount() {
  return db.prepare(`
    SELECT COUNT(*) as count FROM emails
    WHERE sent_at >= date('now') AND status = 'sent'
  `).get().count;
}

export function getEmailsPaginated(page = 1, limit = 20, status = null, sequence = null) {
  let where = "WHERE e.status = 'sent'";
  const filterParams = [];
  if (status) { where += ' AND e.status = ?'; filterParams.push(status); }
  if (sequence) { where += ' AND e.sequence = ?'; filterParams.push(parseInt(sequence, 10)); }
  const offset = (page - 1) * limit;

  const rows = db.prepare(`
    SELECT e.*, l.name, l.company, l.email AS lead_email
    FROM emails e JOIN leads l ON l.id = e.lead_id
    ${where}
    ORDER BY e.sent_at DESC
    LIMIT ? OFFSET ?
  `).all(...filterParams, limit, offset);

  const total = db.prepare(`SELECT COUNT(*) as count FROM emails e ${where}`).get(...filterParams).count;
  return { rows, total };
}

export function getEmailWithDetails(id) {
  return db.prepare(`
    SELECT e.*, l.name, l.company, l.email AS lead_email, l.website, l.type
    FROM emails e JOIN leads l ON l.id = e.lead_id
    WHERE e.id = ?
  `).get(id);
}

// --- Pipeline ---

export function upsertPipeline({ lead_id, status, last_contacted_at, next_followup_at, next_followup_sequence, notes }) {
  const existing = db.prepare('SELECT * FROM pipeline WHERE lead_id = ?').get(lead_id);
  if (existing) {
    db.prepare(`
      UPDATE pipeline SET status = ?, last_contacted_at = COALESCE(?, last_contacted_at),
        next_followup_at = ?, next_followup_sequence = ?, notes = COALESCE(?, notes),
        updated_at = datetime('now')
      WHERE lead_id = ?
    `).run(status, last_contacted_at, next_followup_at, next_followup_sequence, notes, lead_id);
  } else {
    db.prepare(`
      INSERT INTO pipeline (lead_id, status, last_contacted_at, next_followup_at, next_followup_sequence, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(lead_id, status, last_contacted_at, next_followup_at, next_followup_sequence, notes);
  }
}

export function updatePipelineStatus(leadId, status, notes = null) {
  db.prepare(`
    UPDATE pipeline SET status = ?, notes = ?, updated_at = datetime('now')
    WHERE lead_id = ?
  `).run(status, notes, leadId);
}

export function getLeadsToContact(limit) {
  return db.prepare(`
    SELECT l.* FROM leads l
    JOIN pipeline p ON p.lead_id = l.id
    WHERE p.status = 'cold' AND l.email_verified = 1
    ORDER BY l.created_at ASC
    LIMIT ?
  `).all(limit);
}

export function getDueFollowups() {
  return db.prepare(`
    SELECT p.*, l.name, l.company, l.email, l.website, l.pain_point, l.type
    FROM pipeline p
    JOIN leads l ON l.id = p.lead_id
    WHERE p.status = 'contacted'
      AND p.next_followup_at <= datetime('now')
      AND p.next_followup_sequence <= 4
  `).all();
}

export function getPipelineStats() {
  return db.prepare(`
    SELECT status, COUNT(*) as count FROM pipeline GROUP BY status
  `).all();
}

export function getPipelineGrouped() {
  return db.prepare(`
    SELECT p.*, l.name, l.company, l.email, l.website, l.type, l.location, l.pain_point
    FROM pipeline p
    JOIN leads l ON l.id = p.lead_id
    ORDER BY p.updated_at DESC
  `).all();
}

export function getPipelineLeadDetail(leadId) {
  const lead = db.prepare(`
    SELECT l.*, p.status AS pipeline_status, p.last_contacted_at, p.next_followup_at,
      p.next_followup_sequence, p.notes AS pipeline_notes, p.updated_at AS pipeline_updated
    FROM leads l
    LEFT JOIN pipeline p ON p.lead_id = l.id
    WHERE l.id = ?
  `).get(leadId);
  if (!lead) return null;
  const emails = db.prepare('SELECT * FROM emails WHERE lead_id = ? ORDER BY sequence ASC').all(leadId);
  const replies = db.prepare('SELECT * FROM replies WHERE lead_id = ? ORDER BY received_at DESC').all(leadId);
  return { ...lead, emails, replies };
}

// --- Replies ---

export function insertReply({ email_id, lead_id, received_at, raw_subject, raw_body, classification, summary }) {
  const stmt = db.prepare(`
    INSERT INTO replies (email_id, lead_id, received_at, raw_subject, raw_body, classification, summary)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  return stmt.run(email_id, lead_id, received_at, raw_subject, raw_body, classification, summary);
}

export function markReplyAlerted(replyId) {
  db.prepare('UPDATE replies SET alerted = 1 WHERE id = ?').run(replyId);
}

// --- Stats ---

export function getTodaysStats() {
  const sent = db.prepare(`SELECT COUNT(*) as count FROM emails WHERE date(sent_at) = date('now') AND status = 'sent'`).get().count;
  const bounced = db.prepare(`SELECT COUNT(*) as count FROM emails WHERE date(sent_at) = date('now') AND status = 'bounced'`).get().count;
  const followups = db.prepare(`SELECT COUNT(*) as count FROM emails WHERE date(sent_at) = date('now') AND status = 'sent' AND sequence > 1`).get().count;
  const replies = db.prepare(`SELECT COUNT(*) as count FROM replies WHERE date(received_at) = date('now')`).get().count;
  const hot = db.prepare(`SELECT COUNT(*) as count FROM replies WHERE date(received_at) = date('now') AND classification = 'hot'`).get().count;
  const schedule = db.prepare(`SELECT COUNT(*) as count FROM replies WHERE date(received_at) = date('now') AND classification = 'schedule'`).get().count;
  const unsub = db.prepare(`SELECT COUNT(*) as count FROM replies WHERE date(received_at) = date('now') AND classification = 'unsubscribe'`).get().count;
  return { sent, bounced, followups, replies, hot, schedule, unsub };
}

export function getMonthToDateStats() {
  const since = new Date().toISOString().slice(0, 7); // YYYY-MM
  const sent = db.prepare(`SELECT COUNT(*) as count FROM emails WHERE strftime('%Y-%m', sent_at) = ? AND status = 'sent'`).get(since).count;
  const replies = db.prepare(`SELECT COUNT(*) as count FROM replies WHERE strftime('%Y-%m', received_at) = ?`).get(since).count;
  const hot = db.prepare(`SELECT COUNT(*) as count FROM replies WHERE strftime('%Y-%m', received_at) = ? AND classification = 'hot'`).get(since).count;
  const closed = db.prepare(`SELECT COUNT(*) as count FROM pipeline WHERE status = 'closed' AND strftime('%Y-%m', updated_at) = ?`).get(since).count;
  const replyRate = sent > 0 ? ((replies / sent) * 100).toFixed(1) : '0.0';
  const costRow = db.prepare(`SELECT COALESCE(SUM(cost_usd), 0) as total FROM api_costs WHERE strftime('%Y-%m', called_at) = ?`).get(since);
  const costUsd = costRow.total;
  const costInr = (costUsd * 85).toFixed(0);
  return { sent, replies, hot, closed, replyRate, costUsd: costUsd.toFixed(2), costInr };
}

export function getTodaysHotLeads() {
  return db.prepare(`
    SELECT r.*, l.name, l.company, l.email
    FROM replies r JOIN leads l ON l.id = r.lead_id
    WHERE date(r.received_at) = date('now') AND r.classification = 'hot'
  `).all();
}

export function getTodaysScheduleLeads() {
  return db.prepare(`
    SELECT r.*, l.name, l.company, l.email
    FROM replies r JOIN leads l ON l.id = r.lead_id
    WHERE date(r.received_at) = date('now') AND r.classification = 'schedule'
  `).all();
}

export function getTodaysSoftLeads() {
  return db.prepare(`
    SELECT r.*, l.name, l.company, l.email
    FROM replies r JOIN leads l ON l.id = r.lead_id
    WHERE date(r.received_at) = date('now') AND r.classification = 'soft'
  `).all();
}

export function getTomorrowFollowupCount() {
  return db.prepare(`
    SELECT COUNT(*) as count FROM pipeline
    WHERE status = 'contacted'
      AND next_followup_at >= date('now', '+1 day')
      AND next_followup_at < date('now', '+2 days')
  `).get().count;
}

export function findEmailBySenderSubject(senderEmail, subject) {
  const cleanSubject = subject.replace(/^(Re:\s*)+/i, '').trim();
  return db.prepare(`
    SELECT e.* FROM emails e
    JOIN leads l ON l.id = e.lead_id
    WHERE l.email = ? AND (e.subject = ? OR e.subject = ?)
    ORDER BY e.sequence DESC LIMIT 1
  `).get(senderEmail, subject, cleanSubject);
}

// --- Overview (for dashboard API) ---

export function getOverviewData() {
  const today = getTodaysStats();
  const hotLeads = db.prepare(`
    SELECT l.name, l.company, l.email, r.summary, r.raw_body, r.received_at, p.status AS pipeline_status
    FROM replies r JOIN leads l ON r.lead_id = l.id
    JOIN pipeline p ON p.lead_id = l.id
    WHERE p.status IN ('hot', 'schedule')
    ORDER BY r.received_at DESC LIMIT 10
  `).all();
  const chartData = db.prepare(`
    SELECT date(sent_at) AS day, COUNT(*) AS sent
    FROM emails WHERE sent_at >= datetime('now', '-7 days') AND status = 'sent'
    GROUP BY day ORDER BY day
  `).all();
  const replyChart = db.prepare(`
    SELECT date(received_at) AS day, COUNT(*) AS replies
    FROM replies WHERE received_at >= datetime('now', '-7 days')
    GROUP BY day ORDER BY day
  `).all();
  return { today, hotLeads, chartData, replyChart };
}

// --- Analytics (for dashboard API) ---

export function getAnalyticsData() {
  const funnel = getPipelineStats();
  const byCategory = db.prepare(`
    SELECT l.type AS category, COUNT(DISTINCT l.id) AS leads,
      COUNT(DISTINCT e.id) AS emails_sent,
      COUNT(DISTINCT r.id) AS replies
    FROM leads l
    LEFT JOIN emails e ON e.lead_id = l.id AND e.status = 'sent'
    LEFT JOIN replies r ON r.lead_id = l.id
    GROUP BY l.type
  `).all();
  const bySequence = db.prepare(`
    SELECT e.sequence,
      COUNT(DISTINCT e.id) AS sent,
      COUNT(DISTINCT r.id) AS replies,
      CASE WHEN COUNT(DISTINCT e.id) > 0
        THEN ROUND(COUNT(DISTINCT r.id) * 100.0 / COUNT(DISTINCT e.id), 1)
        ELSE 0 END AS reply_rate
    FROM emails e LEFT JOIN replies r ON r.email_id = e.id
    WHERE e.status = 'sent'
    GROUP BY e.sequence
  `).all();
  return { funnel, byCategory, bySequence };
}

// --- Costs ---

export function logApiCost({ job, inputTokens, outputTokens }) {
  const inputCostPer1k = 0.003;
  const outputCostPer1k = 0.015;
  const cost = (inputTokens / 1000 * inputCostPer1k) + (outputTokens / 1000 * outputCostPer1k);
  db.prepare(`
    INSERT INTO api_costs (job, input_tokens, output_tokens, cost_usd)
    VALUES (?, ?, ?, ?)
  `).run(job, inputTokens, outputTokens, cost);
}

export function getCostSummary() {
  const today = db.prepare(`SELECT COALESCE(SUM(cost_usd), 0) as total FROM api_costs WHERE date(called_at) = date('now')`).get().total;
  const week = db.prepare(`SELECT COALESCE(SUM(cost_usd), 0) as total FROM api_costs WHERE called_at >= datetime('now', '-7 days')`).get().total;
  const month = db.prepare(`SELECT COALESCE(SUM(cost_usd), 0) as total FROM api_costs WHERE strftime('%Y-%m', called_at) = strftime('%Y-%m', 'now')`).get().total;
  const breakdown = db.prepare(`
    SELECT job, SUM(cost_usd) AS total, SUM(input_tokens) AS input_t, SUM(output_tokens) AS output_t, COUNT(*) AS calls
    FROM api_costs WHERE strftime('%Y-%m', called_at) = strftime('%Y-%m', 'now')
    GROUP BY job
  `).all();
  return { today, week, month, breakdown };
}

export function getCostChart() {
  return db.prepare(`
    SELECT date(called_at) AS day, SUM(cost_usd) AS cost, SUM(input_tokens) AS input_t, SUM(output_tokens) AS output_t
    FROM api_costs WHERE called_at >= datetime('now', '-30 days')
    GROUP BY day ORDER BY day
  `).all();
}

// --- Daily Reports ---

export function insertDailyReport({ report_date, sent_count, bounce_count, reply_count, hot_count, schedule_count, followup_count, html_body }) {
  db.prepare(`
    INSERT OR REPLACE INTO daily_reports (report_date, sent_count, bounce_count, reply_count, hot_count, schedule_count, followup_count, html_body)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(report_date, sent_count, bounce_count, reply_count, hot_count, schedule_count, followup_count, html_body);
}

export function getDailyReportsList() {
  return db.prepare(`
    SELECT report_date, sent_count, reply_count, hot_count, schedule_count
    FROM daily_reports ORDER BY report_date DESC
  `).all();
}

export function getDailyReportByDate(date) {
  return db.prepare('SELECT * FROM daily_reports WHERE report_date = ?').get(date);
}

export default db;
