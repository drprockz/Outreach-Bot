import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getDb, today, initSchema, seedConfigDefaults, seedNichesAndIcpRules } from '../utils/db.js';
import 'dotenv/config';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json());

// Ensure all tables exist (safe to run on existing DB — uses CREATE TABLE IF NOT EXISTS)
initSchema();
seedConfigDefaults();
seedNichesAndIcpRules();

// ── Password hash (computed once at startup) ──────────────────────────────
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'radar';
const passwordHash = bcrypt.hashSync(DASHBOARD_PASSWORD, 10);

const JWT_SECRET = process.env.JWT_SECRET || 'default-secret-change-me';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// ── Auth middleware ────────────────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const token = header.slice(7);
  try {
    jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ── POST /api/auth/login ──────────────────────────────────────────────────
app.post('/api/auth/login', (req, res) => {
  const { password } = req.body || {};
  if (!password || !bcrypt.compareSync(password, passwordHash)) {
    return res.status(401).json({ error: 'Invalid password' });
  }
  const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
  res.json({ token });
});

// Apply auth to all /api routes below
app.use('/api', authMiddleware);

// ── GET /api/config ───────────────────────────────────────
app.get('/api/config', (req, res) => {
  const rows = getDb().prepare('SELECT key, value FROM config').all();
  res.json(Object.fromEntries(rows.map(r => [r.key, r.value])));
});

// ── PUT /api/config ───────────────────────────────────────
app.put('/api/config', (req, res) => {
  const updates = req.body || {};
  const stmt = getDb().prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(updates)) {
    stmt.run(key, String(value));
  }
  res.json({ ok: true });
});

// ── GET /api/niches ───────────────────────────────────────────────────────
app.get('/api/niches', (req, res) => {
  const niches = getDb().prepare('SELECT * FROM niches ORDER BY sort_order, id').all();
  res.json({ niches });
});

// ── POST /api/niches ──────────────────────────────────────────────────────
app.post('/api/niches', (req, res) => {
  const { label, query, day_of_week = null, enabled = 1 } = req.body || {};
  if (!label || !query) return res.status(400).json({ error: 'label and query are required' });
  if (query.length < 10) return res.status(400).json({ error: 'query must be at least 10 characters' });

  const db = getDb();
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) as m FROM niches').get().m;

  const createFn = db.transaction(() => {
    if (day_of_week !== null) {
      db.prepare('UPDATE niches SET day_of_week = NULL WHERE day_of_week = ?').run(day_of_week);
    }
    const result = db.prepare(
      'INSERT INTO niches (label, query, day_of_week, enabled, sort_order) VALUES (?, ?, ?, ?, ?)'
    ).run(label, query, day_of_week, enabled ? 1 : 0, maxOrder + 1);
    return db.prepare('SELECT * FROM niches WHERE id = ?').get(result.lastInsertRowid);
  });

  const niche = createFn();
  res.status(201).json({ niche });
});

// ── PUT /api/niches/:id ───────────────────────────────────────────────────
app.put('/api/niches/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const { label, query, day_of_week = null, enabled = 1, sort_order } = req.body || {};
  if (!label || !query) return res.status(400).json({ error: 'label and query are required' });

  const db = getDb();
  const existing = db.prepare('SELECT * FROM niches WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Niche not found' });

  const updateFn = db.transaction(() => {
    if (day_of_week !== null) {
      db.prepare('UPDATE niches SET day_of_week = NULL WHERE day_of_week = ? AND id != ?').run(day_of_week, id);
    }
    db.prepare(
      'UPDATE niches SET label=?, query=?, day_of_week=?, enabled=?, sort_order=? WHERE id=?'
    ).run(label, query, day_of_week, enabled ? 1 : 0, sort_order ?? existing.sort_order, id);
  });

  updateFn();
  res.json({ ok: true });
});

