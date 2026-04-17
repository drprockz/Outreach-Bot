import { Router } from 'express';
import { getDb, today } from '../../core/db/index.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDb();
  const d = today();

  const todayMetrics = db.prepare(`SELECT * FROM daily_metrics WHERE date = ?`).get(d) || {};

  const weekMetrics = db.prepare(`
    SELECT
      COALESCE(SUM(leads_discovered), 0) AS leads_discovered,
      COALESCE(SUM(emails_sent), 0) AS emails_sent,
      COALESCE(SUM(emails_hard_bounced), 0) AS emails_hard_bounced,
      COALESCE(SUM(replies_total), 0) AS replies_total,
      COALESCE(SUM(replies_hot), 0) AS replies_hot,
      COALESCE(SUM(total_api_cost_usd), 0) AS total_api_cost_usd
    FROM daily_metrics
    WHERE date >= date('now', '-7 days')
  `).get();

  const monthMetrics = db.prepare(`
    SELECT
      COALESCE(SUM(leads_discovered), 0) AS leads_discovered,
      COALESCE(SUM(emails_sent), 0) AS emails_sent,
      COALESCE(SUM(emails_hard_bounced), 0) AS emails_hard_bounced,
      COALESCE(SUM(replies_total), 0) AS replies_total,
      COALESCE(SUM(replies_hot), 0) AS replies_hot,
      COALESCE(SUM(total_api_cost_usd), 0) AS total_api_cost_usd
    FROM daily_metrics
    WHERE date >= date('now', '-30 days')
  `).get();

  const funnel = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status NOT IN ('discovered', 'extraction_failed') THEN 1 ELSE 0 END) AS extracted,
      SUM(CASE WHEN website_quality_score IS NOT NULL THEN 1 ELSE 0 END) AS judged,
      SUM(CASE WHEN contact_email IS NOT NULL THEN 1 ELSE 0 END) AS email_found,
      SUM(CASE WHEN email_status = 'valid' OR email_status = 'catch-all' THEN 1 ELSE 0 END) AS email_valid,
      SUM(CASE WHEN icp_priority IN ('A','B') THEN 1 ELSE 0 END) AS icp_ab,
      SUM(CASE WHEN status IN ('sent','replied') THEN 1 ELSE 0 END) AS sent,
      SUM(CASE WHEN status = 'replied' THEN 1 ELSE 0 END) AS replied
    FROM leads
  `).get();

  const activeSeq = db.prepare(`SELECT COUNT(*) AS count FROM sequence_state WHERE status = 'active'`).get();

  const replyRate = weekMetrics.emails_sent > 0
    ? (weekMetrics.replies_total / weekMetrics.emails_sent * 100).toFixed(1)
    : '0.0';

  const bounceRate = (todayMetrics.emails_sent || 0) > 0
    ? ((todayMetrics.emails_hard_bounced || 0) / todayMetrics.emails_sent * 100).toFixed(1)
    : '0.0';

  const sendActivity = db.prepare(`
    SELECT date, emails_sent FROM daily_metrics
    WHERE date >= date('now', '-90 days')
    ORDER BY date ASC
  `).all();

  res.json({
    metrics: {
      today: todayMetrics,
      week: weekMetrics,
      month: monthMetrics,
      activeSequences: activeSeq?.count || 0,
      replyRate7d: parseFloat(replyRate),
      bounceRateToday: parseFloat(bounceRate)
    },
    funnel,
    sendActivity
  });
});

export default router;
