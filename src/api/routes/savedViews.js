import { Router } from 'express';
import { prisma } from '../../core/db/index.js';

const router = Router();

function serialize(v) {
  return {
    id: v.id,
    name: v.name,
    filtersJson: v.filtersJson,
    sort: v.sort,
    updatedAt: v.updatedAt,
  };
}

router.get('/', async (_req, res) => {
  const views = await prisma.savedView.findMany({ orderBy: { updatedAt: 'desc' } });
  res.json({ views: views.map(serialize) });
});

router.post('/', async (req, res) => {
  const { name, filtersJson, sort } = req.body || {};
  if (!name || filtersJson === undefined || filtersJson === null) {
    return res.status(400).json({ error: 'missing_fields' });
  }
  const v = await prisma.savedView.create({ data: { name, filtersJson, sort: sort || null } });
  res.status(201).json({ view: serialize(v) });
});

router.patch('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const data = {};
  if (req.body.name !== undefined) data.name = req.body.name;
  if (req.body.filtersJson !== undefined) data.filtersJson = req.body.filtersJson;
  if (req.body.sort !== undefined) data.sort = req.body.sort;
  const v = await prisma.savedView.update({ where: { id }, data });
  res.json({ view: serialize(v) });
});

router.delete('/:id', async (req, res) => {
  await prisma.savedView.delete({ where: { id: Number(req.params.id) } });
  res.status(204).end();
});

export default router;
