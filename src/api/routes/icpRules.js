import { Router } from 'express';
import { getDb } from '../../core/db/index.js';

const router = Router();

const VALID_POINTS = [-3, -2, -1, 1, 2, 3];

router.get('/', (req, res) => {
  const rules = getDb().prepare('SELECT * FROM icp_rules ORDER BY sort_order, id').all();
  res.json({ rules });
});

router.put('/', (req, res) => {
  const rules = req.body;
  if (!Array.isArray(rules)) return res.status(400).json({ error: 'body must be an array' });

  for (const r of rules) {
    if (!r.label) return res.status(400).json({ error: 'each rule must have a label' });
    if (!VALID_POINTS.includes(r.points)) return res.status(400).json({ error: `invalid points value: ${r.points}` });
  }

  const db = getDb();
  const replaceFn = db.transaction((rulesArr) => {
    db.prepare('DELETE FROM icp_rules').run();
    rulesArr.forEach((r, i) => {
      db.prepare(
        'INSERT INTO icp_rules (label, points, description, enabled, sort_order) VALUES (?, ?, ?, ?, ?)'
      ).run(r.label, r.points, r.description ?? null, r.enabled ?? 1, i);
    });
  });

  replaceFn(rules);
  res.json({ ok: true });
});

export default router;
