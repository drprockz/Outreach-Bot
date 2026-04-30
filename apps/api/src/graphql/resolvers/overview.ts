import { prisma } from 'shared'
import { builder } from '../builder.js'
import { requireAuth } from '../guards.js'

type DB = typeof prisma

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

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

// ─── Daily metrics view (today) ─────────────────────────────────────────────

type DailyMetricsViewShape = {
  id: number | null
  date: string | null
  leadsDiscovered: number
  leadsExtracted: number
  leadsJudgePassed: number
  leadsEmailFound: number
  leadsEmailValid: number
  leadsIcpReady: number
  leadsReady: number
  leadsDisqualified: number
  emailsAttempted: number
  emailsSent: number
  emailsHardBounced: number
  emailsSoftBounced: number
  emailsContentRejected: number
  sentInbox1: number
  sentInbox2: number
  repliesTotal: number
  repliesHot: number
  repliesSchedule: number
  repliesSoftNo: number
  repliesUnsubscribe: number
  repliesOoo: number
  repliesOther: number
  bounceRate: number | null
  replyRate: number | null
  unsubscribeRate: number | null
  geminiCostUsd: number
  sonnetCostUsd: number
  haikuCostUsd: number
  mevCostUsd: number
  totalApiCostUsd: number
  totalApiCostInr: number
  domainBlacklisted: boolean
  mailTesterScore: number | null
  postmasterReputation: string | null
  icpParseErrors: number
  followupsSent: number
  createdAt: string | null
}

const DailyMetricsView = builder.objectRef<DailyMetricsViewShape>('DailyMetricsView')
builder.objectType(DailyMetricsView, {
  fields: (t) => ({
    id: t.int({ nullable: true, resolve: (m) => m.id }),
    date: t.string({ nullable: true, resolve: (m) => m.date }),
    leadsDiscovered: t.exposeInt('leadsDiscovered'),
    leadsExtracted: t.exposeInt('leadsExtracted'),
    leadsJudgePassed: t.exposeInt('leadsJudgePassed'),
    leadsEmailFound: t.exposeInt('leadsEmailFound'),
    leadsEmailValid: t.exposeInt('leadsEmailValid'),
    leadsIcpReady: t.exposeInt('leadsIcpReady'),
    leadsReady: t.exposeInt('leadsReady'),
    leadsDisqualified: t.exposeInt('leadsDisqualified'),
    emailsAttempted: t.exposeInt('emailsAttempted'),
    emailsSent: t.exposeInt('emailsSent'),
    emailsHardBounced: t.exposeInt('emailsHardBounced'),
    emailsSoftBounced: t.exposeInt('emailsSoftBounced'),
    emailsContentRejected: t.exposeInt('emailsContentRejected'),
    sentInbox1: t.exposeInt('sentInbox1'),
    sentInbox2: t.exposeInt('sentInbox2'),
    repliesTotal: t.exposeInt('repliesTotal'),
    repliesHot: t.exposeInt('repliesHot'),
    repliesSchedule: t.exposeInt('repliesSchedule'),
    repliesSoftNo: t.exposeInt('repliesSoftNo'),
    repliesUnsubscribe: t.exposeInt('repliesUnsubscribe'),
    repliesOoo: t.exposeInt('repliesOoo'),
    repliesOther: t.exposeInt('repliesOther'),
    bounceRate: t.float({ nullable: true, resolve: (m) => m.bounceRate }),
    replyRate: t.float({ nullable: true, resolve: (m) => m.replyRate }),
    unsubscribeRate: t.float({ nullable: true, resolve: (m) => m.unsubscribeRate }),
    geminiCostUsd: t.float({ resolve: (m) => m.geminiCostUsd }),
    sonnetCostUsd: t.float({ resolve: (m) => m.sonnetCostUsd }),
    haikuCostUsd: t.float({ resolve: (m) => m.haikuCostUsd }),
    mevCostUsd: t.float({ resolve: (m) => m.mevCostUsd }),
    totalApiCostUsd: t.float({ resolve: (m) => m.totalApiCostUsd }),
    totalApiCostInr: t.float({ resolve: (m) => m.totalApiCostInr }),
    domainBlacklisted: t.exposeBoolean('domainBlacklisted'),
    mailTesterScore: t.float({ nullable: true, resolve: (m) => m.mailTesterScore }),
    postmasterReputation: t.string({ nullable: true, resolve: (m) => m.postmasterReputation }),
    icpParseErrors: t.exposeInt('icpParseErrors'),
    followupsSent: t.exposeInt('followupsSent'),
    createdAt: t.string({ nullable: true, resolve: (m) => m.createdAt }),
  }),
})

type DailyMetricsRow = NonNullable<Awaited<ReturnType<DB['dailyMetrics']['findUnique']>>>

