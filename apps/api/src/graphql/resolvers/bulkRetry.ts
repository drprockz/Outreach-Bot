import { prisma } from 'shared'
import { builder } from '../builder.js'
import { requireAuth } from '../guards.js'

type DB = typeof prisma

const STAGES = new Set(['verify_email', 'regen_hook', 'regen_body', 'rescore_icp', 'reextract', 'rejudge'])
const MEV_FALLBACK = Number(process.env.MEV_COST_PER_CALL) || 0.0006
const MAX_BATCH = 25

type AvgResult = { mean: number; count: number }

function avg(rows: Record<string, unknown>[], key: string): AvgResult {
  const xs = rows
    .map((r) => Number(r[key]))
    .filter((n) => Number.isFinite(n) && n > 0)
  return xs.length
    ? { mean: xs.reduce((a, b) => a + b, 0) / xs.length, count: xs.length }
    : { mean: 0, count: 0 }
}

async function estimateCost(db: DB, stage: string): Promise<AvgResult> {
  if (stage === 'verify_email') return { mean: MEV_FALLBACK, count: 999 }
  if (stage === 'regen_hook' || stage === 'regen_body') {
    const rows = await db.email.findMany({
      orderBy: { id: 'desc' }, take: 200,
      select: { hookCostUsd: true, bodyCostUsd: true },
    })
    return avg(
      rows as unknown as Record<string, unknown>[],
      stage === 'regen_hook' ? 'hookCostUsd' : 'bodyCostUsd',
    )
  }
  // rescore_icp / reextract / rejudge — proxy via Lead.geminiCostUsd
  const rows = await db.lead.findMany({
    where: { geminiCostUsd: { gt: 0 } },
    orderBy: { id: 'desc' }, take: 200,
    select: { geminiCostUsd: true },
  })
  return avg(rows as unknown as Record<string, unknown>[], 'geminiCostUsd')
}

// ─── Estimate query (cost preview — non-streaming) ─────────────────────────

type BulkRetryEstimateShape = {
  count: number
  estimatedCostUsd: number
  stage: string
  estimateQuality: 'low' | 'normal'
}

const BulkRetryEstimate = builder.objectRef<BulkRetryEstimateShape>('BulkRetryEstimate')
builder.objectType(BulkRetryEstimate, {
  fields: (t) => ({
    count: t.exposeInt('count'),
    estimatedCostUsd: t.exposeFloat('estimatedCostUsd'),
    stage: t.exposeString('stage'),
    estimateQuality: t.exposeString('estimateQuality'),
  }),
})

builder.queryField('bulkRetryEstimate', (t) =>
  t.field({
    type: BulkRetryEstimate,
    args: {
      stage: t.arg.string({ required: true }),
      leadIds: t.arg({ type: ['Int'], required: true }),
    },
    resolve: async (_root, { stage, leadIds }, ctx) => {
      requireAuth(ctx)
      if (!STAGES.has(stage)) throw new Error('invalid_stage')
      if (!leadIds.length) throw new Error('no_lead_ids')
      if (leadIds.length > MAX_BATCH) throw new Error(`batch_too_large (max ${MAX_BATCH})`)
      const db = ctx.db as DB
      const est = await estimateCost(db, stage)
      const total = est.mean * leadIds.length
      const estimateQuality: 'low' | 'normal' = est.count < 5 ? 'low' : 'normal'
      return {
        count: leadIds.length,
        estimatedCostUsd: Number(total.toFixed(4)),
        stage,
        estimateQuality,
      }
    },
  }),
)

// ─── Per-lead context loader ───────────────────────────────────────────────

interface Persona {
  name: string; role: string; company: string; tone: string; services: string
}

interface ScoringWeights {
  firmographic: number; problem: number; intent: number
  tech: number; economic: number; buying: number
}

interface RetryContext {
  persona: Persona
  scoringCtx?: {
    offer: unknown
    icp: unknown
    weights: ScoringWeights
  }
}

