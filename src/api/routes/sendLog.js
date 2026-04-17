import { Router } from 'express';
import { getDb } from '../../core/db/index.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDb();
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const offset = (page - 1) * limit;

  const conditions = [];
  const params = [];

  if (req.query.status) { conditions.push('e.status = ?'); params.push(req.query.status); }
  if (req.query.inbox) { conditions.push('e.inbox_used = ?'); params.push(req.query.inbox); }
  if (req.query.step !== undefined) { conditions.push('e.sequence_step = ?'); params.push(parseInt(req.query.step)); }
  if (req.query.date_from) { conditions.push('e.sent_at >= ?'); params.push(req.query.date_from); }
  if (req.query.date_to) { conditions.push('e.sent_at <= ?'); params.push(req.query.date_to); }

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

export default router;