// ── DELETE /api/niches/:id ────────────────────────────────────────────────
app.delete('/api/niches/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const existing = getDb().prepare('SELECT id FROM niches WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Niche not found' });
  getDb().prepare('DELETE FROM niches WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ── GET /api/overview ─────────────────────────────────────────────────────
app.get('/api/overview', (req, res) => {
  const db = getDb();
  const d = today();

  const todayMetrics = db.prepare(`SELECT * FROM daily_metrics WHERE date = ?`).get(d) || {};

  const weekMetrics = db.prepare(`
    SELECT
      COALESCE(SUM(leads_discovered), 0) AS leads_discovered,
      COALESCE(SUM(emails_sent), 0) AS emails_sent,
      COALESCE(SUM(emails_hard_bounced), 0) AS emails_hard_bounced,
      COALESCE(SUM(replies_total), 0) AS replies_total,
      COALESCE(SUM(replies_hot), 0) AS replies_hot,
      COALESCE(SUM(total_api_cost_usd), 0) AS total_api_cost_usd
    FROM daily_metrics
    WHERE date >= date('now', '-7 days')
  `).get();

  const monthMetrics = db.prepare(`
    SELECT
      COALESCE(SUM(leads_discovered), 0) AS leads_discovered,
      COALESCE(SUM(emails_sent), 0) AS emails_sent,
      COALESCE(SUM(emails_hard_bounced), 0) AS emails_hard_bounced,
      COALESCE(SUM(replies_total), 0) AS replies_total,
      COALESCE(SUM(replies_hot), 0) AS replies_hot,
      COALESCE(SUM(total_api_cost_usd), 0) AS total_api_cost_usd
    FROM daily_metrics
    WHERE date >= date('now', '-30 days')
  `).get();

  // Funnel counts from leads table
  const funnel = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status NOT IN ('discovered', 'extraction_failed') THEN 1 ELSE 0 END) AS extracted,
      SUM(CASE WHEN website_quality_score IS NOT NULL THEN 1 ELSE 0 END) AS judged,
      SUM(CASE WHEN contact_email IS NOT NULL THEN 1 ELSE 0 END) AS email_found,
      SUM(CASE WHEN email_status = 'valid' OR email_status = 'catch-all' THEN 1 ELSE 0 END) AS email_valid,
      SUM(CASE WHEN icp_priority IN ('A','B') THEN 1 ELSE 0 END) AS icp_ab,
      SUM(CASE WHEN status IN ('sent','replied') THEN 1 ELSE 0 END) AS sent,
      SUM(CASE WHEN status = 'replied' THEN 1 ELSE 0 END) AS replied
    FROM leads
  `).get();

  const activeSeq = db.prepare(`SELECT COUNT(*) AS count FROM sequence_state WHERE status = 'active'`).get();

  const replyRate = weekMetrics.emails_sent > 0
    ? (weekMetrics.replies_total / weekMetrics.emails_sent * 100).toFixed(1)
    : '0.0';

  const bounceRate = (todayMetrics.emails_sent || 0) > 0
    ? ((todayMetrics.emails_hard_bounced || 0) / todayMetrics.emails_sent * 100).toFixed(1)
    : '0.0';

  // 90-day send activity for heatmap
  const sendActivity = db.prepare(`
    SELECT date, emails_sent FROM daily_metrics
    WHERE date >= date('now', '-90 days')
    ORDER BY date ASC
  `).all();

  res.json({
    metrics: {
      today: todayMetrics,
      week: weekMetrics,
      month: monthMetrics,
      activeSequences: activeSeq?.count || 0,
      replyRate7d: parseFloat(replyRate),
      bounceRateToday: parseFloat(bounceRate)
    },
    funnel,
    sendActivity
  });
});

// ── GET /api/leads ────────────────────────────────────────────────────────
app.get('/api/leads', (req, res) => {
  const db = getDb();
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const offset = (page - 1) * limit;

  const conditions = [];
  const params = [];

  if (req.query.status) {
    conditions.push('status = ?');
    params.push(req.query.status);
  }
  if (req.query.priority) {
    conditions.push('icp_priority = ?');
    params.push(req.query.priority);
  }
  if (req.query.category) {
    conditions.push('category = ?');
    params.push(req.query.category);
  }
  if (req.query.city) {
    conditions.push('city = ?');
    params.push(req.query.city);
  }
  if (req.query.tech_stack) {
    conditions.push('tech_stack LIKE ?');
    params.push(`%${req.query.tech_stack}%`);
  }
  if (req.query.date_from) {
    conditions.push('discovered_at >= ?');
    params.push(req.query.date_from);
  }
  if (req.query.date_to) {
    conditions.push('discovered_at <= ?');
    params.push(req.query.date_to);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const total = db.prepare(`SELECT COUNT(*) AS count FROM leads ${whereClause}`).get(...params).count;
  const leads = db.prepare(`
    SELECT * FROM leads ${whereClause}
    ORDER BY id DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  res.json({ leads, total, page, limit });
});

// ── GET /api/funnel ───────────────────────────────────────────────────────
app.get('/api/funnel', (req, res) => {
  const db = getDb();

  // Stage counts derived from leads table (live, not daily_metrics)
  const stages = db.prepare(`
    SELECT
      COUNT(*) AS discovered,
      SUM(CASE WHEN status NOT IN ('discovered','extraction_failed') THEN 1 ELSE 0 END) AS extracted,
      SUM(CASE WHEN website_quality_score IS NOT NULL THEN 1 ELSE 0 END) AS judge_passed,
      SUM(CASE WHEN contact_email IS NOT NULL THEN 1 ELSE 0 END) AS email_found,
      SUM(CASE WHEN email_status IN ('valid','catch-all') THEN 1 ELSE 0 END) AS email_valid,
      SUM(CASE WHEN icp_priority IN ('A','B') THEN 1 ELSE 0 END) AS icp_ab,
      SUM(CASE WHEN status = 'nurture' THEN 1 ELSE 0 END) AS nurture,
      SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END) AS ready,
      SUM(CASE WHEN status IN ('sent','replied','bounced') THEN 1 ELSE 0 END) AS sent,
      SUM(CASE WHEN status = 'replied' THEN 1 ELSE 0 END) AS replied,
      SUM(CASE WHEN status = 'unsubscribed' THEN 1 ELSE 0 END) AS unsubscribed,
      SUM(CASE WHEN icp_priority = 'A' THEN 1 ELSE 0 END) AS icp_a,
      SUM(CASE WHEN icp_priority = 'B' THEN 1 ELSE 0 END) AS icp_b,
      SUM(CASE WHEN icp_priority = 'C' THEN 1 ELSE 0 END) AS icp_c
    FROM leads
  `).get();

  // Drop reason breakdown
  const dropReasons = db.prepare(`
    SELECT
      SUM(CASE WHEN status = 'extraction_failed' THEN 1 ELSE 0 END) AS extraction_failed,
      SUM(CASE WHEN judge_skip = 1 THEN 1 ELSE 0 END) AS gate1_modern_stack,
      SUM(CASE WHEN website_quality_score IS NOT NULL AND contact_email IS NULL THEN 1 ELSE 0 END) AS no_email,
      SUM(CASE WHEN email_status IN ('invalid','disposable') THEN 1 ELSE 0 END) AS email_invalid,
      SUM(CASE WHEN status = 'deduped' THEN 1 ELSE 0 END) AS deduped,
      SUM(CASE WHEN icp_priority = 'C' THEN 1 ELSE 0 END) AS icp_c_nurture,
      SUM(CASE WHEN status = 'email_not_found' THEN 1 ELSE 0 END) AS email_not_found
    FROM leads
  `).get();

  // 30-day daily trend from daily_metrics
  const dailyTrend = db.prepare(`
    SELECT
      date,
      COALESCE(leads_discovered, 0) AS discovered,
      COALESCE(leads_extracted, 0) AS extracted,
      COALESCE(leads_judge_passed, 0) AS judge_passed,
      COALESCE(leads_email_found, 0) AS email_found,
      COALESCE(leads_email_valid, 0) AS email_valid,
      COALESCE(leads_icp_ab, 0) AS icp_ab,
      COALESCE(leads_ready, 0) AS ready,
      COALESCE(emails_sent, 0) AS sent
    FROM daily_metrics
    WHERE date >= date('now', '-30 days')
    ORDER BY date ASC
  `).all();

  // Category breakdown of ready/sent leads
  const byCategory = db.prepare(`
    SELECT
      COALESCE(category, 'unknown') AS category,
      COUNT(*) AS total,
      SUM(CASE WHEN icp_priority = 'A' THEN 1 ELSE 0 END) AS icp_a,
      SUM(CASE WHEN icp_priority = 'B' THEN 1 ELSE 0 END) AS icp_b,
      SUM(CASE WHEN icp_priority = 'C' THEN 1 ELSE 0 END) AS icp_c,
      SUM(CASE WHEN status IN ('ready','sent','replied') THEN 1 ELSE 0 END) AS ready_or_sent
    FROM leads
    GROUP BY category
    ORDER BY total DESC
    LIMIT 10
  `).all();

  // City breakdown
  const byCity = db.prepare(`
    SELECT
      COALESCE(city, 'unknown') AS city,
      COUNT(*) AS total,
      SUM(CASE WHEN status IN ('ready','sent','replied') THEN 1 ELSE 0 END) AS ready_or_sent
    FROM leads
    GROUP BY city
    ORDER BY total DESC
    LIMIT 8
  `).all();

  // ICP score distribution
  const icpDistribution = db.prepare(`
    SELECT icp_score, COUNT(*) AS count
    FROM leads
    WHERE icp_score IS NOT NULL
    GROUP BY icp_score
    ORDER BY icp_score ASC
  `).all();

  // Email status breakdown
  const emailStatusBreakdown = db.prepare(`
    SELECT
      COALESCE(email_status, 'unknown') AS status,
      COUNT(*) AS count
    FROM leads
    WHERE contact_email IS NOT NULL
    GROUP BY email_status
    ORDER BY count DESC
  `).all();

  // Contact confidence breakdown
  const confidenceBreakdown = db.prepare(`
    SELECT
      COALESCE(contact_confidence, 'unknown') AS confidence,
      COUNT(*) AS count
    FROM leads
    WHERE contact_email IS NOT NULL
    GROUP BY contact_confidence
    ORDER BY count DESC
  `).all();

  res.json({ stages, dropReasons, dailyTrend, byCategory, byCity, icpDistribution, emailStatusBreakdown, confidenceBreakdown });
});

// ── GET /api/leads/:id ────────────────────────────────────────────────────
app.get('/api/leads/:id', (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id);

  const lead = db.prepare(`SELECT * FROM leads WHERE id = ?`).get(id);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  const emails = db.prepare(`SELECT * FROM emails WHERE lead_id = ? ORDER BY created_at DESC`).all(id);
  const replies = db.prepare(`SELECT * FROM replies WHERE lead_id = ? ORDER BY received_at DESC`).all(id);
  const sequence = db.prepare(`SELECT * FROM sequence_state WHERE lead_id = ?`).get(id);

  res.json({ lead, emails, replies, sequence: sequence || null });
});

