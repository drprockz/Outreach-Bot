import { Prisma } from '@prisma/client'
import { prisma } from 'shared'
import { builder } from '../builder.js'
import { requireAuth } from '../guards.js'
import {
  bucket,
  parseLeadFilter,
  type LeadFilterInput,
  type Thresholds,
} from '../lib/leadsFilter.js'

type DB = typeof prisma

// ─── Threshold helper ──────────────────────────────────────────────────────

async function getThresholds(db: DB): Promise<Thresholds> {
  const rows = await db.config.findMany({
    where: { key: { in: ['icp_threshold_a', 'icp_threshold_b'] } },
    select: { key: true, value: true },
  })
  const map = Object.fromEntries(rows.map((r) => [r.key, parseInt(r.value ?? '', 10)]))
  return {
    threshA: Number.isFinite(map.icp_threshold_a) ? map.icp_threshold_a : 70,
    threshB: Number.isFinite(map.icp_threshold_b) ? map.icp_threshold_b : 40,
  }
}

// ─── Lead shape ─────────────────────────────────────────────────────────────

type LeadShape = {
  id: number
  discoveredAt: string
  businessName: string | null
  websiteUrl: string | null
  category: string | null
  city: string | null
  country: string | null
  searchQuery: string | null
  techStack: string[]
  websiteProblems: string[]
  lastUpdated: string | null
  hasSsl: boolean | null
  hasAnalytics: boolean | null
  ownerName: string | null
  ownerRole: string | null
  businessSignals: string[]
  socialActive: boolean | null
  websiteQualityScore: number | null
  judgeReason: string | null
  judgeSkip: boolean
  icpScore: number | null
  icpReason: string | null
  icpBreakdownJson: string | null
  icpKeyMatches: string[]
  icpKeyGaps: string[]
  icpDisqualifiers: string[]
  employeesEstimate: string | null
  businessStage: string | null
  contactName: string | null
  contactEmail: string | null
  contactConfidence: string | null
  contactSource: string | null
  emailStatus: string | null
  emailVerifiedAt: string | null
  status: string
  domainLastContacted: string | null
  inRejectList: boolean
  geminiTokensUsed: number | null
  geminiCostUsd: number | null
  discoveryModel: string | null
  extractionModel: string | null
  judgeModel: string | null
  icpPriorityV2: string | null
  icpBucket: string | null
  dmLinkedinUrl: string | null
  companyLinkedinUrl: string | null
  founderLinkedinUrl: string | null
  manualHookNote: string | null
  signalCount: number
}

