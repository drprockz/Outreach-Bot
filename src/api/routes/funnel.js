import { Router } from 'express';
import { getConfigMap, getConfigInt } from '../../core/db/index.js';

const router = Router();

function datesWithin(nDays) {
  const out = [];
  const now = new Date();
  for (let i = nDays; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

router.get('/', async (req, res) => {
  const cfg = await getConfigMap();
  const threshA = getConfigInt(cfg, 'icp_threshold_a', 70);
  const threshB = getConfigInt(cfg, 'icp_threshold_b', 40);

  // Aggregate over every lead — easiest to fetch lean projection and fold in JS
  const leads = await req.db.lead.findMany({
    select: {
      status: true,
      websiteQualityScore: true,
      contactEmail: true,
      emailStatus: true,
      icpScore: true,
      judgeSkip: true,
      category: true,
      city: true,
      contactConfidence: true,
    },
  });

  const stages = {
    discovered: leads.length,
    extracted: 0,
    judge_passed: 0,
    email_found: 0,
    email_valid: 0,
    icp_ready: 0,      // score >= threshB (previously icp_ab)
    nurture: 0,
    ready: 0,
    sent: 0,
    replied: 0,
    unsubscribed: 0,
    icp_high: 0,       // score >= threshA
    icp_medium: 0,     // threshB <= score < threshA
    icp_low: 0,        // score < threshB
  };

  const dropReasons = {
    extraction_failed: 0,
    gate1_modern_stack: 0,
    no_email: 0,
    email_invalid: 0,
    deduped: 0,
    icp_low_nurture: 0,
    email_not_found: 0,
  };

  const categoryMap = new Map();
  const cityMap = new Map();
  const icpScoreMap = new Map();
  const emailStatusMap = new Map();
  const confidenceMap = new Map();

  for (const l of leads) {
    const score = l.icpScore;
    const scored = Number.isFinite(score);
    const isHigh   = scored && score >= threshA;
    const isMedium = scored && score >= threshB && score < threshA;
    const isLow    = scored && score < threshB;
    const isReady  = scored && score >= threshB;

    if (l.status !== 'discovered' && l.status !== 'extraction_failed') stages.extracted++;
    if (l.websiteQualityScore !== null) stages.judge_passed++;
    if (l.contactEmail !== null) stages.email_found++;
    if (l.emailStatus === 'valid' || l.emailStatus === 'catch-all') stages.email_valid++;
    if (isReady) stages.icp_ready++;
    if (l.status === 'nurture') stages.nurture++;
    if (l.status === 'ready') stages.ready++;
    if (l.status === 'sent' || l.status === 'replied' || l.status === 'bounced') stages.sent++;
    if (l.status === 'replied') stages.replied++;
    if (l.status === 'unsubscribed') stages.unsubscribed++;
    if (isHigh)   stages.icp_high++;
    if (isMedium) stages.icp_medium++;
    if (isLow)    stages.icp_low++;

    if (l.status === 'extraction_failed') dropReasons.extraction_failed++;
    if (l.judgeSkip) dropReasons.gate1_modern_stack++;
    if (l.websiteQualityScore !== null && l.contactEmail === null) dropReasons.no_email++;
    if (l.emailStatus === 'invalid' || l.emailStatus === 'disposable') dropReasons.email_invalid++;
    if (l.status === 'deduped') dropReasons.deduped++;
    if (isLow) dropReasons.icp_low_nurture++;
    if (l.status === 'email_not_found') dropReasons.email_not_found++;

    // byCategory
    const cat = l.category || 'unknown';
    if (!categoryMap.has(cat)) categoryMap.set(cat, { category: cat, total: 0, icp_high: 0, icp_medium: 0, icp_low: 0, ready_or_sent: 0 });
    const catRow = categoryMap.get(cat);
    catRow.total++;
    if (isHigh)   catRow.icp_high++;
    if (isMedium) catRow.icp_medium++;
    if (isLow)    catRow.icp_low++;
    if (l.status === 'ready' || l.status === 'sent' || l.status === 'replied') catRow.ready_or_sent++;

    // byCity
    const city = l.city || 'unknown';
    if (!cityMap.has(city)) cityMap.set(city, { city, total: 0, ready_or_sent: 0 });
    const cityRow = cityMap.get(city);
    cityRow.total++;
    if (l.status === 'ready' || l.status === 'sent' || l.status === 'replied') cityRow.ready_or_sent++;

    // icpDistribution
    if (l.icpScore !== null && l.icpScore !== undefined) {
      icpScoreMap.set(l.icpScore, (icpScoreMap.get(l.icpScore) || 0) + 1);
    }

    // emailStatusBreakdown (only for rows with a contact_email)
    if (l.contactEmail !== null) {
      const s = l.emailStatus || 'unknown';
      emailStatusMap.set(s, (emailStatusMap.get(s) || 0) + 1);
      const c = l.contactConfidence || 'unknown';
      confidenceMap.set(c, (confidenceMap.get(c) || 0) + 1);
    }
  }

  const byCategory = [...categoryMap.values()].sort((a, b) => b.total - a.total).slice(0, 10);
  const byCity = [...cityMap.values()].sort((a, b) => b.total - a.total).slice(0, 8);
  const icpDistribution = [...icpScoreMap.entries()]
    .map(([icp_score, count]) => ({ icp_score, count }))
    .sort((a, b) => a.icp_score - b.icp_score);
  const emailStatusBreakdown = [...emailStatusMap.entries()]
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count);
  const confidenceBreakdown = [...confidenceMap.entries()]
    .map(([confidence, count]) => ({ confidence, count }))
    .sort((a, b) => b.count - a.count);

  // Daily trend (30 days)
  const windowStart = datesWithin(30)[0];
  const dm = await req.db.dailyMetrics.findMany({
    where: { date: { gte: windowStart } },
    orderBy: { date: 'asc' },
    select: {
      date: true,
      leadsDiscovered: true,
      leadsExtracted: true,
      leadsJudgePassed: true,
      leadsEmailFound: true,
      leadsEmailValid: true,
      leadsIcpAb: true,
      leadsReady: true,
      emailsSent: true,
    },
  });
  const dailyTrend = dm.map(r => ({
    date: r.date,
    discovered: r.leadsDiscovered || 0,
    extracted: r.leadsExtracted || 0,
    judge_passed: r.leadsJudgePassed || 0,
    email_found: r.leadsEmailFound || 0,
    email_valid: r.leadsEmailValid || 0,
    icp_ready: r.leadsIcpAb || 0,
    ready: r.leadsReady || 0,
    sent: r.emailsSent || 0,
  }));

  res.json({ stages, dropReasons, dailyTrend, byCategory, byCity, icpDistribution, emailStatusBreakdown, confidenceBreakdown });
});

export default router;