async function getCfgString(db: DB, key: string, fallback: string): Promise<string> {
  const row = await db.config.findUnique({ where: { key }, select: { value: true } })
  return row?.value ?? fallback
}

async function getCfgInt(db: DB, key: string, fallback: number): Promise<number> {
  const row = await db.config.findUnique({ where: { key }, select: { value: true } })
  const v = parseInt(row?.value ?? '', 10)
  return Number.isFinite(v) ? v : fallback
}

// Cross-import legacy ESM helpers via dynamic import. apps/api's tsconfig
// rootDir bars static cross-imports, but `await import(<runtime path>)` slips
// past — same trick used by apps/api/src/workers/findLeads.worker.ts.
const loadLegacy = (path: string): Promise<Record<string, unknown>> =>
  import(/* @vite-ignore */ path)

async function loadCtx(db: DB, stage: string): Promise<RetryContext> {
  const persona: Persona = {
    name: await getCfgString(db, 'persona_name', 'Darshan Parmar'),
    role: await getCfgString(db, 'persona_role', 'Full-Stack Developer'),
    company: await getCfgString(db, 'persona_company', 'Simple Inc'),
    tone: await getCfgString(db, 'persona_tone', 'professional but direct'),
    services: await getCfgString(db, 'persona_services', 'web rebuilds and custom software'),
  }
  const ctx: RetryContext = { persona }
  if (stage === 'rescore_icp') {
    const scorer = await loadLegacy('../../../../../src/core/ai/icpScorer.js') as {
      loadScoringContext: (db: unknown) => Promise<{ offer: unknown; icp: unknown }>
    }
    const scoringCtx = await scorer.loadScoringContext(db)
    ctx.scoringCtx = {
      ...scoringCtx,
      weights: {
        firmographic: await getCfgInt(db, 'icp_weight_firmographic', 20),
        problem: await getCfgInt(db, 'icp_weight_problem', 20),
        intent: await getCfgInt(db, 'icp_weight_intent', 15),
        tech: await getCfgInt(db, 'icp_weight_tech', 15),
        economic: await getCfgInt(db, 'icp_weight_economic', 15),
        buying: await getCfgInt(db, 'icp_weight_buying', 15),
      },
    }
  }
  return ctx
}

// ─── runStage — calls into legacy pipeline helpers ─────────────────────────

type LeadRow = NonNullable<Awaited<ReturnType<DB['lead']['findUnique']>>>

function toLegacyShape(lead: LeadRow): Record<string, unknown> {
  return {
    id: lead.id,
    business_name: lead.businessName,
    website_url: lead.websiteUrl,
    city: lead.city,
    category: lead.category,
    contact_name: lead.contactName,
    contact_email: lead.contactEmail,
    owner_name: lead.ownerName,
    owner_role: lead.ownerRole,
    employees_estimate: lead.employeesEstimate,
    business_stage: lead.businessStage,
    tech_stack: lead.techStack,
    business_signals: lead.businessSignals,
    website_problems: lead.websiteProblems,
    judge_reason: lead.judgeReason,
    manual_hook_note: lead.manualHookNote,
  }
}