const Lead = builder.objectRef<LeadShape>('Lead')
builder.objectType(Lead, {
  fields: (t) => ({
    id: t.exposeInt('id'),
    discoveredAt: t.exposeString('discoveredAt'),
    businessName: t.string({ nullable: true, resolve: (l) => l.businessName }),
    websiteUrl: t.string({ nullable: true, resolve: (l) => l.websiteUrl }),
    category: t.string({ nullable: true, resolve: (l) => l.category }),
    city: t.string({ nullable: true, resolve: (l) => l.city }),
    country: t.string({ nullable: true, resolve: (l) => l.country }),
    searchQuery: t.string({ nullable: true, resolve: (l) => l.searchQuery }),
    techStack: t.stringList({ resolve: (l) => l.techStack }),
    websiteProblems: t.stringList({ resolve: (l) => l.websiteProblems }),
    lastUpdated: t.string({ nullable: true, resolve: (l) => l.lastUpdated }),
    hasSsl: t.boolean({ nullable: true, resolve: (l) => l.hasSsl }),
    hasAnalytics: t.boolean({ nullable: true, resolve: (l) => l.hasAnalytics }),
    ownerName: t.string({ nullable: true, resolve: (l) => l.ownerName }),
    ownerRole: t.string({ nullable: true, resolve: (l) => l.ownerRole }),
    businessSignals: t.stringList({ resolve: (l) => l.businessSignals }),
    socialActive: t.boolean({ nullable: true, resolve: (l) => l.socialActive }),
    websiteQualityScore: t.int({ nullable: true, resolve: (l) => l.websiteQualityScore }),
    judgeReason: t.string({ nullable: true, resolve: (l) => l.judgeReason }),
    judgeSkip: t.exposeBoolean('judgeSkip'),
    icpScore: t.int({ nullable: true, resolve: (l) => l.icpScore }),
    icpReason: t.string({ nullable: true, resolve: (l) => l.icpReason }),
    // The breakdown is a free-form Json blob; surface as JSON string.
    icpBreakdownJson: t.string({ nullable: true, resolve: (l) => l.icpBreakdownJson }),
    icpKeyMatches: t.stringList({ resolve: (l) => l.icpKeyMatches }),
    icpKeyGaps: t.stringList({ resolve: (l) => l.icpKeyGaps }),
    icpDisqualifiers: t.stringList({ resolve: (l) => l.icpDisqualifiers }),
    employeesEstimate: t.string({ nullable: true, resolve: (l) => l.employeesEstimate }),
    businessStage: t.string({ nullable: true, resolve: (l) => l.businessStage }),
    contactName: t.string({ nullable: true, resolve: (l) => l.contactName }),
    contactEmail: t.string({ nullable: true, resolve: (l) => l.contactEmail }),
    contactConfidence: t.string({ nullable: true, resolve: (l) => l.contactConfidence }),
    contactSource: t.string({ nullable: true, resolve: (l) => l.contactSource }),
    emailStatus: t.string({ nullable: true, resolve: (l) => l.emailStatus }),
    emailVerifiedAt: t.string({ nullable: true, resolve: (l) => l.emailVerifiedAt }),
    status: t.exposeString('status'),
    domainLastContacted: t.string({ nullable: true, resolve: (l) => l.domainLastContacted }),
    inRejectList: t.exposeBoolean('inRejectList'),
    geminiTokensUsed: t.int({ nullable: true, resolve: (l) => l.geminiTokensUsed }),
    geminiCostUsd: t.float({ nullable: true, resolve: (l) => l.geminiCostUsd }),
    discoveryModel: t.string({ nullable: true, resolve: (l) => l.discoveryModel }),
    extractionModel: t.string({ nullable: true, resolve: (l) => l.extractionModel }),
    judgeModel: t.string({ nullable: true, resolve: (l) => l.judgeModel }),
    icpPriorityV2: t.string({ nullable: true, resolve: (l) => l.icpPriorityV2 }),
    icpBucket: t.string({ nullable: true, resolve: (l) => l.icpBucket }),
    dmLinkedinUrl: t.string({ nullable: true, resolve: (l) => l.dmLinkedinUrl }),
    companyLinkedinUrl: t.string({ nullable: true, resolve: (l) => l.companyLinkedinUrl }),
    founderLinkedinUrl: t.string({ nullable: true, resolve: (l) => l.founderLinkedinUrl }),
    manualHookNote: t.string({ nullable: true, resolve: (l) => l.manualHookNote }),
    signalCount: t.exposeInt('signalCount'),
  }),
})

type LeadRow = NonNullable<Awaited<ReturnType<DB['lead']['findUnique']>>>
const arr = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : [])

function leadToShape(l: LeadRow, t: Thresholds, signalCount: number): LeadShape {
  const bucketName = l.icpScore !== null && l.icpScore !== undefined
    ? bucket(l.icpScore, t.threshA, t.threshB)
    : null
  const priorityLetter: Record<string, string> = { high: 'A', medium: 'B', low: 'C' }
  return {
    id: l.id,
    discoveredAt: l.discoveredAt.toISOString(),
    businessName: l.businessName,
    websiteUrl: l.websiteUrl,
    category: l.category,
    city: l.city,
    country: l.country,
    searchQuery: l.searchQuery,
    techStack: arr(l.techStack),
    websiteProblems: arr(l.websiteProblems),
    lastUpdated: l.lastUpdated,
    hasSsl: l.hasSsl,
    hasAnalytics: l.hasAnalytics,
    ownerName: l.ownerName,
    ownerRole: l.ownerRole,
    businessSignals: arr(l.businessSignals),
    socialActive: l.socialActive,
    websiteQualityScore: l.websiteQualityScore,
    judgeReason: l.judgeReason,
    judgeSkip: l.judgeSkip,
    icpScore: l.icpScore,
    icpReason: l.icpReason,
    icpBreakdownJson: l.icpBreakdown !== null && l.icpBreakdown !== undefined
      ? JSON.stringify(l.icpBreakdown)
      : null,
    icpKeyMatches: arr(l.icpKeyMatches),
    icpKeyGaps: arr(l.icpKeyGaps),
    icpDisqualifiers: arr(l.icpDisqualifiers),
    employeesEstimate: l.employeesEstimate,
    businessStage: l.businessStage,
    contactName: l.contactName,
    contactEmail: l.contactEmail,
    contactConfidence: l.contactConfidence,
    contactSource: l.contactSource,
    emailStatus: l.emailStatus,
    emailVerifiedAt: l.emailVerifiedAt?.toISOString() ?? null,
    status: l.status,
    domainLastContacted: l.domainLastContacted?.toISOString() ?? null,
    inRejectList: l.inRejectList,
    geminiTokensUsed: l.geminiTokensUsed,
    geminiCostUsd: l.geminiCostUsd !== null ? Number(l.geminiCostUsd) : null,
    discoveryModel: l.discoveryModel,
    extractionModel: l.extractionModel,
    judgeModel: l.judgeModel,
    icpPriorityV2: bucketName ? priorityLetter[bucketName] : null,
    icpBucket: bucketName,
    dmLinkedinUrl: l.dmLinkedinUrl,
    companyLinkedinUrl: l.companyLinkedinUrl,
    founderLinkedinUrl: l.founderLinkedinUrl,
    manualHookNote: l.manualHookNote,
    signalCount,
  }
}

