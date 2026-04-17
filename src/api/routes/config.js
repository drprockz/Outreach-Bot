import { Router } from 'express';
import { getDb } from '../../core/db/index.js';

const router = Router();

router.get('/', (req, res) => {
  const rows = getDb().prepare('SELECT key, value FROM config').all();
  res.json(Object.fromEntries(rows.map(r => [r.key, r.value])));
});

router.put('/', (req, res) => {
  const updates = req.body || {};
  const stmt = getDb().prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(updates)) {
    stmt.run(key, String(value));
  }
  res.json({ ok: true });
});

export default router;
