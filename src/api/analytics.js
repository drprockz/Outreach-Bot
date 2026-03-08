import { Router } from 'express';
import { getAnalyticsData } from '../../db/database.js';

const router = Router();

router.get('/', (req, res) => {
  const data = getAnalyticsData();
  res.json(data);
});

export default router;