// ─── Filter input ──────────────────────────────────────────────────────────

const LeadFilter = builder.inputType('LeadFilter', {
  fields: (t) => ({
    search: t.string({ required: false }),
    status: t.stringList({ required: false }),
    category: t.stringList({ required: false }),
    city: t.stringList({ required: false }),
    country: t.stringList({ required: false }),
    emailStatus: t.stringList({ required: false }),
    businessStage: t.stringList({ required: false }),
    employeesEstimate: t.stringList({ required: false }),
    icpPriority: t.stringList({ required: false }),
    icpScoreMin: t.int({ required: false }),
    icpScoreMax: t.int({ required: false }),
    qualityScoreMin: t.int({ required: false }),
    qualityScoreMax: t.int({ required: false }),
    hasLinkedinDm: t.boolean({ required: false }),
    inRejectList: t.string({ required: false }),
    dateFrom: t.string({ required: false }),
    dateTo: t.string({ required: false }),
    techStack: t.stringList({ required: false }),
    businessSignals: t.stringList({ required: false }),
    hasSignals: t.boolean({ required: false }),
    minSignalCount: t.int({ required: false }),
    signalType: t.stringList({ required: false }),
    signalDateFrom: t.string({ required: false }),
    signalDateTo: t.string({ required: false }),
  }),
})

// ─── JSONB any-of helper (raw SQL — scoped client doesn't auto-inject) ────

async function jsonArrayFilterIds(db: DB, orgId: number, column: string, values: string[]): Promise<number[] | null> {
  const clean = values.filter((v) => typeof v === 'string' && v.length > 0)
  if (!clean.length) return null
  // $queryRaw is NOT auto-scoped by createScopedPrisma — must pass orgId explicitly.
  // Column name comes from a hardcoded allowlist (caller); values list is parameterized.
  const ALLOWED_COLS = new Set(['tech_stack', 'business_signals'])
  if (!ALLOWED_COLS.has(column)) throw new Error(`disallowed column: ${column}`)
  const rows = await db.$queryRaw<{ id: number }[]>`
    SELECT id FROM leads
    WHERE org_id = ${orgId}
      AND jsonb_typeof(${Prisma.raw(`"${column}"`)}) = 'array'
      AND ${Prisma.raw(`"${column}"`)} ?| ${clean}::text[]
  `
  return rows.map((r) => r.id)
}

// ─── Listing payload ───────────────────────────────────────────────────────

type LeadListPayloadShape = {
  leads: LeadShape[]
  total: number
  page: number
  limit: number
}

const LeadListPayload = builder.objectRef<LeadListPayloadShape>('LeadListPayload')
builder.objectType(LeadListPayload, {
  fields: (t) => ({
    leads: t.field({ type: [Lead], resolve: (p) => p.leads }),
    total: t.exposeInt('total'),
    page: t.exposeInt('page'),
    limit: t.exposeInt('limit'),
  }),
})

