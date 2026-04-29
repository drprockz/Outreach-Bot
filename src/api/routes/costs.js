import { Router } from 'express';
import { today } from '../../core/db/index.js';

const router = Router();

// 30-day window including today, as YYYY-MM-DD strings (the `date` column is a string PK)
function last30Dates() {
  const out = [];
  const now = new Date();
  for (let i = 30; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

router.get('/', async (req, res) => {
  const dates = last30Dates();
  const windowStart = dates[0];

  const rows = await req.db.dailyMetrics.findMany({
    where: { date: { gte: windowStart } },
    orderBy: { date: 'asc' },
    select: {
      date: true,
      geminiCostUsd: true,
      sonnetCostUsd: true,
      haikuCostUsd: true,
      mevCostUsd: true,
      totalApiCostUsd: true,
      emailsSent: true,
    },
  });

  const daily = rows.map(r => ({
    date: r.date,
    gemini_cost_usd: Number(r.geminiCostUsd),
    sonnet_cost_usd: Number(r.sonnetCostUsd),
    haiku_cost_usd: Number(r.haikuCostUsd),
    mev_cost_usd: Number(r.mevCostUsd),
    total_api_cost_usd: Number(r.totalApiCostUsd),
  }));

  const monthly = {
    gemini_cost_usd: 0,
    sonnet_cost_usd: 0,
    haiku_cost_usd: 0,
    mev_cost_usd: 0,
    total_api_cost_usd: 0,
    emails_sent: 0,
  };
  for (const r of rows) {
    monthly.gemini_cost_usd += Number(r.geminiCostUsd);
    monthly.sonnet_cost_usd += Number(r.sonnetCostUsd);
    monthly.haiku_cost_usd += Number(r.haikuCostUsd);
    monthly.mev_cost_usd += Number(r.mevCostUsd);
    monthly.total_api_cost_usd += Number(r.totalApiCostUsd);
    monthly.emails_sent += r.emailsSent;
  }

  const perEmailCost = monthly.emails_sent > 0
    ? (monthly.total_api_cost_usd / monthly.emails_sent).toFixed(4)
    : '0.0000';

  res.json({
    daily,
    monthly: { ...monthly, perEmailCost: parseFloat(perEmailCost) }
  });
});

export default router;
