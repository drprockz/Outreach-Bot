import { Router } from 'express';
import { prisma, today } from '../../core/db/index.js';

const router = Router();

// Registry of engines this endpoint can trigger on demand.
// Each entry dynamically imports the engine so cold imports don't happen on boot.
const ENGINES = {
  findLeads: {
    load: () => import('../../engines/findLeads.js').then(m => m.default),
    // Allowed override keys per engine (anything else in body is ignored)
    overrideKeys: ['leadsCount', 'perBatch'],
  },
  // Future engines can be added here (sendEmails, checkReplies, etc.)
  // sendEmails intentionally NOT exposed — avoid accidental on-demand sends.
};

/**
 * POST /api/run-engine/:engineName
 * Body (optional): { leadsCount?: number, perBatch?: number }
 *
 * Kicks off the engine async — does NOT wait for completion. Returns the
 * newly-created cron_log row id immediately so the client can poll for
 * progress via GET /api/run-engine/status/:cronLogId.
 *
 * Concurrency guard: if a cron_log row already exists with status='running'
 * for this engine, returns 409 so two runs can't race.
 */
router.post('/:engineName', async (req, res) => {
  const { engineName } = req.params;
  const spec = ENGINES[engineName];
  if (!spec) {
    return res.status(404).json({ error: `Unknown engine: ${engineName}` });
  }

  // Refuse to start if something is already running for this engine
  const inFlight = await prisma.cronLog.findFirst({
    where: { jobName: engineName, status: 'running' },
    select: { id: true, startedAt: true },
  });
  if (inFlight) {
    return res.status(409).json({
      error: `${engineName} already running`,
      runningCronLogId: inFlight.id,
      startedAt: inFlight.startedAt,
    });
  }

  // Whitelist override keys
  const body = req.body || {};
  const override = {};
  for (const k of spec.overrideKeys) {
    if (k in body && typeof body[k] === 'number' && body[k] > 0) {
      override[k] = Math.floor(body[k]);
    }
  }

  // Load engine fn first so we can fail fast on import errors
  let engineFn;
  try {
    engineFn = await spec.load();
  } catch (err) {
    return res.status(500).json({ error: `Failed to load ${engineName}: ${err.message}` });
  }

  // Capture the cron_log id created by the engine, so we can return it.
  // The engine calls logCron() internally; we poll for its row just after kickoff.
  // Simplest: kick off async, then in a short wait, query the latest running row.
  const startedAt = new Date();
  engineFn(override).catch(err => {
    // Engine has its own try/catch + finishCron — this catches anything it throws
    // before/after. Log to console; cron_log already has the failed row.
    console.error(`[run-engine] ${engineName} rejected:`, err?.message || err);
  });

  // Wait briefly for the engine's logCron() to write its row, then find it
  await new Promise(r => setTimeout(r, 150));
  const row = await prisma.cronLog.findFirst({
    where: { jobName: engineName, startedAt: { gte: startedAt } },
    orderBy: { id: 'desc' },
    select: { id: true, startedAt: true, status: true },
  });

  if (!row) {
    // Unusual — engine didn't call logCron within 150ms. Return startedAt as fallback.
    return res.json({ engineName, cronLogId: null, startedAt, status: 'running', override });
  }

  res.json({ engineName, cronLogId: row.id, startedAt: row.startedAt, status: row.status, override });
});

/**
 * GET /api/run-engine/status/:cronLogId
 * Returns cron_log row + today's daily_metrics for live credit-burn UI.
 */
