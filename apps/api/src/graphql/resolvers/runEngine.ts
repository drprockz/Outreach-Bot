import { prisma } from 'shared'
import { builder } from '../builder.js'
import { requireAuth } from '../guards.js'
import { queues } from '../../workers/scheduler.js'

type DB = typeof prisma

// Engines exposable for on-demand triggering. Mirrors the legacy
// src/api/routes/runEngine.js registry — sendEmails et al. stay off the list
// to avoid accidental on-demand sends from the dashboard.
type ExposableEngine = 'findLeads'
const TRIGGERABLE: Record<ExposableEngine, { overrideKeys: string[] }> = {
  findLeads: { overrideKeys: ['leadsCount', 'perBatch'] },
}
const ALL_ENGINE_NAMES = new Set([
  'findLeads', 'sendEmails', 'sendFollowups', 'checkReplies',
  'dailyReport', 'healthCheck', 'trialExpiry',
])

// Stale-lock recovery threshold: a cron_log row stuck in 'running' beyond this
// is treated as a crashed run and auto-finalized as 'failed' so the next manual
// trigger isn't blocked forever. Override via env STALE_LOCK_MINUTES.
const STALE_LOCK_MINUTES = Math.max(1, parseInt(process.env.STALE_LOCK_MINUTES ?? '30', 10))

async function sweepStaleLocks(db: DB, jobName: string): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_LOCK_MINUTES * 60 * 1000)
  const { count } = await db.cronLog.updateMany({
    where: { jobName, status: 'running', startedAt: { lt: cutoff } },
    data: {
      status: 'failed',
      completedAt: new Date(),
      errorMessage: `auto-recovered: stale lock (no finishCron in >${STALE_LOCK_MINUTES}min, engine likely crashed)`,
    },
  })
  return count
}

// ─── Run-engine mutation result ────────────────────────────────────────────

type RunEngineResultShape = {
  engineName: string
  jobId: string
  queuedAt: string
  status: 'queued'
  overrideJson: string
  recoveredStaleLocks: number
}

const RunEngineResult = builder.objectRef<RunEngineResultShape>('RunEngineResult')
builder.objectType(RunEngineResult, {
  fields: (t) => ({
    engineName: t.exposeString('engineName'),
    jobId: t.exposeString('jobId'),
    queuedAt: t.exposeString('queuedAt'),
    status: t.exposeString('status'),
    overrideJson: t.exposeString('overrideJson'),
    recoveredStaleLocks: t.exposeInt('recoveredStaleLocks'),
  }),
})