function dailyMetricsToView(m: DailyMetricsRow | null): DailyMetricsViewShape {
  if (!m) {
    return {
      id: null, date: null,
      leadsDiscovered: 0, leadsExtracted: 0, leadsJudgePassed: 0,
      leadsEmailFound: 0, leadsEmailValid: 0, leadsIcpReady: 0,
      leadsReady: 0, leadsDisqualified: 0,
      emailsAttempted: 0, emailsSent: 0, emailsHardBounced: 0,
      emailsSoftBounced: 0, emailsContentRejected: 0,
      sentInbox1: 0, sentInbox2: 0,
      repliesTotal: 0, repliesHot: 0, repliesSchedule: 0,
      repliesSoftNo: 0, repliesUnsubscribe: 0, repliesOoo: 0, repliesOther: 0,
      bounceRate: null, replyRate: null, unsubscribeRate: null,
      geminiCostUsd: 0, sonnetCostUsd: 0, haikuCostUsd: 0,
      mevCostUsd: 0, totalApiCostUsd: 0, totalApiCostInr: 0,
      domainBlacklisted: false, mailTesterScore: null, postmasterReputation: null,
      icpParseErrors: 0, followupsSent: 0,
      createdAt: null,
    }
  }
  return {
    id: m.id, date: m.date,
    leadsDiscovered: m.leadsDiscovered,
    leadsExtracted: m.leadsExtracted,
    leadsJudgePassed: m.leadsJudgePassed,
    leadsEmailFound: m.leadsEmailFound,
    leadsEmailValid: m.leadsEmailValid,
    leadsIcpReady: m.leadsIcpAb,
    leadsReady: m.leadsReady,
    leadsDisqualified: m.leadsDisqualified,
    emailsAttempted: m.emailsAttempted,
    emailsSent: m.emailsSent,
    emailsHardBounced: m.emailsHardBounced,
    emailsSoftBounced: m.emailsSoftBounced,
    emailsContentRejected: m.emailsContentRejected,
    sentInbox1: m.sentInbox1,
    sentInbox2: m.sentInbox2,
    repliesTotal: m.repliesTotal,
    repliesHot: m.repliesHot,
    repliesSchedule: m.repliesSchedule,
    repliesSoftNo: m.repliesSoftNo,
    repliesUnsubscribe: m.repliesUnsubscribe,
    repliesOoo: m.repliesOoo,
    repliesOther: m.repliesOther,
    bounceRate: m.bounceRate,
    replyRate: m.replyRate,
    unsubscribeRate: m.unsubscribeRate,
    geminiCostUsd: Number(m.geminiCostUsd),
    sonnetCostUsd: Number(m.sonnetCostUsd),
    haikuCostUsd: Number(m.haikuCostUsd),
    mevCostUsd: Number(m.mevCostUsd),
    totalApiCostUsd: Number(m.totalApiCostUsd),
    totalApiCostInr: Number(m.totalApiCostInr),
    domainBlacklisted: m.domainBlacklisted,
    mailTesterScore: m.mailTesterScore,
    postmasterReputation: m.postmasterReputation,
    icpParseErrors: m.icpParseErrors,
    followupsSent: m.followupsSent,
    createdAt: m.createdAt.toISOString(),
  }
}

// ─── Window aggregates ──────────────────────────────────────────────────────

type WindowAggregateShape = {
  leadsDiscovered: number
  emailsSent: number
  emailsHardBounced: number
  repliesTotal: number
  repliesHot: number
  totalApiCostUsd: number
}

const WindowAggregate = builder.objectRef<WindowAggregateShape>('WindowAggregate')
builder.objectType(WindowAggregate, {
  fields: (t) => ({
    leadsDiscovered: t.exposeInt('leadsDiscovered'),
    emailsSent: t.exposeInt('emailsSent'),
    emailsHardBounced: t.exposeInt('emailsHardBounced'),
    repliesTotal: t.exposeInt('repliesTotal'),
    repliesHot: t.exposeInt('repliesHot'),
    totalApiCostUsd: t.float({ resolve: (w) => w.totalApiCostUsd }),
  }),
})

async function sumWindow(db: DB, nDays: number): Promise<WindowAggregateShape> {
  const windowStart = datesWithin(nDays)[0]
  const rows = await db.dailyMetrics.findMany({
    where: { date: { gte: windowStart } },
    select: {
      leadsDiscovered: true, emailsSent: true, emailsHardBounced: true,
      repliesTotal: true, repliesHot: true, totalApiCostUsd: true,
    },
  })
  const out: WindowAggregateShape = {
    leadsDiscovered: 0, emailsSent: 0, emailsHardBounced: 0,
    repliesTotal: 0, repliesHot: 0, totalApiCostUsd: 0,
  }
  for (const r of rows) {
    out.leadsDiscovered += r.leadsDiscovered
    out.emailsSent += r.emailsSent
    out.emailsHardBounced += r.emailsHardBounced
    out.repliesTotal += r.repliesTotal
    out.repliesHot += r.repliesHot
    out.totalApiCostUsd += Number(r.totalApiCostUsd)
  }
  return out
}

// ─── Top-level shapes ───────────────────────────────────────────────────────

