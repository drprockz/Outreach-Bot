import { Router } from 'express';
import { prisma, today, getConfigMap, getConfigInt } from '../../core/db/index.js';

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

// Map DailyMetrics row to snake_case response shape
function metricsToSnake(m) {
  return {
    id: m.id,
    date: m.date,
    leads_discovered: m.leadsDiscovered,
    leads_extracted: m.leadsExtracted,
    leads_judge_passed: m.leadsJudgePassed,
    leads_email_found: m.leadsEmailFound,
    leads_email_valid: m.leadsEmailValid,
    leads_icp_ready: m.leadsIcpAb,
    leads_ready: m.leadsReady,
    leads_disqualified: m.leadsDisqualified,
    emails_attempted: m.emailsAttempted,
    emails_sent: m.emailsSent,
    emails_hard_bounced: m.emailsHardBounced,
    emails_soft_bounced: m.emailsSoftBounced,
    emails_content_rejected: m.emailsContentRejected,
    sent_inbox_1: m.sentInbox1,
    sent_inbox_2: m.sentInbox2,
    replies_total: m.repliesTotal,
    replies_hot: m.repliesHot,
    replies_schedule: m.repliesSchedule,
    replies_soft_no: m.repliesSoftNo,
    replies_unsubscribe: m.repliesUnsubscribe,
    replies_ooo: m.repliesOoo,
    replies_other: m.repliesOther,
    bounce_rate: m.bounceRate,
    reply_rate: m.replyRate,
    unsubscribe_rate: m.unsubscribeRate,
    gemini_cost_usd: Number(m.geminiCostUsd),
    sonnet_cost_usd: Number(m.sonnetCostUsd),
    haiku_cost_usd: Number(m.haikuCostUsd),
    mev_cost_usd: Number(m.mevCostUsd),
    total_api_cost_usd: Number(m.totalApiCostUsd),
    total_api_cost_inr: Number(m.totalApiCostInr),
    domain_blacklisted: m.domainBlacklisted ? 1 : 0,
    blacklist_zones: m.blacklistZones,
    mail_tester_score: m.mailTesterScore,
    postmaster_reputation: m.postmasterReputation,
    icp_parse_errors: m.icpParseErrors,
    followups_sent: m.followupsSent,
    created_at: m.createdAt,
  };
}

async function sumWindow(nDays) {
  const windowStart = datesWithin(nDays)[0];
  const rows = await prisma.dailyMetrics.findMany({
    where: { date: { gte: windowStart } },
    select: {
      leadsDiscovered: true,
      emailsSent: true,
      emailsHardBounced: true,
      repliesTotal: true,
      repliesHot: true,
      totalApiCostUsd: true,
    },
  });
  const out = {
    leads_discovered: 0,
    emails_sent: 0,
    emails_hard_bounced: 0,
    replies_total: 0,
    replies_hot: 0,
    total_api_cost_usd: 0,
  };
  for (const r of rows) {
    out.leads_discovered += r.leadsDiscovered;
    out.emails_sent += r.emailsSent;
    out.emails_hard_bounced += r.emailsHardBounced;
    out.replies_total += r.repliesTotal;
    out.replies_hot += r.repliesHot;
    out.total_api_cost_usd += Number(r.totalApiCostUsd);
  }
  return out;
}

router.get('/', async (req, res) => {
  const d = today();

  const todayRow = await prisma.dailyMetrics.findUnique({ where: { date: d } });
  const todayMetrics = todayRow ? metricsToSnake(todayRow) : {};

  const weekMetrics = await sumWindow(7);
  const monthMetrics = await sumWindow(30);

  const cfg = await getConfigMap();
  const threshB = getConfigInt(cfg, 'icp_threshold_b', 40);

  const leads = await prisma.lead.findMany({
    select: {
      status: true,
      websiteQualityScore: true,
      contactEmail: true,
      emailStatus: true,
      icpScore: true,
    },
  });

  const funnel = {
    total: leads.length,
    extracted: 0,
    judged: 0,
    email_found: 0,
    email_valid: 0,
    icp_ready: 0,
    sent: 0,
    replied: 0,
  };
  for (const l of leads) {
    if (l.status !== 'discovered' && l.status !== 'extraction_failed') funnel.extracted++;
    if (l.websiteQualityScore !== null) funnel.judged++;
    if (l.contactEmail !== null) funnel.email_found++;
    if (l.emailStatus === 'valid' || l.emailStatus === 'catch-all') funnel.email_valid++;
    if (Number.isFinite(l.icpScore) && l.icpScore >= threshB) funnel.icp_ready++;
    if (l.status === 'sent' || l.status === 'replied') funnel.sent++;
    if (l.status === 'replied') funnel.replied++;
  }

  const activeSeq = await prisma.sequenceState.count({ where: { status: 'active' } });

  const replyRate = weekMetrics.emails_sent > 0
    ? (weekMetrics.replies_total / weekMetrics.emails_sent * 100).toFixed(1)
    : '0.0';

  const bounceRate = (todayMetrics.emails_sent || 0) > 0
    ? ((todayMetrics.emails_hard_bounced || 0) / todayMetrics.emails_sent * 100).toFixed(1)
    : '0.0';

  const windowStart = datesWithin(90)[0];
  const sendRows = await prisma.dailyMetrics.findMany({
    where: { date: { gte: windowStart } },
    orderBy: { date: 'asc' },
    select: { date: true, emailsSent: true },
  });
  const sendActivity = sendRows.map(r => ({ date: r.date, emails_sent: r.emailsSent }));

  res.json({
    metrics: {
      today: todayMetrics,
      week: weekMetrics,
      month: monthMetrics,
      activeSequences: activeSeq,
      replyRate7d: parseFloat(replyRate),
      bounceRateToday: parseFloat(bounceRate)
    },
    funnel,
    sendActivity
  });
});

export default router;