// ── PATCH /api/leads/:id/status ───────────────────────────────────────────
app.patch('/api/leads/:id/status', (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id);
  const { status } = req.body || {};

  if (!status) return res.status(400).json({ error: 'status is required' });

  const lead = db.prepare(`SELECT id FROM leads WHERE id = ?`).get(id);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  db.prepare(`UPDATE leads SET status = ? WHERE id = ?`).run(status, id);
  res.json({ ok: true });
});

// ── GET /api/send-log ─────────────────────────────────────────────────────
app.get('/api/send-log', (req, res) => {
  const db = getDb();
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const offset = (page - 1) * limit;

  const conditions = [];
  const params = [];

  if (req.query.status) {
    conditions.push('e.status = ?');
    params.push(req.query.status);
  }
  if (req.query.inbox) {
    conditions.push('e.inbox_used = ?');
    params.push(req.query.inbox);
  }
  if (req.query.step !== undefined) {
    conditions.push('e.sequence_step = ?');
    params.push(parseInt(req.query.step));
  }
  if (req.query.date_from) {
    conditions.push('e.sent_at >= ?');
    params.push(req.query.date_from);
  }
  if (req.query.date_to) {
    conditions.push('e.sent_at <= ?');
    params.push(req.query.date_to);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const total = db.prepare(`SELECT COUNT(*) AS count FROM emails e ${whereClause}`).get(...params).count;

  const emails = db.prepare(`
    SELECT e.*, l.business_name, l.contact_name, l.contact_email
    FROM emails e
    LEFT JOIN leads l ON l.id = e.lead_id
    ${whereClause}
    ORDER BY e.id DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  // Aggregates respect the same filters as the main query
  const agg = db.prepare(`
    SELECT
      COUNT(*) AS total_sent,
      SUM(CASE WHEN e.status = 'hard_bounce' THEN 1 ELSE 0 END) AS hard_bounces,
      SUM(CASE WHEN e.status = 'soft_bounce' THEN 1 ELSE 0 END) AS soft_bounces,
      SUM(CASE WHEN e.status = 'content_rejected' THEN 1 ELSE 0 END) AS content_rejected,
      COALESCE(AVG(e.send_duration_ms), 0) AS avg_duration_ms,
      COALESCE(SUM(e.total_cost_usd), 0) AS total_cost
    FROM emails e
    ${whereClause}
  `).get(...params);

  res.json({ emails, total, page, limit, aggregates: agg });
});

// ── GET /api/replies ──────────────────────────────────────────────────────
app.get('/api/replies', (req, res) => {
  const db = getDb();

  const replies = db.prepare(`
    SELECT r.*, l.business_name, l.contact_name, l.contact_email
    FROM replies r
    LEFT JOIN leads l ON l.id = r.lead_id
    ORDER BY
      CASE WHEN r.category IN ('hot', 'schedule') THEN 0 ELSE 1 END ASC,
      r.received_at DESC
  `).all();

  res.json({ replies });
});

// ── PATCH /api/replies/:id/action ─────────────────────────────────────────
app.patch('/api/replies/:id/action', (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id);
  const { action } = req.body || {};

  if (!action) return res.status(400).json({ error: 'action is required' });

  const reply = db.prepare(`SELECT id FROM replies WHERE id = ?`).get(id);
  if (!reply) return res.status(404).json({ error: 'Reply not found' });

  db.prepare(`UPDATE replies SET actioned_at=datetime('now'), action_taken=? WHERE id=?`).run(action, id);
  res.json({ ok: true });
});

// ── POST /api/replies/:id/reject ──────────────────────────────────────────
app.post('/api/replies/:id/reject', (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id);

  const reply = db.prepare(`SELECT r.lead_id, l.contact_email FROM replies r JOIN leads l ON l.id = r.lead_id WHERE r.id = ?`).get(id);
  if (!reply) return res.status(404).json({ error: 'Reply not found' });

  db.prepare(`INSERT OR IGNORE INTO reject_list (email, domain, reason) VALUES (?, ?, 'manual')`).run(
    reply.contact_email, reply.contact_email.split('@')[1]
  );
  db.prepare(`UPDATE leads SET status='unsubscribed' WHERE id=?`).run(reply.lead_id);
  db.prepare(`UPDATE sequence_state SET status='unsubscribed', updated_at=datetime('now') WHERE lead_id=?`).run(reply.lead_id);

  res.json({ ok: true });
});

// ── GET /api/sequences ────────────────────────────────────────────────────
app.get('/api/sequences', (req, res) => {
  const db = getDb();

  const sequences = db.prepare(`
    SELECT s.*, l.business_name, l.contact_name, l.contact_email
    FROM sequence_state s
    LEFT JOIN leads l ON l.id = s.lead_id
    ORDER BY s.updated_at DESC
  `).all();

  const agg = db.prepare(`
    SELECT
      SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN status = 'paused' THEN 1 ELSE 0 END) AS paused,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN status = 'replied' THEN 1 ELSE 0 END) AS replied,
      SUM(CASE WHEN status = 'unsubscribed' THEN 1 ELSE 0 END) AS unsubscribed
    FROM sequence_state
  `).get();

  res.json({ sequences, aggregates: agg });
});

// ── GET /api/cron-status ──────────────────────────────────────────────────
app.get('/api/cron-status', (req, res) => {
  const db = getDb();
  const d = today();

  const jobSchedule = [
    { name: 'findLeads', time: '09:00' },
    { name: 'sendEmails', time: '09:30' },
    { name: 'checkReplies', time: '14:00', pass: 1 },
    { name: 'checkReplies', time: '16:00', pass: 2 },
    { name: 'sendFollowups', time: '18:00' },
    { name: 'checkReplies', time: '20:00', pass: 3 },
    { name: 'dailyReport', time: '20:30' },
    { name: 'healthCheck', time: '02:00', day: 'sunday' },
    { name: 'backup', time: '02:00' }
  ];

  const todayLogs = db.prepare(`
    SELECT * FROM cron_log
    WHERE date(started_at) = ?
    ORDER BY started_at ASC
  `).all(d);

  // Current IST time for NOT TRIGGERED detection
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const ist = new Date(now.getTime() + istOffset);
  const currentIstHour = ist.getUTCHours();
  const currentIstMinute = ist.getUTCMinutes();
  const currentIstTime = currentIstHour * 60 + currentIstMinute;

  const jobs = jobSchedule.map((sched, idx) => {
    const matching = todayLogs.filter(l => l.job_name === sched.name);
    let log;
    if (sched.name === 'checkReplies' && sched.pass) {
      log = matching[sched.pass - 1];
    } else {
      log = matching[0];
    }

    // NOT TRIGGERED detection: if scheduled time was >30 min ago and no log entry
    let status = log ? log.status : 'not_triggered';
    if (!log) {
      const [schedHour, schedMin] = sched.time.split(':').map(Number);
      const schedTime = schedHour * 60 + schedMin;
      // Check day-of-week for Sunday-only jobs (e.g., healthCheck)
      const istDay = ist.getUTCDay(); // 0=Sunday
      if (sched.day === 'sunday' && istDay !== 0) {
        status = 'pending'; // Not a Sunday — don't flag as NOT TRIGGERED
      } else if (currentIstTime < schedTime + 30) {
        status = 'pending'; // Not yet time
      }
    }

    return {
      ...sched,
      id: idx,
      log: log || null,
      status
    };
  });

  res.json({ jobs, date: d });
});

// ── GET /api/cron-status/:job/history ─────────────────────────────────────
app.get('/api/cron-status/:job/history', (req, res) => {
  const db = getDb();
  const jobName = req.params.job;

  const history = db.prepare(`
    SELECT * FROM cron_log
    WHERE job_name = ?
    ORDER BY started_at DESC
    LIMIT 30
  `).all(jobName);

  res.json({ history });
});

// ── GET /api/health ───────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  const db = getDb();
  const d = today();

  const todayMetrics = db.prepare(`SELECT * FROM daily_metrics WHERE date = ?`).get(d);
  const emailsSent = todayMetrics?.emails_sent || 0;
  const bounces = todayMetrics?.emails_hard_bounced || 0;
  const bounceRate = emailsSent > 0 ? (bounces / emailsSent * 100).toFixed(2) : '0.00';

  // 7-day unsubscribe rate
  const weekReplies = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN category = 'unsubscribe' THEN 1 ELSE 0 END) AS unsubs
    FROM replies
    WHERE received_at >= date('now', '-7 days')
  `).get();
  const unsubRate = weekReplies.total > 0
    ? (weekReplies.unsubs / weekReplies.total * 100).toFixed(2)
    : '0.00';

  // Last successful send per inbox
  const lastSendInbox1 = db.prepare(`
    SELECT sent_at FROM emails WHERE inbox_used = ? AND status = 'sent' ORDER BY sent_at DESC LIMIT 1
  `).get(process.env.INBOX_1_USER || 'darshan@trysimpleinc.com');

  const lastSendInbox2 = db.prepare(`
    SELECT sent_at FROM emails WHERE inbox_used = ? AND status = 'sent' ORDER BY sent_at DESC LIMIT 1
  `).get(process.env.INBOX_2_USER || 'hello@trysimpleinc.com');

  // Reject list size
  const rejectCount = db.prepare(`SELECT COUNT(*) AS count FROM reject_list`).get();

  // Blacklist status from daily_metrics
  const blacklistStatus = todayMetrics?.domain_blacklisted || 0;
  const blacklistZones = todayMetrics?.blacklist_zones || null;

  // Mail-tester score (latest available)
  const mailTester = db.prepare(`
    SELECT mail_tester_score, date FROM daily_metrics
    WHERE mail_tester_score IS NOT NULL
    ORDER BY date DESC LIMIT 1
  `).get();

  res.json({
    bounceRate: parseFloat(bounceRate),
    unsubscribeRate: parseFloat(unsubRate),
    domain: process.env.OUTREACH_DOMAIN || 'trysimpleinc.com',
    blacklisted: blacklistStatus === 1,
    blacklistZones,
    postmasterReputation: todayMetrics?.postmaster_reputation || null,
    mailTesterScore: mailTester?.mail_tester_score || null,
    mailTesterDate: mailTester?.date || null,
    inboxes: {
      inbox1: {
        email: process.env.INBOX_1_USER || 'darshan@trysimpleinc.com',
        lastSend: lastSendInbox1?.sent_at || null
      },
      inbox2: {
        email: process.env.INBOX_2_USER || 'hello@trysimpleinc.com',
        lastSend: lastSendInbox2?.sent_at || null
      }
    },
    rejectListSize: rejectCount?.count || 0
  });
});