builder.queryField('leads', (t) =>
  t.field({
    type: LeadListPayload,
    args: {
      page: t.arg.int({ defaultValue: 1 }),
      limit: t.arg.int({ defaultValue: 20 }),
      sort: t.arg.string({ required: false }),
      filter: t.arg({ type: LeadFilter, required: false }),
    },
    resolve: async (_root, args, ctx) => {
      requireAuth(ctx)
      const db = ctx.db as DB
      const page = Math.max(1, args.page ?? 1)
      const limit = Math.min(100, Math.max(1, args.limit ?? 20))
      const offset = (page - 1) * limit

      const thresholds = await getThresholds(db)
      const { where, orderBy, signalFilter } = parseLeadFilter(
        args.filter as LeadFilterInput | null,
        thresholds,
        args.sort,
      )

      // Signal sub-query — narrow leadIds first if a signal filter is active
      if (Object.keys(signalFilter).length) {
        const sw: Prisma.LeadSignalWhereInput = {}
        if (signalFilter.types) sw.signalType = { in: signalFilter.types }
        if (signalFilter.from || signalFilter.to) {
          const range: { gte?: Date; lte?: Date } = {}
          if (signalFilter.from) range.gte = signalFilter.from
          if (signalFilter.to) range.lte = signalFilter.to
          sw.signalDate = range
        }
        const grouped = await db.leadSignal.groupBy({
          by: ['leadId'], where: sw, _count: { _all: true },
        })
        const minCount = signalFilter.minCount ?? 1
        const eligible = grouped.filter((g) => g._count._all >= minCount).map((g) => g.leadId)
        where.AND = ([] as Prisma.LeadWhereInput[]).concat(where.AND ?? [], [
          { id: { in: eligible.length ? eligible : [-1] } },
        ])
      }

      // JSONB array filters
      const filter = args.filter as LeadFilterInput | null
      if (filter?.techStack && filter.techStack.length) {
        const ids = await jsonArrayFilterIds(db, ctx.user.orgId, 'tech_stack', filter.techStack)
        if (ids !== null) {
          where.AND = ([] as Prisma.LeadWhereInput[]).concat(where.AND ?? [], [
            { id: { in: ids.length ? ids : [-1] } },
          ])
        }
      }
      if (filter?.businessSignals && filter.businessSignals.length) {
        const ids = await jsonArrayFilterIds(db, ctx.user.orgId, 'business_signals', filter.businessSignals)
        if (ids !== null) {
          where.AND = ([] as Prisma.LeadWhereInput[]).concat(where.AND ?? [], [
            { id: { in: ids.length ? ids : [-1] } },
          ])
        }
      }

      const [total, leads] = await Promise.all([
        db.lead.count({ where }),
        db.lead.findMany({ where, orderBy, take: limit, skip: offset }),
      ])

      // Pre-join signal counts for badge rendering — avoids per-row N+1.
      const leadIds = leads.map((l) => l.id)
      const signalCounts = leadIds.length > 0
        ? await db.leadSignal.groupBy({ by: ['leadId'], where: { leadId: { in: leadIds } }, _count: { _all: true } })
        : []
      const countByLead = new Map(signalCounts.map((g) => [g.leadId, g._count._all]))

      return {
        leads: leads.map((l) => leadToShape(l, thresholds, countByLead.get(l.id) ?? 0)),
        total, page, limit,
      }
    },
  }),
)

// ─── KPI strip ─────────────────────────────────────────────────────────────

type KpiCountsShape = { total: number; readyToSend: number; icpA: number; icpB: number; icpC: number }
type GlobalKpisShape = KpiCountsShape & { signals7d: number; repliesAwaitingTriage: number }
type LeadKpisPayloadShape = { global: GlobalKpisShape; inFilter: KpiCountsShape }

const KpiCounts = builder.objectRef<KpiCountsShape>('LeadKpiCounts')
builder.objectType(KpiCounts, {
  fields: (t) => ({
    total: t.exposeInt('total'),
    readyToSend: t.exposeInt('readyToSend'),
    icpA: t.exposeInt('icpA'),
    icpB: t.exposeInt('icpB'),
    icpC: t.exposeInt('icpC'),
  }),
})

