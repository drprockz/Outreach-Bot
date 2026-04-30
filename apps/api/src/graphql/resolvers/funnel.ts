import { prisma } from 'shared'
import { builder } from '../builder.js'
import { requireAuth } from '../guards.js'

type DB = typeof prisma

function datesWithin(nDays: number): string[] {
  const out: string[] = []
  const now = new Date()
  for (let i = nDays; i >= 0; i--) {
    out.push(new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10))
  }
  return out
}

async function getConfigInt(db: DB, key: string, fallback: number): Promise<number> {
  const row = await db.config.findUnique({ where: { key }, select: { value: true } })
  const v = parseInt(row?.value ?? '', 10)
  return Number.isFinite(v) ? v : fallback
}

// ─── Shapes ─────────────────────────────────────────────────────────────────

type FunnelStagesShape = {
  discovered: number; extracted: number; judgePassed: number
  emailFound: number; emailValid: number; icpReady: number
  nurture: number; ready: number; sent: number
  replied: number; unsubscribed: number
  icpHigh: number; icpMedium: number; icpLow: number
}

type FunnelDropReasonsShape = {
  extractionFailed: number; gate1ModernStack: number; noEmail: number
  emailInvalid: number; deduped: number; icpLowNurture: number; emailNotFound: number
}

type DailyTrendShape = {
  date: string; discovered: number; extracted: number; judgePassed: number
  emailFound: number; emailValid: number; icpReady: number
  ready: number; sent: number
}

type CategoryRowShape = {
  category: string; total: number
  icpHigh: number; icpMedium: number; icpLow: number
  readyOrSent: number
}

type CityRowShape = { city: string; total: number; readyOrSent: number }
type IcpDistributionShape = { icpScore: number; count: number }
type EmailStatusBreakdownShape = { status: string; count: number }
type ConfidenceBreakdownShape = { confidence: string; count: number }

type FunnelPayloadShape = {
  stages: FunnelStagesShape
  dropReasons: FunnelDropReasonsShape
  dailyTrend: DailyTrendShape[]
  byCategory: CategoryRowShape[]
  byCity: CityRowShape[]
  icpDistribution: IcpDistributionShape[]
  emailStatusBreakdown: EmailStatusBreakdownShape[]
  confidenceBreakdown: ConfidenceBreakdownShape[]
}

const FunnelStages = builder.objectRef<FunnelStagesShape>('FunnelStages')
builder.objectType(FunnelStages, {
  fields: (t) => ({
    discovered: t.exposeInt('discovered'),
    extracted: t.exposeInt('extracted'),
    judgePassed: t.exposeInt('judgePassed'),
    emailFound: t.exposeInt('emailFound'),
    emailValid: t.exposeInt('emailValid'),
    icpReady: t.exposeInt('icpReady'),
    nurture: t.exposeInt('nurture'),
    ready: t.exposeInt('ready'),
    sent: t.exposeInt('sent'),
    replied: t.exposeInt('replied'),
    unsubscribed: t.exposeInt('unsubscribed'),
    icpHigh: t.exposeInt('icpHigh'),
    icpMedium: t.exposeInt('icpMedium'),
    icpLow: t.exposeInt('icpLow'),
  }),
})

const FunnelDropReasons = builder.objectRef<FunnelDropReasonsShape>('FunnelDropReasons')
builder.objectType(FunnelDropReasons, {
  fields: (t) => ({
    extractionFailed: t.exposeInt('extractionFailed'),
    gate1ModernStack: t.exposeInt('gate1ModernStack'),
    noEmail: t.exposeInt('noEmail'),
    emailInvalid: t.exposeInt('emailInvalid'),
    deduped: t.exposeInt('deduped'),
    icpLowNurture: t.exposeInt('icpLowNurture'),
    emailNotFound: t.exposeInt('emailNotFound'),
  }),
})

const DailyTrend = builder.objectRef<DailyTrendShape>('FunnelDailyTrend')
builder.objectType(DailyTrend, {
  fields: (t) => ({
    date: t.exposeString('date'),
    discovered: t.exposeInt('discovered'),
    extracted: t.exposeInt('extracted'),
    judgePassed: t.exposeInt('judgePassed'),
    emailFound: t.exposeInt('emailFound'),
    emailValid: t.exposeInt('emailValid'),
    icpReady: t.exposeInt('icpReady'),
    ready: t.exposeInt('ready'),
    sent: t.exposeInt('sent'),
  }),
})

