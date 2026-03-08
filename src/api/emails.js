import { Router } from 'express';
import { getEmailsPaginated, getEmailWithDetails } from '../../db/database.js';

const router = Router();

router.get('/', (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const { status, sequence } = req.query;
  const data = getEmailsPaginated(page, limit, status || null, sequence || null);
  res.json({ emails: data.rows, total: data.total, page, limit });
});

router.get('/:id', (req, res) => {
  const email = getEmailWithDetails(parseInt(req.params.id, 10));
  if (!email) return res.status(404).json({ error: 'Email not found' });
  res.json(email);
});

export default router;