const GlobalKpis = builder.objectRef<GlobalKpisShape>('LeadKpiGlobal')
builder.objectType(GlobalKpis, {
  fields: (t) => ({
    total: t.exposeInt('total'),
    readyToSend: t.exposeInt('readyToSend'),
    icpA: t.exposeInt('icpA'),
    icpB: t.exposeInt('icpB'),
    icpC: t.exposeInt('icpC'),
    signals7d: t.exposeInt('signals7d'),
    repliesAwaitingTriage: t.exposeInt('repliesAwaitingTriage'),
  }),
})

const LeadKpisPayload = builder.objectRef<LeadKpisPayloadShape>('LeadKpisPayload')
builder.objectType(LeadKpisPayload, {
  fields: (t) => ({
    global: t.field({ type: GlobalKpis, resolve: (p) => p.global }),
    inFilter: t.field({ type: KpiCounts, resolve: (p) => p.inFilter }),
  }),
})

builder.queryField('leadKpis', (t) =>
  t.field({
    type: LeadKpisPayload,
    args: {
      sort: t.arg.string({ required: false }),
      filter: t.arg({ type: LeadFilter, required: false }),
    },
    resolve: async (_root, args, ctx) => {
      requireAuth(ctx)
      const db = ctx.db as DB
      const t1 = await getThresholds(db)
      const { where } = parseLeadFilter(args.filter as LeadFilterInput | null, t1, args.sort)
      const { where: globalWhere } = parseLeadFilter(null, t1, null)

      async function summarize(scopedWhere: Prisma.LeadWhereInput): Promise<KpiCountsShape> {
        const [total, readyToSend, icpA, icpB, icpC] = await Promise.all([
          db.lead.count({ where: scopedWhere }),
          db.lead.count({ where: { ...scopedWhere, status: 'ready' } }),
          db.lead.count({ where: { ...scopedWhere, icpScore: { gte: t1.threshA } } }),
          db.lead.count({ where: { ...scopedWhere, icpScore: { gte: t1.threshB, lt: t1.threshA } } }),
          db.lead.count({ where: { ...scopedWhere, icpScore: { lt: t1.threshB } } }),
        ])
        return { total, readyToSend, icpA, icpB, icpC }
      }

      const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000)
      const [globalCounts, inFilterCounts, signals7dRows, repliesAwaiting] = await Promise.all([
        summarize(globalWhere),
        summarize(where),
        db.leadSignal.findMany({ where: { signalDate: { gte: sevenDaysAgo } }, distinct: ['leadId'], select: { leadId: true } }),
        db.reply.count({ where: { actionedAt: null } }),
      ])

      return {
        global: { ...globalCounts, signals7d: signals7dRows.length, repliesAwaitingTriage: repliesAwaiting },
        inFilter: inFilterCounts,
      }
    },
  }),
)

// ─── Facets (no caching — Phase 8 callers re-add if needed) ────────────────

type LeadFacetsShape = { categories: string[]; cities: string[]; countries: string[] }

const LeadFacets = builder.objectRef<LeadFacetsShape>('LeadFacets')
builder.objectType(LeadFacets, {
  fields: (t) => ({
    categories: t.stringList({ resolve: (f) => f.categories }),
    cities: t.stringList({ resolve: (f) => f.cities }),
    countries: t.stringList({ resolve: (f) => f.countries }),
  }),
})

builder.queryField('leadFacets', (t) =>
  t.field({
    type: LeadFacets,
    resolve: async (_root, _args, ctx) => {
      requireAuth(ctx)
      const db = ctx.db as DB
      const [categories, cities, countries] = await Promise.all([
        db.lead.findMany({ where: { category: { not: null } }, distinct: ['category'], select: { category: true } })
          .then((r) => r.map((x) => x.category as string)),
        db.lead.findMany({ where: { city: { not: null } }, distinct: ['city'], select: { city: true } })
          .then((r) => r.map((x) => x.city as string)),
        db.lead.findMany({ where: { country: { not: null } }, distinct: ['country'], select: { country: true } })
          .then((r) => r.map((x) => x.country as string)),
      ])
      return { categories, cities, countries }
    },
  }),
)

// ─── Lead detail (lead + emails + replies + sequence + signals) ────────────

