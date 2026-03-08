import { Router } from 'express';
import { getOverviewData } from '../../db/database.js';

const router = Router();

router.get('/', (req, res) => {
  const data = getOverviewData();
  res.json(data);
});

export default router;
