import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getDb, today } from '../utils/db.js';
import 'dotenv/config';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json());

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

// ── GET /api/overview ─────────────────────────────────────────────────────
app.get('/api/overview', (req, res) => {
  const db = getDb();
  const d = today();

  // Today's metrics
  const todayMetrics = db.prepare(`SELECT * FROM daily_metrics WHERE date = ?`).get(d) || {};

  // 7-day rolling metrics
  const weekMetrics = db.prepare(`
    SELECT
      COALESCE(SUM(leads_found), 0) AS leads_found,
      COALESCE(SUM(emails_sent), 0) AS emails_sent,
      COALESCE(SUM(bounces), 0) AS bounces,
      COALESCE(SUM(replies), 0) AS replies,
      COALESCE(SUM(hot_replies), 0) AS hot_replies,
      COALESCE(SUM(total_cost_usd), 0) AS total_cost_usd
    FROM daily_metrics
    WHERE date >= date('now', '-7 days')
  `).get();

  // 30-day rolling metrics
  const monthMetrics = db.prepare(`
    SELECT
      COALESCE(SUM(leads_found), 0) AS leads_found,
      COALESCE(SUM(emails_sent), 0) AS emails_sent,
      COALESCE(SUM(bounces), 0) AS bounces,
      COALESCE(SUM(replies), 0) AS replies,
      COALESCE(SUM(hot_replies), 0) AS hot_replies,
      COALESCE(SUM(total_cost_usd), 0) AS total_cost_usd
    FROM daily_metrics
    WHERE date >= date('now', '-30 days')
  `).get();

  // Funnel counts
  const funnel = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status != 'new' THEN 1 ELSE 0 END) AS extracted,
      SUM(CASE WHEN quality_score IS NOT NULL THEN 1 ELSE 0 END) AS judged,
      SUM(CASE WHEN contact_email IS NOT NULL THEN 1 ELSE 0 END) AS email_found,
      SUM(CASE WHEN icp_priority IN ('A','B') THEN 1 ELSE 0 END) AS icp_ab,
      SUM(CASE WHEN status IN ('contacted','replied') THEN 1 ELSE 0 END) AS sent,
      SUM(CASE WHEN status = 'replied' THEN 1 ELSE 0 END) AS replied
    FROM leads
  `).get();

  // Active sequences count
  const activeSeq = db.prepare(`SELECT COUNT(*) AS count FROM sequence_state WHERE status = 'active'`).get();

  // 7-day reply rate
  const replyRate = weekMetrics.emails_sent > 0
    ? (weekMetrics.replies / weekMetrics.emails_sent * 100).toFixed(1)
    : '0.0';

  // Today's bounce rate
  const bounceRate = (todayMetrics.emails_sent || 0) > 0
    ? ((todayMetrics.bounces || 0) / todayMetrics.emails_sent * 100).toFixed(1)
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

  // Build WHERE clauses from filters
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
  if (req.query.niche) {
    conditions.push('niche = ?');
    params.push(req.query.niche);
  }
  if (req.query.city) {
    conditions.push('city = ?');
    params.push(req.query.city);
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

  db.prepare(`UPDATE leads SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, id);
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
    conditions.push('e.inbox = ?');
    params.push(req.query.inbox);
  }
  if (req.query.step !== undefined) {
    conditions.push('e.sequence_step = ?');
    params.push(parseInt(req.query.step));
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const total = db.prepare(`SELECT COUNT(*) AS count FROM emails e ${whereClause}`).get(...params).count;

  const emails = db.prepare(`
    SELECT e.*, l.company, l.contact_name
    FROM emails e
    LEFT JOIN leads l ON l.id = e.lead_id
    ${whereClause}
    ORDER BY e.id DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  // Aggregates
  const agg = db.prepare(`
    SELECT
      COUNT(*) AS total_sent,
      SUM(CASE WHEN status = 'hard_bounce' THEN 1 ELSE 0 END) AS hard_bounces,
      SUM(CASE WHEN status = 'soft_bounce' THEN 1 ELSE 0 END) AS soft_bounces,
      SUM(CASE WHEN status = 'content_rejected' THEN 1 ELSE 0 END) AS content_rejected,
      COALESCE(SUM(ai_cost_usd), 0) AS total_cost
    FROM emails
  `).get();

  res.json({ emails, total, page, limit, aggregates: agg });
});

// ── GET /api/replies ──────────────────────────────────────────────────────
app.get('/api/replies', (req, res) => {
  const db = getDb();

  const replies = db.prepare(`
    SELECT r.*, l.company, l.contact_name, l.contact_email
    FROM replies r
    LEFT JOIN leads l ON l.id = r.lead_id
    ORDER BY
      CASE WHEN r.classification IN ('hot', 'schedule') THEN 0 ELSE 1 END ASC,
      r.received_at DESC
  `).all();

  res.json({ replies });
});

// ── GET /api/sequences ────────────────────────────────────────────────────
app.get('/api/sequences', (req, res) => {
  const db = getDb();

  const sequences = db.prepare(`
    SELECT s.*, l.company, l.contact_name, l.contact_email
    FROM sequence_state s
    LEFT JOIN leads l ON l.id = s.lead_id
    ORDER BY s.updated_at DESC
  `).all();

  // Aggregates
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

  // The 9 scheduled jobs with their scheduled times (IST)
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

  // Get today's cron_log entries
  const todayLogs = db.prepare(`
    SELECT * FROM cron_log
    WHERE date(started_at) = ?
    ORDER BY started_at ASC
  `).all(d);

  const jobs = jobSchedule.map((sched, idx) => {
    // Find matching log entry
    const matching = todayLogs.filter(l => l.job_name === sched.name);
    // For checkReplies, try to match by pass number (position in matching array)
    let log;
    if (sched.name === 'checkReplies' && sched.pass) {
      log = matching[sched.pass - 1];
    } else {
      log = matching[0];
    }

    return {
      ...sched,
      id: idx,
      log: log || null,
      status: log ? log.status : 'not_triggered'
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

  // Today's bounce rate
  const todayMetrics = db.prepare(`SELECT * FROM daily_metrics WHERE date = ?`).get(d);
  const emailsSent = todayMetrics?.emails_sent || 0;
  const bounces = todayMetrics?.bounces || 0;
  const bounceRate = emailsSent > 0 ? (bounces / emailsSent * 100).toFixed(2) : '0.00';

  // 7-day unsubscribe rate
  const weekReplies = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN classification = 'unsubscribe' THEN 1 ELSE 0 END) AS unsubs
    FROM replies
    WHERE received_at >= date('now', '-7 days')
  `).get();
  const unsubRate = weekReplies.total > 0
    ? (weekReplies.unsubs / weekReplies.total * 100).toFixed(2)
    : '0.00';

  // Last successful send per inbox
  const lastSendInbox1 = db.prepare(`
    SELECT sent_at FROM emails WHERE inbox = ? AND status = 'sent' ORDER BY sent_at DESC LIMIT 1
  `).get(process.env.INBOX_1_USER || 'darshan@trysimpleinc.com');

  const lastSendInbox2 = db.prepare(`
    SELECT sent_at FROM emails WHERE inbox = ? AND status = 'sent' ORDER BY sent_at DESC LIMIT 1
  `).get(process.env.INBOX_2_USER || 'hello@trysimpleinc.com');

  // Reject list size
  const rejectCount = db.prepare(`SELECT COUNT(*) AS count FROM reject_list`).get();

  res.json({
    bounceRate: parseFloat(bounceRate),
    unsubscribeRate: parseFloat(unsubRate),
    domain: process.env.OUTREACH_DOMAIN || 'trysimpleinc.com',
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

// ── GET /api/costs ────────────────────────────────────────────────────────
app.get('/api/costs', (req, res) => {
  const db = getDb();

  // Daily costs for last 30 days
  const daily = db.prepare(`
    SELECT date, gemini_cost_usd, sonnet_cost_usd, haiku_cost_usd, total_cost_usd
    FROM daily_metrics
    WHERE date >= date('now', '-30 days')
    ORDER BY date ASC
  `).all();

  // Monthly totals
  const monthly = db.prepare(`
    SELECT
      COALESCE(SUM(gemini_cost_usd), 0) AS gemini_cost_usd,
      COALESCE(SUM(sonnet_cost_usd), 0) AS sonnet_cost_usd,
      COALESCE(SUM(haiku_cost_usd), 0) AS haiku_cost_usd,
      COALESCE(SUM(total_cost_usd), 0) AS total_cost_usd,
      COALESCE(SUM(emails_sent), 0) AS emails_sent
    FROM daily_metrics
    WHERE date >= date('now', '-30 days')
  `).get();

  // Per-email average cost
  const perEmailCost = monthly.emails_sent > 0
    ? (monthly.total_cost_usd / monthly.emails_sent).toFixed(4)
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
  if (req.query.resolved !== undefined) {
    conditions.push('resolved = ?');
    params.push(parseInt(req.query.resolved));
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const errors = db.prepare(`
    SELECT * FROM error_log ${whereClause}
    ORDER BY created_at DESC
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

  db.prepare(`UPDATE error_log SET resolved = 1 WHERE id = ?`).run(id);
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
  const port = process.env.DASHBOARD_PORT || 3001;
  app.listen(port, () => {
    console.log(`Radar dashboard running on port ${port}`);
  });
}

export { app };