// ── PATCH /api/health/mail-tester ─────────────────────────────────────────
app.patch('/api/health/mail-tester', (req, res) => {
  const db = getDb();
  const { score } = req.body || {};

  if (score === undefined || score === null) return res.status(400).json({ error: 'score is required' });

  const d = today();
  db.prepare(`INSERT INTO daily_metrics (date) VALUES (?) ON CONFLICT(date) DO NOTHING`).run(d);
  db.prepare(`UPDATE daily_metrics SET mail_tester_score = ? WHERE date = ?`).run(parseFloat(score), d);
  res.json({ ok: true });
});

// ── GET /api/costs ────────────────────────────────────────────────────────
app.get('/api/costs', (req, res) => {
  const db = getDb();

  const daily = db.prepare(`
    SELECT date, gemini_cost_usd, sonnet_cost_usd, haiku_cost_usd, mev_cost_usd, total_api_cost_usd
    FROM daily_metrics
    WHERE date >= date('now', '-30 days')
    ORDER BY date ASC
  `).all();

  const monthly = db.prepare(`
    SELECT
      COALESCE(SUM(gemini_cost_usd), 0) AS gemini_cost_usd,
      COALESCE(SUM(sonnet_cost_usd), 0) AS sonnet_cost_usd,
      COALESCE(SUM(haiku_cost_usd), 0) AS haiku_cost_usd,
      COALESCE(SUM(mev_cost_usd), 0) AS mev_cost_usd,
      COALESCE(SUM(total_api_cost_usd), 0) AS total_api_cost_usd,
      COALESCE(SUM(emails_sent), 0) AS emails_sent
    FROM daily_metrics
    WHERE date >= date('now', '-30 days')
  `).get();

  const perEmailCost = monthly.emails_sent > 0
    ? (monthly.total_api_cost_usd / monthly.emails_sent).toFixed(4)
    : '0.0000';

  res.json({
    daily,
    monthly: {
      ...monthly,
      perEmailCost: parseFloat(perEmailCost)
    }
  });
});

