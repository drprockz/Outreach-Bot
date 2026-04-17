import { Router } from 'express';
import { getDb } from '../../core/db/index.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDb();

  const conditions = [];
  const params = [];

  if (req.query.source) { conditions.push('source = ?'); params.push(req.query.source); }
  if (req.query.error_type) { conditions.push('error_type = ?'); params.push(req.query.error_type); }
  if (req.query.resolved !== undefined) { conditions.push('resolved = ?'); params.push(parseInt(req.query.resolved)); }
  if (req.query.date_from) { conditions.push('occurred_at >= ?'); params.push(req.query.date_from); }
  if (req.query.date_to) { conditions.push('occurred_at <= ?'); params.push(req.query.date_to); }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const errors = db.prepare(`
    SELECT * FROM error_log ${whereClause}
    ORDER BY occurred_at DESC
    LIMIT 200
  `).all(...params);

  const unresolvedCount = db.prepare(`SELECT COUNT(*) AS count FROM error_log WHERE resolved = 0`).get();

  res.json({ errors, unresolvedCount: unresolvedCount?.count || 0 });
});

router.patch('/:id/resolve', (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id);

  const err = db.prepare(`SELECT id FROM error_log WHERE id = ?`).get(id);
  if (!err) return res.status(404).json({ error: 'Error not found' });

  db.prepare(`UPDATE error_log SET resolved = 1, resolved_at = datetime('now') WHERE id = ?`).run(id);
  res.json({ ok: true });
});

export default router;