type LeadDetailEmailShape = {
  id: number; sequenceStep: number; status: string; subject: string | null
  body: string | null; sentAt: string | null; createdAt: string
}
type LeadDetailReplyShape = {
  id: number; emailId: number | null; receivedAt: string; category: string | null
  rawText: string | null; sentimentScore: number | null
  actionedAt: string | null; actionTaken: string | null
}
type LeadDetailSequenceShape = {
  id: number; currentStep: number; status: string; nextSendDate: string | null
  lastSentAt: string | null; lastSubject: string | null; pausedReason: string | null
}
type LeadSignalShape = {
  id: number; leadId: number; source: string; signalType: string
  headline: string | null; url: string | null; payloadJson: string | null
  confidence: number; signalDate: string | null; collectedAt: string
}
type LeadDetailPayloadShape = {
  lead: LeadShape
  emails: LeadDetailEmailShape[]
  replies: LeadDetailReplyShape[]
  sequence: LeadDetailSequenceShape | null
  signals: LeadSignalShape[]
}

const LeadDetailEmail = builder.objectRef<LeadDetailEmailShape>('LeadDetailEmail')
builder.objectType(LeadDetailEmail, {
  fields: (t) => ({
    id: t.exposeInt('id'),
    sequenceStep: t.exposeInt('sequenceStep'),
    status: t.exposeString('status'),
    subject: t.string({ nullable: true, resolve: (e) => e.subject }),
    body: t.string({ nullable: true, resolve: (e) => e.body }),
    sentAt: t.string({ nullable: true, resolve: (e) => e.sentAt }),
    createdAt: t.exposeString('createdAt'),
  }),
})

const LeadDetailReply = builder.objectRef<LeadDetailReplyShape>('LeadDetailReply')
builder.objectType(LeadDetailReply, {
  fields: (t) => ({
    id: t.exposeInt('id'),
    emailId: t.int({ nullable: true, resolve: (r) => r.emailId }),
    receivedAt: t.exposeString('receivedAt'),
    category: t.string({ nullable: true, resolve: (r) => r.category }),
    rawText: t.string({ nullable: true, resolve: (r) => r.rawText }),
    sentimentScore: t.int({ nullable: true, resolve: (r) => r.sentimentScore }),
    actionedAt: t.string({ nullable: true, resolve: (r) => r.actionedAt }),
    actionTaken: t.string({ nullable: true, resolve: (r) => r.actionTaken }),
  }),
})

const LeadDetailSequence = builder.objectRef<LeadDetailSequenceShape>('LeadDetailSequence')
builder.objectType(LeadDetailSequence, {
  fields: (t) => ({
    id: t.exposeInt('id'),
    currentStep: t.exposeInt('currentStep'),
    status: t.exposeString('status'),
    nextSendDate: t.string({ nullable: true, resolve: (s) => s.nextSendDate }),
    lastSentAt: t.string({ nullable: true, resolve: (s) => s.lastSentAt }),
    lastSubject: t.string({ nullable: true, resolve: (s) => s.lastSubject }),
    pausedReason: t.string({ nullable: true, resolve: (s) => s.pausedReason }),
  }),
})

const LeadSignal = builder.objectRef<LeadSignalShape>('LeadSignal')
builder.objectType(LeadSignal, {
  fields: (t) => ({
    id: t.exposeInt('id'),
    leadId: t.exposeInt('leadId'),
    source: t.exposeString('source'),
    signalType: t.exposeString('signalType'),
    headline: t.string({ nullable: true, resolve: (s) => s.headline }),
    url: t.string({ nullable: true, resolve: (s) => s.url }),
    payloadJson: t.string({ nullable: true, resolve: (s) => s.payloadJson }),
    confidence: t.exposeFloat('confidence'),
    signalDate: t.string({ nullable: true, resolve: (s) => s.signalDate }),
    collectedAt: t.exposeString('collectedAt'),
  }),
})

const LeadDetailPayload = builder.objectRef<LeadDetailPayloadShape>('LeadDetailPayload')
builder.objectType(LeadDetailPayload, {
  fields: (t) => ({
    lead: t.field({ type: Lead, resolve: (p) => p.lead }),
    emails: t.field({ type: [LeadDetailEmail], resolve: (p) => p.emails }),
    replies: t.field({ type: [LeadDetailReply], resolve: (p) => p.replies }),
    sequence: t.field({ type: LeadDetailSequence, nullable: true, resolve: (p) => p.sequence }),
    signals: t.field({ type: [LeadSignal], resolve: (p) => p.signals }),
  }),
})