router.get('/status/:cronLogId', async (req, res) => {
  const cronLogId = parseInt(req.params.cronLogId, 10);
  if (!Number.isFinite(cronLogId)) {
    return res.status(400).json({ error: 'cronLogId must be a number' });
  }

  const cronLog = await prisma.cronLog.findUnique({
    where: { id: cronLogId },
    select: {
      id: true, jobName: true, status: true, startedAt: true, completedAt: true,
      durationMs: true, recordsProcessed: true, recordsSkipped: true, costUsd: true,
      errorMessage: true,
    },
  });
  if (!cronLog) return res.status(404).json({ error: 'Not found' });

  const metrics = await prisma.dailyMetrics.findUnique({
    where: { date: today() },
    select: {
      date: true,
      leadsDiscovered: true, leadsExtracted: true, leadsJudgePassed: true,
      leadsEmailFound: true, leadsEmailValid: true, leadsIcpAb: true,
      leadsReady: true, leadsDisqualified: true, icpParseErrors: true,
      geminiCostUsd: true, sonnetCostUsd: true, haikuCostUsd: true,
      mevCostUsd: true, totalApiCostUsd: true,
    },
  });

  const today_costs = metrics ? {
    date: metrics.date,
    leads_discovered: metrics.leadsDiscovered,
    leads_extracted: metrics.leadsExtracted,
    leads_judge_passed: metrics.leadsJudgePassed,
    leads_email_found: metrics.leadsEmailFound,
    leads_email_valid: metrics.leadsEmailValid,
    leads_icp_ab: metrics.leadsIcpAb,
    leads_ready: metrics.leadsReady,
    leads_disqualified: metrics.leadsDisqualified,
    icp_parse_errors: metrics.icpParseErrors,
    gemini_cost_usd: Number(metrics.geminiCostUsd),
    sonnet_cost_usd: Number(metrics.sonnetCostUsd),
    haiku_cost_usd: Number(metrics.haikuCostUsd),
    mev_cost_usd: Number(metrics.mevCostUsd),
    total_api_cost_usd: Number(metrics.totalApiCostUsd),
  } : null;

  res.json({
    cron_log: {
      id: cronLog.id,
      job_name: cronLog.jobName,
      status: cronLog.status,
      started_at: cronLog.startedAt,
      completed_at: cronLog.completedAt,
      duration_ms: cronLog.durationMs,
      records_processed: cronLog.recordsProcessed,
      records_skipped: cronLog.recordsSkipped,
      cost_usd: cronLog.costUsd ? Number(cronLog.costUsd) : 0,
      error_message: cronLog.errorMessage,
    },
    today_costs,
  });
});

/**
 * GET /api/run-engine/latest/:engineName
 * Returns the most recent cron_log for an engine — useful for "show last run"
 * cards on the dashboard.
 */
router.get('/latest/:engineName', async (req, res) => {
  const { engineName } = req.params;
  if (!ENGINES[engineName]) {
    return res.status(404).json({ error: `Unknown engine: ${engineName}` });
  }
  const row = await prisma.cronLog.findFirst({
    where: { jobName: engineName },
    orderBy: { id: 'desc' },
    select: {
      id: true, jobName: true, status: true, startedAt: true, completedAt: true,
      durationMs: true, recordsProcessed: true, recordsSkipped: true, costUsd: true,
      errorMessage: true,
    },
  });
  if (!row) return res.json({ cron_log: null });
  res.json({
    cron_log: {
      id: row.id,
      job_name: row.jobName,
      status: row.status,
      started_at: row.startedAt,
      completed_at: row.completedAt,
      duration_ms: row.durationMs,
      records_processed: row.recordsProcessed,
      records_skipped: row.recordsSkipped,
      cost_usd: row.costUsd ? Number(row.costUsd) : 0,
      error_message: row.errorMessage,
    },
  });
});

/**
 * GET /api/run-engine/today-costs
 * Lightweight endpoint for the CostTracker page's "today live" card.
 * Returns just today's running cost totals.
 */
router.get('/today-costs', async (req, res) => {
  const metrics = await prisma.dailyMetrics.findUnique({
    where: { date: today() },
    select: {
      date: true,
      geminiCostUsd: true, sonnetCostUsd: true, haikuCostUsd: true,
      mevCostUsd: true, totalApiCostUsd: true,
      leadsDiscovered: true, leadsReady: true, leadsDisqualified: true,
      emailsAttempted: true, emailsSent: true,
    },
  });
  if (!metrics) {
    return res.json({
      date: today(),
      gemini_cost_usd: 0, sonnet_cost_usd: 0, haiku_cost_usd: 0, mev_cost_usd: 0,
      total_api_cost_usd: 0,
      leads_discovered: 0, leads_ready: 0, leads_disqualified: 0,
      emails_attempted: 0, emails_sent: 0,
    });
  }
  res.json({
    date: metrics.date,
    gemini_cost_usd: Number(metrics.geminiCostUsd),
    sonnet_cost_usd: Number(metrics.sonnetCostUsd),
    haiku_cost_usd: Number(metrics.haikuCostUsd),
    mev_cost_usd: Number(metrics.mevCostUsd),
    total_api_cost_usd: Number(metrics.totalApiCostUsd),
    leads_discovered: metrics.leadsDiscovered,
    leads_ready: metrics.leadsReady,
    leads_disqualified: metrics.leadsDisqualified,
    emails_attempted: metrics.emailsAttempted,
    emails_sent: metrics.emailsSent,
  });
});

export default router;
