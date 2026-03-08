import { Router } from 'express';
import { getDailyReportsList, getDailyReportByDate } from '../../db/database.js';

const router = Router();

router.get('/', (req, res) => {
  const reports = getDailyReportsList();
  res.json(reports);
});

router.get('/:date', (req, res) => {
  const report = getDailyReportByDate(req.params.date);
  if (!report) return res.status(404).json({ error: 'Report not found' });
  res.json(report);
});

export default router;