const CategoryRow = builder.objectRef<CategoryRowShape>('FunnelCategoryRow')
builder.objectType(CategoryRow, {
  fields: (t) => ({
    category: t.exposeString('category'),
    total: t.exposeInt('total'),
    icpHigh: t.exposeInt('icpHigh'),
    icpMedium: t.exposeInt('icpMedium'),
    icpLow: t.exposeInt('icpLow'),
    readyOrSent: t.exposeInt('readyOrSent'),
  }),
})

const CityRow = builder.objectRef<CityRowShape>('FunnelCityRow')
builder.objectType(CityRow, {
  fields: (t) => ({
    city: t.exposeString('city'),
    total: t.exposeInt('total'),
    readyOrSent: t.exposeInt('readyOrSent'),
  }),
})

const IcpDistribution = builder.objectRef<IcpDistributionShape>('IcpDistribution')
builder.objectType(IcpDistribution, {
  fields: (t) => ({
    icpScore: t.exposeInt('icpScore'),
    count: t.exposeInt('count'),
  }),
})

const EmailStatusBreakdown = builder.objectRef<EmailStatusBreakdownShape>('EmailStatusBreakdown')
builder.objectType(EmailStatusBreakdown, {
  fields: (t) => ({
    status: t.exposeString('status'),
    count: t.exposeInt('count'),
  }),
})

const ConfidenceBreakdown = builder.objectRef<ConfidenceBreakdownShape>('ConfidenceBreakdown')
builder.objectType(ConfidenceBreakdown, {
  fields: (t) => ({
    confidence: t.exposeString('confidence'),
    count: t.exposeInt('count'),
  }),
})

const FunnelPayload = builder.objectRef<FunnelPayloadShape>('FunnelPayload')
builder.objectType(FunnelPayload, {
  fields: (t) => ({
    stages: t.field({ type: FunnelStages, resolve: (o) => o.stages }),
    dropReasons: t.field({ type: FunnelDropReasons, resolve: (o) => o.dropReasons }),
    dailyTrend: t.field({ type: [DailyTrend], resolve: (o) => o.dailyTrend }),
    byCategory: t.field({ type: [CategoryRow], resolve: (o) => o.byCategory }),
    byCity: t.field({ type: [CityRow], resolve: (o) => o.byCity }),
    icpDistribution: t.field({ type: [IcpDistribution], resolve: (o) => o.icpDistribution }),
    emailStatusBreakdown: t.field({ type: [EmailStatusBreakdown], resolve: (o) => o.emailStatusBreakdown }),
    confidenceBreakdown: t.field({ type: [ConfidenceBreakdown], resolve: (o) => o.confidenceBreakdown }),
  }),
})