builder.mutationField('runEngine', (t) =>
  t.field({
    type: RunEngineResult,
    args: {
      engineName: t.arg.string({ required: true }),
      leadsCount: t.arg.int({ required: false }),
      perBatch: t.arg.int({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      requireAuth(ctx)
      const db = ctx.db as DB
      const engineName = args.engineName as ExposableEngine
      const spec = TRIGGERABLE[engineName]
      if (!spec) throw new Error(`Unknown or non-triggerable engine: ${args.engineName}`)

      const recoveredStaleLocks = await sweepStaleLocks(db, engineName)

      const inFlight = await db.cronLog.findFirst({
        where: { jobName: engineName, status: 'running' },
        select: { id: true, startedAt: true },
      })
      if (inFlight) {
        throw new Error(
          `${engineName} already running (cronLogId=${inFlight.id}, startedAt=${inFlight.startedAt?.toISOString() ?? '?'}). ` +
          `Use unlockEngine() to force-clear, or wait ${STALE_LOCK_MINUTES}min for auto-recovery.`,
        )
      }

      // Whitelist override keys
      const override: Record<string, number> = {}
      if (args.leadsCount !== null && args.leadsCount !== undefined && args.leadsCount > 0) {
        override.leadsCount = Math.floor(args.leadsCount)
      }
      if (args.perBatch !== null && args.perBatch !== undefined && args.perBatch > 0) {
        override.perBatch = Math.floor(args.perBatch)
      }

      const queue = queues[engineName]
      const job = await queue.add(engineName, { orgId: ctx.user.orgId, override })

      return {
        engineName,
        jobId: String(job.id ?? ''),
        queuedAt: new Date().toISOString(),
        status: 'queued' as const,
        overrideJson: JSON.stringify(override),
        recoveredStaleLocks,
      }
    },
  }),
)

builder.mutationField('unlockEngine', (t) =>
  t.field({
    type: 'Int',
    args: { engineName: t.arg.string({ required: true }) },
    resolve: async (_root, { engineName }, ctx) => {
      requireAuth(ctx)
      if (!ALL_ENGINE_NAMES.has(engineName)) throw new Error(`Unknown engine: ${engineName}`)
      const db = ctx.db as DB
      const { count } = await db.cronLog.updateMany({
        where: { jobName: engineName, status: 'running' },
        data: {
          status: 'failed',
          completedAt: new Date(),
          errorMessage: 'manually force-unlocked from dashboard',
        },
      })
      return count
    },
  }),
)

// ─── Status / latest / stats / today-costs queries ─────────────────────────

type CronLogSummaryShape = {
  id: number
  jobName: string | null
  status: string | null
  startedAt: string | null
  completedAt: string | null
  durationMs: number | null
  recordsProcessed: number | null
  recordsSkipped: number | null
  costUsd: number
  errorMessage: string | null
}

type TodayCostsShape = {
  date: string
  leadsDiscovered: number
  leadsExtracted: number
  leadsJudgePassed: number
  leadsEmailFound: number
  leadsEmailValid: number
  leadsIcpReady: number
  leadsReady: number
  leadsDisqualified: number
  icpParseErrors: number
  geminiCostUsd: number
  sonnetCostUsd: number
  haikuCostUsd: number
  mevCostUsd: number
  totalApiCostUsd: number
}

type EngineRunStatusPayloadShape = {
  cronLog: CronLogSummaryShape
  todayCosts: TodayCostsShape | null
}

const CronLogSummary = builder.objectRef<CronLogSummaryShape>('CronLogSummary')
builder.objectType(CronLogSummary, {
  fields: (t) => ({
    id: t.exposeInt('id'),
    jobName: t.string({ nullable: true, resolve: (l) => l.jobName }),
    status: t.string({ nullable: true, resolve: (l) => l.status }),
    startedAt: t.string({ nullable: true, resolve: (l) => l.startedAt }),
    completedAt: t.string({ nullable: true, resolve: (l) => l.completedAt }),
    durationMs: t.int({ nullable: true, resolve: (l) => l.durationMs }),
    recordsProcessed: t.int({ nullable: true, resolve: (l) => l.recordsProcessed }),
    recordsSkipped: t.int({ nullable: true, resolve: (l) => l.recordsSkipped }),
    costUsd: t.exposeFloat('costUsd'),
    errorMessage: t.string({ nullable: true, resolve: (l) => l.errorMessage }),
  }),
})

const TodayCosts = builder.objectRef<TodayCostsShape>('TodayCosts')
builder.objectType(TodayCosts, {
  fields: (t) => ({
    date: t.exposeString('date'),
    leadsDiscovered: t.exposeInt('leadsDiscovered'),
    leadsExtracted: t.exposeInt('leadsExtracted'),
    leadsJudgePassed: t.exposeInt('leadsJudgePassed'),
    leadsEmailFound: t.exposeInt('leadsEmailFound'),
    leadsEmailValid: t.exposeInt('leadsEmailValid'),
    leadsIcpReady: t.exposeInt('leadsIcpReady'),
    leadsReady: t.exposeInt('leadsReady'),
    leadsDisqualified: t.exposeInt('leadsDisqualified'),
    icpParseErrors: t.exposeInt('icpParseErrors'),
    geminiCostUsd: t.exposeFloat('geminiCostUsd'),
    sonnetCostUsd: t.exposeFloat('sonnetCostUsd'),
    haikuCostUsd: t.exposeFloat('haikuCostUsd'),
    mevCostUsd: t.exposeFloat('mevCostUsd'),
    totalApiCostUsd: t.exposeFloat('totalApiCostUsd'),
  }),
})

const EngineRunStatusPayload = builder.objectRef<EngineRunStatusPayloadShape>('EngineRunStatusPayload')
builder.objectType(EngineRunStatusPayload, {
  fields: (t) => ({
    cronLog: t.field({ type: CronLogSummary, resolve: (p) => p.cronLog }),
    todayCosts: t.field({ type: TodayCosts, nullable: true, resolve: (p) => p.todayCosts }),
  }),
})

type CronRow = NonNullable<Awaited<ReturnType<DB['cronLog']['findUnique']>>>
function toCronLogSummary(c: CronRow): CronLogSummaryShape {
  return {
    id: c.id,
    jobName: c.jobName,
    status: c.status,
    startedAt: c.startedAt?.toISOString() ?? null,
    completedAt: c.completedAt?.toISOString() ?? null,
    durationMs: c.durationMs,
    recordsProcessed: c.recordsProcessed,
    recordsSkipped: c.recordsSkipped,
    costUsd: c.costUsd !== null && c.costUsd !== undefined ? Number(c.costUsd) : 0,
    errorMessage: c.errorMessage,
  }
}

builder.queryField('engineRunStatus', (t) =>
  t.field({
    type: EngineRunStatusPayload,
    nullable: true,
    args: { cronLogId: t.arg.int({ required: true }) },
    resolve: async (_root, { cronLogId }, ctx) => {
      requireAuth(ctx)
      const db = ctx.db as DB
      const cronLog = await db.cronLog.findUnique({ where: { id: cronLogId } })
      if (!cronLog) return null

      const date = new Date().toISOString().slice(0, 10)
      const m = await db.dailyMetrics.findUnique({ where: { date } })
      const todayCosts: TodayCostsShape | null = m
        ? {
            date: m.date,
            leadsDiscovered: m.leadsDiscovered,
            leadsExtracted: m.leadsExtracted,
            leadsJudgePassed: m.leadsJudgePassed,
            leadsEmailFound: m.leadsEmailFound,
            leadsEmailValid: m.leadsEmailValid,
            leadsIcpReady: m.leadsIcpAb,
            leadsReady: m.leadsReady,
            leadsDisqualified: m.leadsDisqualified,
            icpParseErrors: m.icpParseErrors,
            geminiCostUsd: Number(m.geminiCostUsd),
            sonnetCostUsd: Number(m.sonnetCostUsd),
            haikuCostUsd: Number(m.haikuCostUsd),
            mevCostUsd: Number(m.mevCostUsd),
            totalApiCostUsd: Number(m.totalApiCostUsd),
          }
        : null

      return { cronLog: toCronLogSummary(cronLog), todayCosts }
    },
  }),
)

builder.queryField('engineLatest', (t) =>
  t.field({
    type: CronLogSummary,
    nullable: true,
    args: { engineName: t.arg.string({ required: true }) },
    resolve: async (_root, { engineName }, ctx) => {
      requireAuth(ctx)
      if (!ALL_ENGINE_NAMES.has(engineName)) throw new Error(`Unknown engine: ${engineName}`)
      const db = ctx.db as DB
      const row = await db.cronLog.findFirst({
        where: { jobName: engineName },
        orderBy: { id: 'desc' },
      })
      return row ? toCronLogSummary(row) : null
    },
  }),
)

// ─── Rolling cost stats ────────────────────────────────────────────────────

type EngineStatsShape = {
  sampleSize: number
  avgCostPerLeadUsd: number | null
  medianCostPerLeadUsd: number | null
  avgDurationMs: number | null
  mostRecentAt: string | null
}

const EngineStats = builder.objectRef<EngineStatsShape>('EngineStats')
builder.objectType(EngineStats, {
  fields: (t) => ({
    sampleSize: t.exposeInt('sampleSize'),
    avgCostPerLeadUsd: t.float({ nullable: true, resolve: (s) => s.avgCostPerLeadUsd }),
    medianCostPerLeadUsd: t.float({ nullable: true, resolve: (s) => s.medianCostPerLeadUsd }),
    avgDurationMs: t.int({ nullable: true, resolve: (s) => s.avgDurationMs }),
    mostRecentAt: t.string({ nullable: true, resolve: (s) => s.mostRecentAt }),
  }),
})

builder.queryField('engineStats', (t) =>
  t.field({
    type: EngineStats,
    args: {
      engineName: t.arg.string({ required: true }),
      sample: t.arg.int({ defaultValue: 10 }),
    },
    resolve: async (_root, args, ctx) => {
      requireAuth(ctx)
      if (!ALL_ENGINE_NAMES.has(args.engineName)) throw new Error(`Unknown engine: ${args.engineName}`)
      const db = ctx.db as DB
      const sample = Math.min(50, Math.max(1, args.sample ?? 10))

      const runs = await db.cronLog.findMany({
        where: {
          jobName: args.engineName,
          status: 'success',
          recordsProcessed: { gt: 0 },
          costUsd: { not: null },
        },
        orderBy: { id: 'desc' },
        take: sample,
        select: { costUsd: true, recordsProcessed: true, durationMs: true, completedAt: true },
      })

      if (runs.length === 0) {
        return {
          sampleSize: 0,
          avgCostPerLeadUsd: null,
          medianCostPerLeadUsd: null,
          avgDurationMs: null,
          mostRecentAt: null,
        }
      }

      const perLead = runs.map((r) => Number(r.costUsd) / (r.recordsProcessed ?? 1))
      const sumCost = runs.reduce((a, r) => a + Number(r.costUsd), 0)
      const sumLeads = runs.reduce((a, r) => a + (r.recordsProcessed ?? 0), 0)
      const sumDur = runs.reduce((a, r) => a + (r.durationMs ?? 0), 0)

      const sorted = [...perLead].sort((a, b) => a - b)
      const median = sorted.length % 2 === 0
        ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
        : sorted[Math.floor(sorted.length / 2)]

      return {
        sampleSize: runs.length,
        avgCostPerLeadUsd: sumLeads > 0 ? sumCost / sumLeads : null,
        medianCostPerLeadUsd: median,
        avgDurationMs: Math.round(sumDur / runs.length),
        mostRecentAt: runs[0]?.completedAt?.toISOString() ?? null,
      }
    },
  }),
)

// ─── Today's live cost card ────────────────────────────────────────────────

type EngineTodayCostsShape = {
  date: string
  geminiCostUsd: number
  sonnetCostUsd: number
  haikuCostUsd: number
  mevCostUsd: number
  totalApiCostUsd: number
  leadsDiscovered: number
  leadsReady: number
  leadsDisqualified: number
  emailsAttempted: number
  emailsSent: number
}

const EngineTodayCostsObj = builder.objectRef<EngineTodayCostsShape>('EngineTodayCosts')
builder.objectType(EngineTodayCostsObj, {
  fields: (t) => ({
    date: t.exposeString('date'),
    geminiCostUsd: t.exposeFloat('geminiCostUsd'),
    sonnetCostUsd: t.exposeFloat('sonnetCostUsd'),
    haikuCostUsd: t.exposeFloat('haikuCostUsd'),
    mevCostUsd: t.exposeFloat('mevCostUsd'),
    totalApiCostUsd: t.exposeFloat('totalApiCostUsd'),
    leadsDiscovered: t.exposeInt('leadsDiscovered'),
    leadsReady: t.exposeInt('leadsReady'),
    leadsDisqualified: t.exposeInt('leadsDisqualified'),
    emailsAttempted: t.exposeInt('emailsAttempted'),
    emailsSent: t.exposeInt('emailsSent'),
  }),
})

builder.queryField('engineTodayCosts', (t) =>
  t.field({
    type: EngineTodayCostsObj,
    resolve: async (_root, _args, ctx) => {
      requireAuth(ctx)
      const db = ctx.db as DB
      const date = new Date().toISOString().slice(0, 10)
      const m = await db.dailyMetrics.findUnique({ where: { date } })
      if (!m) {
        return {
          date,
          geminiCostUsd: 0, sonnetCostUsd: 0, haikuCostUsd: 0,
          mevCostUsd: 0, totalApiCostUsd: 0,
          leadsDiscovered: 0, leadsReady: 0, leadsDisqualified: 0,
          emailsAttempted: 0, emailsSent: 0,
        }
      }
      return {
        date: m.date,
        geminiCostUsd: Number(m.geminiCostUsd),
        sonnetCostUsd: Number(m.sonnetCostUsd),
        haikuCostUsd: Number(m.haikuCostUsd),
        mevCostUsd: Number(m.mevCostUsd),
        totalApiCostUsd: Number(m.totalApiCostUsd),
        leadsDiscovered: m.leadsDiscovered,
        leadsReady: m.leadsReady,
        leadsDisqualified: m.leadsDisqualified,
        emailsAttempted: m.emailsAttempted,
        emailsSent: m.emailsSent,
      }
    },
  }),
)