async function runStage(
  db: DB,
  stage: string,
  lead: LeadRow,
  ctx: RetryContext,
): Promise<{ costUsd: number }> {
  const legacy = toLegacyShape(lead)

  if (stage === 'verify_email') {
    if (!lead.contactEmail) throw new Error('no_contact_email')
    const mod = await loadLegacy('../../../../../src/core/pipeline/verifyEmailLib.js') as {
      verifyEmail: (email: string) => Promise<{ status?: string; costUsd?: number }>
    }
    const r = await mod.verifyEmail(lead.contactEmail)
    if (!r || !r.status || r.status === 'skipped' || r.status === 'error') {
      throw new Error(`verify_email_failed: ${r?.status ?? 'no_response'}`)
    }
    await db.lead.update({
      where: { id: lead.id },
      data: { emailStatus: r.status, emailVerifiedAt: new Date() },
    })
    return { costUsd: r.costUsd ?? 0 }
  }

  if (stage === 'rescore_icp') {
    const scorer = await loadLegacy('../../../../../src/core/ai/icpScorer.js') as {
      scoreLead: (lead: unknown, ctx: unknown) => Promise<{
        icp_score: number; icp_reason: string
        icp_breakdown: unknown; icp_key_matches: unknown
        icp_key_gaps: unknown; icp_disqualifiers: unknown
        costUsd?: number
      }>
    }
    const r = await scorer.scoreLead(legacy, ctx.scoringCtx)
    await db.lead.update({
      where: { id: lead.id },
      data: {
        icpScore: r.icp_score,
        icpReason: r.icp_reason,
        icpBreakdown: r.icp_breakdown as Parameters<DB['lead']['update']>[0]['data']['icpBreakdown'],
        icpKeyMatches: r.icp_key_matches as Parameters<DB['lead']['update']>[0]['data']['icpKeyMatches'],
        icpKeyGaps: r.icp_key_gaps as Parameters<DB['lead']['update']>[0]['data']['icpKeyGaps'],
        icpDisqualifiers: r.icp_disqualifiers as Parameters<DB['lead']['update']>[0]['data']['icpDisqualifiers'],
      },
    })
    return { costUsd: r.costUsd ?? 0 }
  }

  if (stage === 'regen_hook') {
    const email = await db.email.findFirst({
      where: { leadId: lead.id, sequenceStep: 0, status: 'pending' },
    })
    if (!email) throw new Error('no_pending_email')
    const signals = await db.leadSignal.findMany({
      where: { leadId: lead.id }, orderBy: { confidence: 'desc' }, take: 3,
    })
    const mod = await loadLegacy('../../../../../src/core/pipeline/regenerateHook.js') as {
      regenerateHook: (lead: unknown, persona: unknown, signals: unknown) => Promise<{
        hook: string; costUsd: number; model: string; hookVariantId?: string
      }>
    }
    const r = await mod.regenerateHook(legacy, ctx.persona, signals)
    await db.email.update({
      where: { id: email.id },
      data: {
        hook: r.hook, hookCostUsd: r.costUsd, hookModel: r.model,
        hookVariantId: r.hookVariantId ?? null,
      },
    })
    return { costUsd: r.costUsd }
  }

  if (stage === 'regen_body') {
    const email = await db.email.findFirst({
      where: { leadId: lead.id, sequenceStep: 0, status: 'pending' },
    })
    if (!email) throw new Error('no_pending_email')
    if (!email.hook) throw new Error('no_hook_run_regen_hook_first')
    const mod = await loadLegacy('../../../../../src/core/pipeline/regenerateBody.js') as {
      regenerateBody: (lead: unknown, hook: string, persona: unknown) => Promise<{
        body: string; costUsd: number; model: string
      }>
    }
    const r = await mod.regenerateBody(legacy, email.hook, ctx.persona)
    await db.email.update({
      where: { id: email.id },
      data: { body: r.body, bodyCostUsd: r.costUsd, bodyModel: r.model },
    })
    return { costUsd: r.costUsd }
  }

  if (stage === 'reextract' || stage === 'rejudge') {
    const mod = await loadLegacy('../../../../../src/core/pipeline/reextract.js') as {
      reextract: (lead: unknown) => Promise<{ data?: Record<string, unknown>; costUsd: number }>
    }
    const r = await mod.reextract(legacy)
    if (!r.data) throw new Error(`${stage}_failed`)
    if (stage === 'reextract') {
      await db.lead.update({
        where: { id: lead.id },
        data: {
          ownerName: r.data.owner_name as string | null,
          ownerRole: r.data.owner_role as string | null,
          contactEmail: r.data.contact_email as string | null,
          contactConfidence: r.data.contact_confidence as string | null,
          contactSource: r.data.contact_source as string | null,
          techStack: r.data.tech_stack as Parameters<DB['lead']['update']>[0]['data']['techStack'],
          websiteProblems: r.data.website_problems as Parameters<DB['lead']['update']>[0]['data']['websiteProblems'],
          lastUpdated: r.data.last_updated as string | null,
          hasSsl: !!r.data.has_ssl,
          hasAnalytics: !!r.data.has_analytics,
          businessSignals: r.data.business_signals as Parameters<DB['lead']['update']>[0]['data']['businessSignals'],
          socialActive: !!r.data.social_active,
          websiteQualityScore: r.data.website_quality_score as number | null,
          judgeReason: r.data.judge_reason as string | null,
          employeesEstimate: r.data.employees_estimate as string | null,
          businessStage: r.data.business_stage as string | null,
        },
      })
    } else {
      await db.lead.update({
        where: { id: lead.id },
        data: {
          judgeReason: r.data.judge_reason as string | null,
          websiteQualityScore: r.data.website_quality_score as number | null,
        },
      })
    }
    return { costUsd: r.costUsd }
  }

  throw new Error(`unknown_stage_${stage}`)
}

