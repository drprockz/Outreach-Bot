import { Router } from 'express';
import { getDb } from '../../core/db/index.js';

const router = Router();

router.get('/', (req, res) => {
  const rows = getDb().prepare('SELECT key, value FROM config').all();
  res.json(Object.fromEntries(rows.map(r => [r.key, r.value])));
});

router.put('/', (req, res) => {
  const updates = req.body || {};

  // Validate icp_weights JSON structure if provided
  if ('icp_weights' in updates) {
    let parsed;
    try { parsed = JSON.parse(updates.icp_weights); }
    catch { return res.status(400).json({ error: 'icp_weights must be valid JSON' }); }
    const expected = ['firmographic', 'problem', 'intent', 'tech', 'economic', 'buying'];
    if (!expected.every(k => Number.isFinite(parsed[k]) && parsed[k] >= 0)) {
      return res.status(400).json({ error: `icp_weights must contain non-negative finite numbers: ${expected.join(', ')}` });
    }
    const sum = expected.reduce((a, k) => a + parsed[k], 0);
    if (sum !== 100) {
      return res.status(400).json({ error: `icp_weights values must sum to 100 (got ${sum})` });
    }
  }

  const stmt = getDb().prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(updates)) {
    stmt.run(key, String(value));
  }
  res.json({ ok: true });
});

export default router;
