import { Router } from 'express';
import { prisma } from '../../core/db/index.js';

const router = Router();

function serialize(n) {
  if (!n) return null;
  return {
    id: n.id,
    label: n.label,
    query: n.query,
    day_of_week: n.dayOfWeek,
    enabled: n.enabled ? 1 : 0,
    sort_order: n.sortOrder,
    created_at: n.createdAt,
  };
}

router.get('/', async (req, res) => {
  const niches = await prisma.niche.findMany({
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  });
  res.json({ items: niches.map(serialize) });
});

router.post('/', async (req, res) => {
  const { label, query, day_of_week = null, enabled = 1 } = req.body || {};
  if (!label || !query) return res.status(400).json({ error: 'label and query are required', field: !label ? 'label' : 'query' });
  if (query.length < 10) return res.status(400).json({ error: 'query must be at least 10 characters', field: 'query' });

  const created = await prisma.$transaction(async (tx) => {
    const agg = await tx.niche.aggregate({ _max: { sortOrder: true } });
    const maxOrder = agg._max.sortOrder ?? -1;

    if (day_of_week !== null) {
      await tx.niche.updateMany({
        where: { dayOfWeek: day_of_week },
        data: { dayOfWeek: null },
      });
    }
    return tx.niche.create({
      data: {
        label,
        query,
        dayOfWeek: day_of_week,
        enabled: !!enabled,
        sortOrder: maxOrder + 1,
      },
    });
  });

  res.status(201).json({ ok: true, data: serialize(created) });
});

router.put('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  const { label, query, day_of_week = null, enabled = 1, sort_order } = req.body || {};
  if (!label || !query) return res.status(400).json({ error: 'label and query are required', field: !label ? 'label' : 'query' });

  const existing = await prisma.niche.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'Niche not found' });

  const updated = await prisma.$transaction(async (tx) => {
    if (day_of_week !== null) {
      await tx.niche.updateMany({
        where: { dayOfWeek: day_of_week, id: { not: id } },
        data: { dayOfWeek: null },
      });
    }
    return tx.niche.update({
      where: { id },
      data: {
        label,
        query,
        dayOfWeek: day_of_week,
        enabled: !!enabled,
        sortOrder: sort_order ?? existing.sortOrder,
      },
    });
  });

  res.json({ ok: true, data: serialize(updated) });
});

router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  const existing = await prisma.niche.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'Niche not found' });
  await prisma.niche.delete({ where: { id } });
  res.json({ ok: true });
});

export default router;