type SignalRow = NonNullable<Awaited<ReturnType<DB['leadSignal']['findFirst']>>>
function toSignalShape(s: SignalRow): LeadSignalShape {
  return {
    id: s.id,
    leadId: s.leadId,
    source: s.source,
    signalType: s.signalType,
    headline: s.headline,
    url: s.url,
    payloadJson: s.payloadJson !== null && s.payloadJson !== undefined
      ? JSON.stringify(s.payloadJson)
      : null,
    confidence: s.confidence,
    signalDate: s.signalDate?.toISOString() ?? null,
    collectedAt: s.collectedAt.toISOString(),
  }
}

builder.queryField('lead', (t) =>
  t.field({
    type: LeadDetailPayload,
    nullable: true,
    args: { id: t.arg.int({ required: true }) },
    resolve: async (_root, { id }, ctx) => {
      requireAuth(ctx)
      const db = ctx.db as DB
      const lead = await db.lead.findUnique({ where: { id } })
      if (!lead) return null

      const [emails, replies, sequence, signals, thresholds, signalCount] = await Promise.all([
        db.email.findMany({ where: { leadId: id }, orderBy: { createdAt: 'desc' } }),
        db.reply.findMany({ where: { leadId: id }, orderBy: { receivedAt: 'desc' } }),
        db.sequenceState.findUnique({ where: { leadId: id } }),
        db.leadSignal.findMany({ where: { leadId: id }, orderBy: { confidence: 'desc' }, take: 10 }),
        getThresholds(db),
        db.leadSignal.count({ where: { leadId: id } }),
      ])

      return {
        lead: leadToShape(lead, thresholds, signalCount),
        emails: emails.map((e) => ({
          id: e.id,
          sequenceStep: e.sequenceStep,
          status: e.status,
          subject: e.subject,
          body: e.body,
          sentAt: e.sentAt?.toISOString() ?? null,
          createdAt: e.createdAt.toISOString(),
        })),
        replies: replies.map((r) => ({
          id: r.id,
          emailId: r.emailId,
          receivedAt: r.receivedAt.toISOString(),
          category: r.category,
          rawText: r.rawText,
          sentimentScore: r.sentimentScore,
          actionedAt: r.actionedAt?.toISOString() ?? null,
          actionTaken: r.actionTaken,
        })),
        sequence: sequence
          ? {
              id: sequence.id,
              currentStep: sequence.currentStep,
              status: sequence.status,
              nextSendDate: sequence.nextSendDate?.toISOString() ?? null,
              lastSentAt: sequence.lastSentAt?.toISOString() ?? null,
              lastSubject: sequence.lastSubject,
              pausedReason: sequence.pausedReason,
            }
          : null,
        signals: signals.map(toSignalShape),
      }
    },
  }),
)

builder.queryField('leadSignals', (t) =>
  t.field({
    type: [LeadSignal],
    args: { leadId: t.arg.int({ required: true }) },
    resolve: async (_root, { leadId }, ctx) => {
      requireAuth(ctx)
      const db = ctx.db as DB
      const signals = await db.leadSignal.findMany({
        where: { leadId },
        orderBy: { confidence: 'desc' },
        take: 10,
      })
      return signals.map(toSignalShape)
    },
  }),
)

// ─── Mutations ─────────────────────────────────────────────────────────────

builder.mutationField('updateLead', (t) =>
  t.field({
    type: Lead,
    args: {
      id: t.arg.int({ required: true }),
      manualHookNote: t.arg.string({ required: false }),
      status: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      requireAuth(ctx)
      const db = ctx.db as DB
      const existing = await db.lead.findUnique({ where: { id: args.id }, select: { id: true } })
      if (!existing) throw new Error('Lead not found')
      const data: Prisma.LeadUpdateInput = {}
      if (args.manualHookNote !== undefined && args.manualHookNote !== null) {
        data.manualHookNote = args.manualHookNote === '' ? null : args.manualHookNote
      }
      if (args.status !== undefined && args.status !== null) data.status = args.status
      if (Object.keys(data).length === 0) throw new Error('at least one whitelisted field is required')
      const updated = await db.lead.update({ where: { id: args.id }, data })
      const [thresholds, signalCount] = await Promise.all([
        getThresholds(db),
        db.leadSignal.count({ where: { leadId: args.id } }),
      ])
      return leadToShape(updated, thresholds, signalCount)
    },
  }),
)

