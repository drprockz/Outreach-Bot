import { Router } from 'express';
import { getDb } from '../../core/db/index.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDb();

  const stages = db.prepare(`
    SELECT
      COUNT(*) AS discovered,
      SUM(CASE WHEN status NOT IN ('discovered','extraction_failed') THEN 1 ELSE 0 END) AS extracted,
      SUM(CASE WHEN website_quality_score IS NOT NULL THEN 1 ELSE 0 END) AS judge_passed,
      SUM(CASE WHEN contact_email IS NOT NULL THEN 1 ELSE 0 END) AS email_found,
      SUM(CASE WHEN email_status IN ('valid','catch-all') THEN 1 ELSE 0 END) AS email_valid,
      SUM(CASE WHEN icp_priority IN ('A','B') THEN 1 ELSE 0 END) AS icp_ab,
      SUM(CASE WHEN status = 'nurture' THEN 1 ELSE 0 END) AS nurture,
      SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END) AS ready,
      SUM(CASE WHEN status IN ('sent','replied','bounced') THEN 1 ELSE 0 END) AS sent,
      SUM(CASE WHEN status = 'replied' THEN 1 ELSE 0 END) AS replied,
      SUM(CASE WHEN status = 'unsubscribed' THEN 1 ELSE 0 END) AS unsubscribed,
      SUM(CASE WHEN icp_priority = 'A' THEN 1 ELSE 0 END) AS icp_a,
      SUM(CASE WHEN icp_priority = 'B' THEN 1 ELSE 0 END) AS icp_b,
      SUM(CASE WHEN icp_priority = 'C' THEN 1 ELSE 0 END) AS icp_c
    FROM leads
  `).get();

  const dropReasons = db.prepare(`
    SELECT
      SUM(CASE WHEN status = 'extraction_failed' THEN 1 ELSE 0 END) AS extraction_failed,
      SUM(CASE WHEN judge_skip = 1 THEN 1 ELSE 0 END) AS gate1_modern_stack,
      SUM(CASE WHEN website_quality_score IS NOT NULL AND contact_email IS NULL THEN 1 ELSE 0 END) AS no_email,
      SUM(CASE WHEN email_status IN ('invalid','disposable') THEN 1 ELSE 0 END) AS email_invalid,
      SUM(CASE WHEN status = 'deduped' THEN 1 ELSE 0 END) AS deduped,
      SUM(CASE WHEN icp_priority = 'C' THEN 1 ELSE 0 END) AS icp_c_nurture,
      SUM(CASE WHEN status = 'email_not_found' THEN 1 ELSE 0 END) AS email_not_found
    FROM leads
  `).get();

  const dailyTrend = db.prepare(`
    SELECT
      date,
      COALESCE(leads_discovered, 0) AS discovered,
      COALESCE(leads_extracted, 0) AS extracted,
      COALESCE(leads_judge_passed, 0) AS judge_passed,
      COALESCE(leads_email_found, 0) AS email_found,
      COALESCE(leads_email_valid, 0) AS email_valid,
      COALESCE(leads_icp_ab, 0) AS icp_ab,
      COALESCE(leads_ready, 0) AS ready,
      COALESCE(emails_sent, 0) AS sent
    FROM daily_metrics
    WHERE date >= date('now', '-30 days')
    ORDER BY date ASC
  `).all();

  const byCategory = db.prepare(`
    SELECT
      COALESCE(category, 'unknown') AS category,
      COUNT(*) AS total,
      SUM(CASE WHEN icp_priority = 'A' THEN 1 ELSE 0 END) AS icp_a,
      SUM(CASE WHEN icp_priority = 'B' THEN 1 ELSE 0 END) AS icp_b,
      SUM(CASE WHEN icp_priority = 'C' THEN 1 ELSE 0 END) AS icp_c,
      SUM(CASE WHEN status IN ('ready','sent','replied') THEN 1 ELSE 0 END) AS ready_or_sent
    FROM leads
    GROUP BY category
    ORDER BY total DESC
    LIMIT 10
  `).all();

  const byCity = db.prepare(`
    SELECT
      COALESCE(city, 'unknown') AS city,
      COUNT(*) AS total,
      SUM(CASE WHEN status IN ('ready','sent','replied') THEN 1 ELSE 0 END) AS ready_or_sent
    FROM leads
    GROUP BY city
    ORDER BY total DESC
    LIMIT 8
  `).all();

  const icpDistribution = db.prepare(`
    SELECT icp_score, COUNT(*) AS count
    FROM leads
    WHERE icp_score IS NOT NULL
    GROUP BY icp_score
    ORDER BY icp_score ASC
  `).all();

  const emailStatusBreakdown = db.prepare(`
    SELECT
      COALESCE(email_status, 'unknown') AS status,
      COUNT(*) AS count
    FROM leads
    WHERE contact_email IS NOT NULL
    GROUP BY email_status
    ORDER BY count DESC
  `).all();

  const confidenceBreakdown = db.prepare(`
    SELECT
      COALESCE(contact_confidence, 'unknown') AS confidence,
      COUNT(*) AS count
    FROM leads
    WHERE contact_email IS NOT NULL
    GROUP BY contact_confidence
    ORDER BY count DESC
  `).all();

  res.json({ stages, dropReasons, dailyTrend, byCategory, byCity, icpDistribution, emailStatusBreakdown, confidenceBreakdown });
});

export default router;