builder.queryField('funnel', (t) =>
  t.field({
    type: FunnelPayload,
    resolve: async (_root, _args, ctx) => {
      requireAuth(ctx)
      const db = ctx.db as DB
      const [threshA, threshB] = await Promise.all([
        getConfigInt(db, 'icp_threshold_a', 70),
        getConfigInt(db, 'icp_threshold_b', 40),
      ])

      const leads = await db.lead.findMany({
        select: {
          status: true, websiteQualityScore: true, contactEmail: true,
          emailStatus: true, icpScore: true, judgeSkip: true,
          category: true, city: true, contactConfidence: true,
        },
      })

      const stages: FunnelStagesShape = {
        discovered: leads.length,
        extracted: 0, judgePassed: 0,
        emailFound: 0, emailValid: 0, icpReady: 0,
        nurture: 0, ready: 0, sent: 0,
        replied: 0, unsubscribed: 0,
        icpHigh: 0, icpMedium: 0, icpLow: 0,
      }
      const dropReasons: FunnelDropReasonsShape = {
        extractionFailed: 0, gate1ModernStack: 0, noEmail: 0,
        emailInvalid: 0, deduped: 0, icpLowNurture: 0, emailNotFound: 0,
      }

      const categoryMap = new Map<string, CategoryRowShape>()
      const cityMap = new Map<string, CityRowShape>()
      const icpScoreMap = new Map<number, number>()
      const emailStatusMap = new Map<string, number>()
      const confidenceMap = new Map<string, number>()

      for (const l of leads) {
        const score = l.icpScore
        const scored = Number.isFinite(score)
        const isHigh = scored && (score as number) >= threshA
        const isMedium = scored && (score as number) >= threshB && (score as number) < threshA
        const isLow = scored && (score as number) < threshB
        const isReady = scored && (score as number) >= threshB

        if (l.status !== 'discovered' && l.status !== 'extraction_failed') stages.extracted++
        if (l.websiteQualityScore !== null) stages.judgePassed++
        if (l.contactEmail !== null) stages.emailFound++
        if (l.emailStatus === 'valid' || l.emailStatus === 'catch-all') stages.emailValid++
        if (isReady) stages.icpReady++
        if (l.status === 'nurture') stages.nurture++
        if (l.status === 'ready') stages.ready++
        if (l.status === 'sent' || l.status === 'replied' || l.status === 'bounced') stages.sent++
        if (l.status === 'replied') stages.replied++
        if (l.status === 'unsubscribed') stages.unsubscribed++
        if (isHigh) stages.icpHigh++
        if (isMedium) stages.icpMedium++
        if (isLow) stages.icpLow++

        if (l.status === 'extraction_failed') dropReasons.extractionFailed++
        if (l.judgeSkip) dropReasons.gate1ModernStack++
        if (l.websiteQualityScore !== null && l.contactEmail === null) dropReasons.noEmail++
        if (l.emailStatus === 'invalid' || l.emailStatus === 'disposable') dropReasons.emailInvalid++
        if (l.status === 'deduped') dropReasons.deduped++
        if (isLow) dropReasons.icpLowNurture++
        if (l.status === 'email_not_found') dropReasons.emailNotFound++

        const cat = l.category ?? 'unknown'
        let catRow = categoryMap.get(cat)
        if (!catRow) {
          catRow = { category: cat, total: 0, icpHigh: 0, icpMedium: 0, icpLow: 0, readyOrSent: 0 }
          categoryMap.set(cat, catRow)
        }
        catRow.total++
        if (isHigh) catRow.icpHigh++
        if (isMedium) catRow.icpMedium++
        if (isLow) catRow.icpLow++
        if (l.status === 'ready' || l.status === 'sent' || l.status === 'replied') catRow.readyOrSent++

        const city = l.city ?? 'unknown'
        let cityRow = cityMap.get(city)
        if (!cityRow) {
          cityRow = { city, total: 0, readyOrSent: 0 }
          cityMap.set(city, cityRow)
        }
        cityRow.total++
        if (l.status === 'ready' || l.status === 'sent' || l.status === 'replied') cityRow.readyOrSent++

        if (l.icpScore !== null && l.icpScore !== undefined) {
          icpScoreMap.set(l.icpScore, (icpScoreMap.get(l.icpScore) ?? 0) + 1)
        }

        if (l.contactEmail !== null) {
          const s = l.emailStatus ?? 'unknown'
          emailStatusMap.set(s, (emailStatusMap.get(s) ?? 0) + 1)
          const c = l.contactConfidence ?? 'unknown'
          confidenceMap.set(c, (confidenceMap.get(c) ?? 0) + 1)
        }
      }

      const byCategory = [...categoryMap.values()].sort((a, b) => b.total - a.total).slice(0, 10)
      const byCity = [...cityMap.values()].sort((a, b) => b.total - a.total).slice(0, 8)
      const icpDistribution: IcpDistributionShape[] = [...icpScoreMap.entries()]
        .map(([icpScore, count]) => ({ icpScore, count }))
        .sort((a, b) => a.icpScore - b.icpScore)
      const emailStatusBreakdown: EmailStatusBreakdownShape[] = [...emailStatusMap.entries()]
        .map(([status, count]) => ({ status, count }))
        .sort((a, b) => b.count - a.count)
      const confidenceBreakdown: ConfidenceBreakdownShape[] = [...confidenceMap.entries()]
        .map(([confidence, count]) => ({ confidence, count }))
        .sort((a, b) => b.count - a.count)

      const windowStart = datesWithin(30)[0]
      const dm = await db.dailyMetrics.findMany({
        where: { date: { gte: windowStart } },
        orderBy: { date: 'asc' },
        select: {
          date: true, leadsDiscovered: true, leadsExtracted: true,
          leadsJudgePassed: true, leadsEmailFound: true, leadsEmailValid: true,
          leadsIcpAb: true, leadsReady: true, emailsSent: true,
        },
      })
      const dailyTrend: DailyTrendShape[] = dm.map((r) => ({
        date: r.date,
        discovered: r.leadsDiscovered,
        extracted: r.leadsExtracted,
        judgePassed: r.leadsJudgePassed,
        emailFound: r.leadsEmailFound,
        emailValid: r.leadsEmailValid,
        icpReady: r.leadsIcpAb,
        ready: r.leadsReady,
        sent: r.emailsSent,
      }))

      return {
        stages, dropReasons, dailyTrend,
        byCategory, byCity,
        icpDistribution, emailStatusBreakdown, confidenceBreakdown,
      }
    },
  }),
)
