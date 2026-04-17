import { Router } from 'express';
import { getDb } from '../../core/db/index.js';

const router = Router();

router.get('/', (req, res) => {
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

export default router;