// ── GET /api/errors ───────────────────────────────────────────────────────
app.get('/api/errors', (req, res) => {
  const db = getDb();

  const conditions = [];
  const params = [];

  if (req.query.source) {
    conditions.push('source = ?');
    params.push(req.query.source);
  }
  if (req.query.error_type) {
    conditions.push('error_type = ?');
    params.push(req.query.error_type);
  }
  if (req.query.resolved !== undefined) {
    conditions.push('resolved = ?');
    params.push(parseInt(req.query.resolved));
  }
  if (req.query.date_from) {
    conditions.push('occurred_at >= ?');
    params.push(req.query.date_from);
  }
  if (req.query.date_to) {
    conditions.push('occurred_at <= ?');
    params.push(req.query.date_to);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const errors = db.prepare(`
    SELECT * FROM error_log ${whereClause}
    ORDER BY occurred_at DESC
    LIMIT 200
  `).all(...params);

  const unresolvedCount = db.prepare(`SELECT COUNT(*) AS count FROM error_log WHERE resolved = 0`).get();

  res.json({ errors, unresolvedCount: unresolvedCount?.count || 0 });
});

// ── PATCH /api/errors/:id/resolve ─────────────────────────────────────────
app.patch('/api/errors/:id/resolve', (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id);

  const err = db.prepare(`SELECT id FROM error_log WHERE id = ?`).get(id);
  if (!err) return res.status(404).json({ error: 'Error not found' });

  db.prepare(`UPDATE error_log SET resolved = 1, resolved_at = datetime('now') WHERE id = ?`).run(id);
  res.json({ ok: true });
});

// ── Serve React SPA ───────────────────────────────────────────────────────
const distPath = join(__dirname, 'dist');
if (existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(join(distPath, 'index.html'));
  });
}

// ── Start server (not in test mode) ───────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  const port = parseInt(process.env.DASHBOARD_PORT || '3001');
  app.listen(port, () => {
    console.log(`Radar dashboard running on port ${port}`);
  });
}

export { app };