// ─── Subscription event shape ──────────────────────────────────────────────

type BulkRetryEventShape = {
  leadId: number | null
  status: 'ok' | 'error' | 'done'
  costUsd: number | null
  error: string | null
}

const BulkRetryEvent = builder.objectRef<BulkRetryEventShape>('BulkRetryEvent')
builder.objectType(BulkRetryEvent, {
  fields: (t) => ({
    leadId: t.int({ nullable: true, resolve: (e) => e.leadId }),
    status: t.exposeString('status'),
    costUsd: t.float({ nullable: true, resolve: (e) => e.costUsd }),
    error: t.string({ nullable: true, resolve: (e) => e.error }),
  }),
})

// ─── Subscription resolver ─────────────────────────────────────────────────

interface BulkRetryArgs { stage: string; leadIds: number[] }

async function* bulkRetryRunIterator(
  args: BulkRetryArgs,
  ctx: { db: DB; user: { orgId: number } },
): AsyncGenerator<BulkRetryEventShape> {
  if (!STAGES.has(args.stage)) throw new Error('invalid_stage')
  if (!args.leadIds.length) throw new Error('no_lead_ids')
  if (args.leadIds.length > MAX_BATCH) throw new Error(`batch_too_large (max ${MAX_BATCH})`)
  if (process.env.BULK_RETRY_ENABLED !== 'true') throw new Error('bulk_retry_disabled')

  const db = ctx.db
  const stageCtx = await loadCtx(db, args.stage)
  const leads = await db.lead.findMany({ where: { id: { in: args.leadIds } } })

  for (const lead of leads) {
    try {
      const r = await runStage(db, args.stage, lead, stageCtx)
      yield { leadId: lead.id, status: 'ok', costUsd: r.costUsd, error: null }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      try {
        await db.errorLog.create({
          data: {
            source: 'bulk_retry',
            errorType: args.stage,
            errorMessage: message,
            leadId: lead.id,
            occurredAt: new Date(),
          },
        })
      } catch {
        // never let logging failure break the loop
      }
      yield { leadId: lead.id, status: 'error', costUsd: null, error: message }
    }
  }

  yield { leadId: null, status: 'done', costUsd: null, error: null }
}

builder.subscriptionField('bulkRetryRun', (t) =>
  t.field({
    type: BulkRetryEvent,
    args: {
      stage: t.arg.string({ required: true }),
      leadIds: t.arg({ type: ['Int'], required: true }),
    },
    subscribe: (_root, args, ctx) => {
      requireAuth(ctx)
      return bulkRetryRunIterator(
        { stage: args.stage, leadIds: args.leadIds },
        { db: ctx.db as DB, user: ctx.user },
      )
    },
    resolve: (payload: BulkRetryEventShape) => payload,
  }),
)
