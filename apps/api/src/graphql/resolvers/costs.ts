import { prisma } from 'shared'
import { builder } from '../builder.js'
import { requireAuth } from '../guards.js'

type DB = typeof prisma

function last30Dates(): string[] {
  const out: string[] = []
  const now = new Date()
  for (let i = 30; i >= 0; i--) {
    out.push(new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10))
  }
  return out
}

type DailyCostShape = {
  date: string
  geminiCostUsd: number
  sonnetCostUsd: number
  haikuCostUsd: number
  mevCostUsd: number
  totalApiCostUsd: number
}

type MonthlyCostShape = {
  geminiCostUsd: number
  sonnetCostUsd: number
  haikuCostUsd: number
  mevCostUsd: number
  totalApiCostUsd: number
  emailsSent: number
  perEmailCost: number
}

type CostsPayloadShape = { daily: DailyCostShape[]; monthly: MonthlyCostShape }

const DailyCost = builder.objectRef<DailyCostShape>('DailyCost')
builder.objectType(DailyCost, {
  fields: (t) => ({
    date: t.exposeString('date'),
    geminiCostUsd: t.exposeFloat('geminiCostUsd'),
    sonnetCostUsd: t.exposeFloat('sonnetCostUsd'),
    haikuCostUsd: t.exposeFloat('haikuCostUsd'),
    mevCostUsd: t.exposeFloat('mevCostUsd'),
    totalApiCostUsd: t.exposeFloat('totalApiCostUsd'),
  }),
})

const MonthlyCost = builder.objectRef<MonthlyCostShape>('MonthlyCost')
builder.objectType(MonthlyCost, {
  fields: (t) => ({
    geminiCostUsd: t.exposeFloat('geminiCostUsd'),
    sonnetCostUsd: t.exposeFloat('sonnetCostUsd'),
    haikuCostUsd: t.exposeFloat('haikuCostUsd'),
    mevCostUsd: t.exposeFloat('mevCostUsd'),
    totalApiCostUsd: t.exposeFloat('totalApiCostUsd'),
    emailsSent: t.exposeInt('emailsSent'),
    perEmailCost: t.exposeFloat('perEmailCost'),
  }),
})

const CostsPayload = builder.objectRef<CostsPayloadShape>('CostsPayload')
builder.objectType(CostsPayload, {
  fields: (t) => ({
    daily: t.field({ type: [DailyCost], resolve: (p) => p.daily }),
    monthly: t.field({ type: MonthlyCost, resolve: (p) => p.monthly }),
  }),
})

builder.queryField('costs', (t) =>
  t.field({
    type: CostsPayload,
    resolve: async (_root, _args, ctx) => {
      requireAuth(ctx)
      const db = ctx.db as DB
      const windowStart = last30Dates()[0]
      const rows = await db.dailyMetrics.findMany({
        where: { date: { gte: windowStart } },
        orderBy: { date: 'asc' },
        select: {
          date: true,
          geminiCostUsd: true, sonnetCostUsd: true,
          haikuCostUsd: true, mevCostUsd: true,
          totalApiCostUsd: true, emailsSent: true,
        },
      })

      const daily: DailyCostShape[] = rows.map((r) => ({
        date: r.date,
        geminiCostUsd: Number(r.geminiCostUsd),
        sonnetCostUsd: Number(r.sonnetCostUsd),
        haikuCostUsd: Number(r.haikuCostUsd),
        mevCostUsd: Number(r.mevCostUsd),
        totalApiCostUsd: Number(r.totalApiCostUsd),
      }))

      const monthly: MonthlyCostShape = {
        geminiCostUsd: 0, sonnetCostUsd: 0, haikuCostUsd: 0,
        mevCostUsd: 0, totalApiCostUsd: 0, emailsSent: 0, perEmailCost: 0,
      }
      for (const r of rows) {
        monthly.geminiCostUsd += Number(r.geminiCostUsd)
        monthly.sonnetCostUsd += Number(r.sonnetCostUsd)
        monthly.haikuCostUsd += Number(r.haikuCostUsd)
        monthly.mevCostUsd += Number(r.mevCostUsd)
        monthly.totalApiCostUsd += Number(r.totalApiCostUsd)
        monthly.emailsSent += r.emailsSent
      }
      monthly.perEmailCost = monthly.emailsSent > 0
        ? Number((monthly.totalApiCostUsd / monthly.emailsSent).toFixed(4))
        : 0

      return { daily, monthly }
    },
  }),
)
