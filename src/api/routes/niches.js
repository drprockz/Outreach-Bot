import { Router } from 'express';
import { getDb } from '../../core/db/index.js';

const router = Router();

router.get('/', (req, res) => {
  const niches = getDb().prepare('SELECT * FROM niches ORDER BY sort_order, id').all();
  res.json({ niches });
});

router.post('/', (req, res) => {
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

  res.status(201).json({ niche: createFn() });
});

router.put('/:id', (req, res) => {
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

router.delete('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const existing = getDb().prepare('SELECT id FROM niches WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Niche not found' });
  getDb().prepare('DELETE FROM niches WHERE id = ?').run(id);
  res.json({ ok: true });
});

export default router;
