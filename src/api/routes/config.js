import { Router } from 'express';

const router = Router();

router.get('/', async (req, res) => {
  const rows = await req.db.config.findMany();
  res.json(Object.fromEntries(rows.map(r => [r.key, r.value])));
});

router.put('/', async (req, res) => {
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

  for (const [key, value] of Object.entries(updates)) {
    await req.db.config.upsert({
      where: { key },
      create: { key, value: String(value) },
      update: { value: String(value) },
    });
  }
  res.json({ ok: true });
});

export default router;
