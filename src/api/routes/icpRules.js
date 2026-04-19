import { Router } from 'express';
import { prisma } from '../../core/db/index.js';

const router = Router();

const VALID_POINTS = [-3, -2, -1, 1, 2, 3];

function serialize(r) {
  if (!r) return null;
  return {
    id: r.id,
    label: r.label,
    points: r.points,
    description: r.description,
    enabled: r.enabled ? 1 : 0,
    sort_order: r.sortOrder,
  };
}

router.get('/', async (req, res) => {
  const rules = await prisma.icpRule.findMany({
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  });
  res.json({ rules: rules.map(serialize) });
});

router.put('/', async (req, res) => {
  const rules = req.body;
  if (!Array.isArray(rules)) return res.status(400).json({ error: 'body must be an array' });

  for (const r of rules) {
    if (!r.label) return res.status(400).json({ error: 'each rule must have a label' });
    if (!VALID_POINTS.includes(r.points)) return res.status(400).json({ error: `invalid points value: ${r.points}` });
  }

  await prisma.$transaction(async (tx) => {
    await tx.icpRule.deleteMany({});
    for (let i = 0; i < rules.length; i++) {
      const r = rules[i];
      await tx.icpRule.create({
        data: {
          label: r.label,
          points: r.points,
          description: r.description ?? null,
          enabled: r.enabled === undefined ? true : !!r.enabled,
          sortOrder: i,
        },
      });
    }
  });

  res.json({ ok: true });
});

export default router;
