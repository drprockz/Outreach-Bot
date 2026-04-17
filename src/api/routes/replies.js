import { Router } from 'express';
import { getDb } from '../../core/db/index.js';

const router = Router();

router.get('/', (req, res) => {
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

router.patch('/:id/action', (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id);
  const { action } = req.body || {};

  if (!action) return res.status(400).json({ error: 'action is required' });

  const reply = db.prepare(`SELECT id FROM replies WHERE id = ?`).get(id);
  if (!reply) return res.status(404).json({ error: 'Reply not found' });

  db.prepare(`UPDATE replies SET actioned_at=datetime('now'), action_taken=? WHERE id=?`).run(action, id);
  res.json({ ok: true });
});

router.post('/:id/reject', (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id);

  const reply = db.prepare(`
    SELECT r.lead_id, l.contact_email FROM replies r
    JOIN leads l ON l.id = r.lead_id WHERE r.id = ?
  `).get(id);
  if (!reply) return res.status(404).json({ error: 'Reply not found' });

  db.prepare(`INSERT OR IGNORE INTO reject_list (email, domain, reason) VALUES (?, ?, 'manual')`).run(
    reply.contact_email, reply.contact_email.split('@')[1]
  );
  db.prepare(`UPDATE leads SET status='unsubscribed' WHERE id=?`).run(reply.lead_id);
  db.prepare(`UPDATE sequence_state SET status='unsubscribed', updated_at=datetime('now') WHERE lead_id=?`).run(reply.lead_id);

  res.json({ ok: true });
});

export default router;
