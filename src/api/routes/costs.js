import { Router } from 'express';
import { getDb } from '../../core/db/index.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDb();

  const daily = db.prepare(`
    SELECT date, gemini_cost_usd, sonnet_cost_usd, haiku_cost_usd, mev_cost_usd, total_api_cost_usd
    FROM daily_metrics
    WHERE date >= date('now', '-30 days')
    ORDER BY date ASC
  `).all();

  const monthly = db.prepare(`
    SELECT
      COALESCE(SUM(gemini_cost_usd), 0) AS gemini_cost_usd,
      COALESCE(SUM(sonnet_cost_usd), 0) AS sonnet_cost_usd,
      COALESCE(SUM(haiku_cost_usd), 0) AS haiku_cost_usd,
      COALESCE(SUM(mev_cost_usd), 0) AS mev_cost_usd,
      COALESCE(SUM(total_api_cost_usd), 0) AS total_api_cost_usd,
      COALESCE(SUM(emails_sent), 0) AS emails_sent
    FROM daily_metrics
    WHERE date >= date('now', '-30 days')
  `).get();

  const perEmailCost = monthly.emails_sent > 0
    ? (monthly.total_api_cost_usd / monthly.emails_sent).toFixed(4)
    : '0.0000';

  res.json({
    daily,
    monthly: { ...monthly, perEmailCost: parseFloat(perEmailCost) }
  });
});

export default router;
