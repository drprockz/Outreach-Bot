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

  if (req.query.status) { conditions.push('status = ?'); params.push(req.query.status); }
  if (req.query.priority) { conditions.push('icp_priority = ?'); params.push(req.query.priority); }
  if (req.query.category) { conditions.push('category = ?'); params.push(req.query.category); }
  if (req.query.city) { conditions.push('city = ?'); params.push(req.query.city); }
  if (req.query.tech_stack) { conditions.push('tech_stack LIKE ?'); params.push(`%${req.query.tech_stack}%`); }
  if (req.query.date_from) { conditions.push('discovered_at >= ?'); params.push(req.query.date_from); }
  if (req.query.date_to) { conditions.push('discovered_at <= ?'); params.push(req.query.date_to); }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const total = db.prepare(`SELECT COUNT(*) AS count FROM leads ${whereClause}`).get(...params).count;
  const leads = db.prepare(`
    SELECT * FROM leads ${whereClause}
    ORDER BY id DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  res.json({ leads, total, page, limit });
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id);

  const lead = db.prepare(`SELECT * FROM leads WHERE id = ?`).get(id);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  const emails = db.prepare(`SELECT * FROM emails WHERE lead_id = ? ORDER BY created_at DESC`).all(id);
  const replies = db.prepare(`SELECT * FROM replies WHERE lead_id = ? ORDER BY received_at DESC`).all(id);
  const sequence = db.prepare(`SELECT * FROM sequence_state WHERE lead_id = ?`).get(id);

  res.json({ lead, emails, replies, sequence: sequence || null });
});

router.patch('/:id/status', (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id);
  const { status } = req.body || {};

  if (!status) return res.status(400).json({ error: 'status is required' });

  const lead = db.prepare(`SELECT id FROM leads WHERE id = ?`).get(id);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  db.prepare(`UPDATE leads SET status = ? WHERE id = ?`).run(status, id);
  res.json({ ok: true });
});

export default router;
