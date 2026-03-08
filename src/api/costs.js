import { Router } from 'express';
import { getCostSummary, getCostChart } from '../../db/database.js';

const router = Router();

router.get('/', (req, res) => {
  const data = getCostSummary();
  res.json(data);
});

router.get('/chart', (req, res) => {
  const data = getCostChart();
  res.json(data);
});

export default router;
