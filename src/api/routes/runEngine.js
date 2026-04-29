import { Router } from 'express';
import { today } from '../../core/db/index.js';

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

// Stale-lock recovery threshold: a cron_log row stuck in 'running' beyond this
// is treated as a crashed run and auto-finalized as 'failed' so the next manual
// trigger isn't blocked forever. Engines typically take <15min; default 30 leaves
// safe headroom. Override via env STALE_LOCK_MINUTES.
const STALE_LOCK_MINUTES = Math.max(1, parseInt(process.env.STALE_LOCK_MINUTES || '30', 10));

async function sweepStaleLocks(db, jobName) {
  const cutoff = new Date(Date.now() - STALE_LOCK_MINUTES * 60 * 1000);
  const { count } = await db.cronLog.updateMany({
    where: { jobName, status: 'running', startedAt: { lt: cutoff } },
    data: {
      status: 'failed',
      completedAt: new Date(),
      errorMessage: `auto-recovered: stale lock (no finishCron in >${STALE_LOCK_MINUTES}min, engine likely crashed)`,
    },
  });
  return count;
}

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

  // Sweep crashed/orphaned 'running' rows older than threshold so a prior
  // PM2 kill / OOM / hard-exit doesn't permanently block future triggers.
  const recovered = await sweepStaleLocks(req.db, engineName);

  // Refuse to start if something is genuinely still running for this engine
  const inFlight = await req.db.cronLog.findFirst({
    where: { jobName: engineName, status: 'running' },
    select: { id: true, startedAt: true },
  });
  if (inFlight) {
    return res.status(409).json({
      error: `${engineName} already running`,
      runningCronLogId: inFlight.id,
      startedAt: inFlight.startedAt,
      hint: `If this is stuck, POST /api/run-engine/${engineName}/unlock to force-clear, or wait ${STALE_LOCK_MINUTES}min for auto-recovery.`,
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
  // Engines now accept orgId as first arg (Tier 1.G1.2) so their internal
  // Prisma queries route to the requesting org's scoped client.
  const startedAt = new Date();
  engineFn(req.user.orgId, override).catch(err => {
    // Engine has its own try/catch + finishCron — this catches anything it throws
    // before/after. Log to console; cron_log already has the failed row.
    console.error(`[run-engine] ${engineName} rejected:`, err?.message || err);
  });

  // Wait briefly for the engine's logCron() to write its row, then find it
  await new Promise(r => setTimeout(r, 150));
  const row = await req.db.cronLog.findFirst({
    where: { jobName: engineName, startedAt: { gte: startedAt } },
    orderBy: { id: 'desc' },
    select: { id: true, startedAt: true, status: true },
  });

  if (!row) {
    // Unusual — engine didn't call logCron within 150ms. Return startedAt as fallback.
    return res.json({ engineName, cronLogId: null, startedAt, status: 'running', override });
  }

  res.json({
    engineName,
    cronLogId: row.id,
    startedAt: row.startedAt,
    status: row.status,
    override,
    ...(recovered > 0 ? { recoveredStaleLocks: recovered } : {}),
  });
});

/**
 * POST /api/run-engine/:engineName/unlock
 * Force-clear all running rows for this engine — use when the dashboard shows
 * "already running" but the engine is definitely not (e.g., post-crash). Marks
 * matching rows as 'failed' with a manual-unlock reason.
 */
router.post('/:engineName/unlock', async (req, res) => {
  const { engineName } = req.params;
  if (!ENGINES[engineName]) {
    return res.status(404).json({ error: `Unknown engine: ${engineName}` });
  }
  const { count } = await req.db.cronLog.updateMany({
    where: { jobName: engineName, status: 'running' },
    data: {
      status: 'failed',
      completedAt: new Date(),
      errorMessage: 'manually force-unlocked from dashboard',
    },
  });
  res.json({ engineName, unlocked: count });
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

  const cronLog = await req.db.cronLog.findUnique({
    where: { id: cronLogId },
    select: {
      id: true, jobName: true, status: true, startedAt: true, completedAt: true,
      durationMs: true, recordsProcessed: true, recordsSkipped: true, costUsd: true,
      errorMessage: true,
    },
  });
  if (!cronLog) return res.status(404).json({ error: 'Not found' });

  const metrics = await req.db.dailyMetrics.findUnique({
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
    leads_icp_ready: metrics.leadsIcpAb,
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
  const row = await req.db.cronLog.findFirst({
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
 * GET /api/run-engine/stats/:engineName
 * Rolling per-lead cost averages from the last N completed runs. Used by the
 * EngineRunner page to show a live cost projection before the user clicks
 * Generate — replaces a hardcoded estimate with data from their own history.
 *
 * Query params:
 *   sample (optional, default 10): how many most-recent completed runs to average
 */
router.get('/stats/:engineName', async (req, res) => {
  const { engineName } = req.params;
  if (!ENGINES[engineName]) {
    return res.status(404).json({ error: `Unknown engine: ${engineName}` });
  }

  const sample = Math.min(50, Math.max(1, parseInt(req.query.sample, 10) || 10));

  const runs = await req.db.cronLog.findMany({
    where: {
      jobName: engineName,
      status: 'success',
      // Only runs that actually processed leads (skipped runs would skew the average to 0)
      recordsProcessed: { gt: 0 },
      costUsd: { not: null },
    },
    orderBy: { id: 'desc' },
    take: sample,
    select: { id: true, costUsd: true, recordsProcessed: true, durationMs: true, completedAt: true },
  });

  if (runs.length === 0) {
    return res.json({
      sample_size: 0,
      avg_cost_per_lead_usd: null,
      median_cost_per_lead_usd: null,
      avg_duration_ms: null,
      most_recent_at: null,
    });
  }

  const perLead = runs.map(r => Number(r.costUsd) / r.recordsProcessed);
  const sumCost = runs.reduce((a, r) => a + Number(r.costUsd), 0);
  const sumLeads = runs.reduce((a, r) => a + r.recordsProcessed, 0);
  const sumDur = runs.reduce((a, r) => a + (r.durationMs || 0), 0);

  const sorted = [...perLead].sort((a, b) => a - b);
  const median = sorted.length % 2 === 0
    ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : sorted[Math.floor(sorted.length / 2)];

  res.json({
    sample_size: runs.length,
    // Weighted average (total cost / total leads) — more accurate than mean of per-run ratios
    avg_cost_per_lead_usd: sumLeads > 0 ? sumCost / sumLeads : null,
    median_cost_per_lead_usd: median,
    avg_duration_ms: runs.length > 0 ? Math.round(sumDur / runs.length) : null,
    most_recent_at: runs[0]?.completedAt,
  });
});

/**
 * GET /api/run-engine/today-costs
 * Lightweight endpoint for the CostTracker page's "today live" card.
 * Returns just today's running cost totals.
 */
router.get('/today-costs', async (req, res) => {
  const metrics = await req.db.dailyMetrics.findUnique({
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