builder.mutationField('setLeadStatus', (t) =>
  t.field({
    type: 'Boolean',
    args: {
      id: t.arg.int({ required: true }),
      status: t.arg.string({ required: true }),
    },
    resolve: async (_root, { id, status }, ctx) => {
      requireAuth(ctx)
      const db = ctx.db as DB
      const lead = await db.lead.findUnique({ where: { id }, select: { id: true } })
      if (!lead) throw new Error('Lead not found')
      await db.lead.update({ where: { id }, data: { status } })
      return true
    },
  }),
)

// ─── Bulk status (nurture / unsubscribed / reject / requeue) ──────────────

const BULK_ACTIONS = new Set(['nurture', 'unsubscribed', 'reject', 'requeue'])
const TERMINAL = new Set(['bounced', 'replied'])

type BulkSkipShape = { id: number; reason: string }
type BulkResultShape = {
  updated: number
  updatedIds: number[]
  skipped: BulkSkipShape[]
}

const BulkSkip = builder.objectRef<BulkSkipShape>('BulkLeadSkip')
builder.objectType(BulkSkip, {
  fields: (t) => ({
    id: t.exposeInt('id'),
    reason: t.exposeString('reason'),
  }),
})

const BulkResult = builder.objectRef<BulkResultShape>('BulkLeadResult')
builder.objectType(BulkResult, {
  fields: (t) => ({
    updated: t.exposeInt('updated'),
    updatedIds: t.field({ type: ['Int'], resolve: (r) => r.updatedIds }),
    skipped: t.field({ type: [BulkSkip], resolve: (r) => r.skipped }),
  }),
})

builder.mutationField('bulkLeadStatus', (t) =>
  t.field({
    type: BulkResult,
    args: {
      leadIds: t.arg({ type: ['Int'], required: true }),
      action: t.arg.string({ required: true }),
    },
    resolve: async (_root, { leadIds, action }, ctx) => {
      requireAuth(ctx)
      const db = ctx.db as DB
      if (!BULK_ACTIONS.has(action)) throw new Error('invalid_action')
      if (!leadIds.length) throw new Error('no_lead_ids')
      if (leadIds.length > 200) throw new Error('batch_too_large (max 200)')

      const thresholds = action === 'requeue' ? await getThresholds(db) : { threshA: 70, threshB: 40 }

      const leads = await db.lead.findMany({
        where: { id: { in: leadIds } },
        include: { emails: { where: { sequenceStep: 0, status: 'pending' }, take: 1 } },
      })
      const updated: number[] = []
      const skipped: BulkSkipShape[] = []

      for (const lead of leads) {
        if (TERMINAL.has(lead.status)) {
          skipped.push({ id: lead.id, reason: `terminal_${lead.status}` })
          continue
        }
        if (action === 'nurture') {
          await db.lead.update({ where: { id: lead.id }, data: { status: 'nurture' } })
          updated.push(lead.id)
        } else if (action === 'unsubscribed') {
          await db.lead.update({ where: { id: lead.id }, data: { status: 'unsubscribed' } })
          updated.push(lead.id)
        } else if (action === 'reject') {
          if (!lead.contactEmail) {
            skipped.push({ id: lead.id, reason: 'no_email' })
            continue
          }
          const domain = lead.contactEmail.split('@')[1] ?? null
          await db.rejectList.upsert({
            where: { email: lead.contactEmail },
            update: {},
            create: { email: lead.contactEmail, domain, reason: 'manual_bulk_reject' },
          })
          await db.lead.update({
            where: { id: lead.id },
            data: { status: 'unsubscribed', inRejectList: true },
          })
          updated.push(lead.id)
        } else if (action === 'requeue') {
          if (!lead.emails.length) {
            skipped.push({ id: lead.id, reason: 'no_pending_email' })
            continue
          }
          const b = lead.icpScore !== null && lead.icpScore !== undefined
            ? bucket(lead.icpScore, thresholds.threshA, thresholds.threshB)
            : null
          if (b === 'low') {
            skipped.push({ id: lead.id, reason: 'icp_c_cannot_queue' })
            continue
          }
          await db.lead.update({ where: { id: lead.id }, data: { status: 'ready' } })
          updated.push(lead.id)
        }
      }

      return { updated: updated.length, updatedIds: updated, skipped }
    },
  }),
)