type OverviewMetricsShape = {
  today: DailyMetricsViewShape
  week: WindowAggregateShape
  month: WindowAggregateShape
  activeSequences: number
  replyRate7d: number
  bounceRateToday: number
}

type OverviewFunnelShape = {
  total: number; extracted: number; judged: number
  emailFound: number; emailValid: number; icpReady: number
  sent: number; replied: number
}

type SendActivityShape = { date: string; emailsSent: number }

type OverviewPayloadShape = {
  metrics: OverviewMetricsShape
  funnel: OverviewFunnelShape
  sendActivity: SendActivityShape[]
}

const OverviewMetrics = builder.objectRef<OverviewMetricsShape>('OverviewMetrics')
builder.objectType(OverviewMetrics, {
  fields: (t) => ({
    today: t.field({ type: DailyMetricsView, resolve: (o) => o.today }),
    week: t.field({ type: WindowAggregate, resolve: (o) => o.week }),
    month: t.field({ type: WindowAggregate, resolve: (o) => o.month }),
    activeSequences: t.exposeInt('activeSequences'),
    replyRate7d: t.exposeFloat('replyRate7d'),
    bounceRateToday: t.exposeFloat('bounceRateToday'),
  }),
})

const OverviewFunnel = builder.objectRef<OverviewFunnelShape>('OverviewFunnel')
builder.objectType(OverviewFunnel, {
  fields: (t) => ({
    total: t.exposeInt('total'),
    extracted: t.exposeInt('extracted'),
    judged: t.exposeInt('judged'),
    emailFound: t.exposeInt('emailFound'),
    emailValid: t.exposeInt('emailValid'),
    icpReady: t.exposeInt('icpReady'),
    sent: t.exposeInt('sent'),
    replied: t.exposeInt('replied'),
  }),
})

const SendActivity = builder.objectRef<SendActivityShape>('SendActivity')
builder.objectType(SendActivity, {
  fields: (t) => ({
    date: t.exposeString('date'),
    emailsSent: t.exposeInt('emailsSent'),
  }),
})

const OverviewPayload = builder.objectRef<OverviewPayloadShape>('OverviewPayload')
builder.objectType(OverviewPayload, {
  fields: (t) => ({
    metrics: t.field({ type: OverviewMetrics, resolve: (o) => o.metrics }),
    funnel: t.field({ type: OverviewFunnel, resolve: (o) => o.funnel }),
    sendActivity: t.field({ type: [SendActivity], resolve: (o) => o.sendActivity }),
  }),
})

builder.queryField('overview', (t) =>
  t.field({
    type: OverviewPayload,
    resolve: async (_root, _args, ctx) => {
      requireAuth(ctx)
      const db = ctx.db as DB

      const d = today()
      const todayRow = await db.dailyMetrics.findUnique({ where: { date: d } })
      const todayMetrics = dailyMetricsToView(todayRow)

      const [week, month, threshB, leads, activeSequences] = await Promise.all([
        sumWindow(db, 7),
        sumWindow(db, 30),
        getConfigInt(db, 'icp_threshold_b', 40),
        db.lead.findMany({
          select: {
            status: true, websiteQualityScore: true, contactEmail: true,
            emailStatus: true, icpScore: true,
          },
        }),
        db.sequenceState.count({ where: { status: 'active' } }),
      ])

      const funnel: OverviewFunnelShape = {
        total: leads.length,
        extracted: 0, judged: 0,
        emailFound: 0, emailValid: 0, icpReady: 0,
        sent: 0, replied: 0,
      }
      for (const l of leads) {
        if (l.status !== 'discovered' && l.status !== 'extraction_failed') funnel.extracted++
        if (l.websiteQualityScore !== null) funnel.judged++
        if (l.contactEmail !== null) funnel.emailFound++
        if (l.emailStatus === 'valid' || l.emailStatus === 'catch-all') funnel.emailValid++
        if (Number.isFinite(l.icpScore) && (l.icpScore as number) >= threshB) funnel.icpReady++
        if (l.status === 'sent' || l.status === 'replied') funnel.sent++
        if (l.status === 'replied') funnel.replied++
      }

      const replyRate7d = week.emailsSent > 0
        ? Number(((week.repliesTotal / week.emailsSent) * 100).toFixed(1))
        : 0
      const bounceRateToday = todayMetrics.emailsSent > 0
        ? Number(((todayMetrics.emailsHardBounced / todayMetrics.emailsSent) * 100).toFixed(1))
        : 0

      const windowStart = datesWithin(90)[0]
      const sendRows = await db.dailyMetrics.findMany({
        where: { date: { gte: windowStart } },
        orderBy: { date: 'asc' },
        select: { date: true, emailsSent: true },
      })

      return {
        metrics: { today: todayMetrics, week, month, activeSequences, replyRate7d, bounceRateToday },
        funnel,
        sendActivity: sendRows.map((r) => ({ date: r.date, emailsSent: r.emailsSent })),
      }
    },
  }),
)
