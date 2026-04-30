import { prisma } from 'shared'
import { builder } from '../builder.js'
import { requireAuth } from '../guards.js'

type DB = typeof prisma

interface EngineDef {
  name: string
  schedule: string
  enabledKey: string | null
}

// All engines known to the dashboard. `enabledKey` is the config KV flag
// consulted by the Status tab; engines without a flag (healthCheck, dailyReport)
// are always "on" from the UI's perspective.
const ENGINES: EngineDef[] = [
  { name: 'findLeads',     schedule: '0 9 * * 1-6',  enabledKey: 'find_leads_enabled' },
  { name: 'sendEmails',    schedule: '30 9 * * 1-6', enabledKey: 'send_emails_enabled' },
  { name: 'checkReplies',  schedule: 'dynamic',      enabledKey: 'check_replies_enabled' },
  { name: 'sendFollowups', schedule: '0 18 * * 1-6', enabledKey: 'send_followups_enabled' },
  { name: 'healthCheck',   schedule: '0 2 * * 0',    enabledKey: null },
  { name: 'dailyReport',   schedule: '30 20 * * *',  enabledKey: null },
]

type EngineLastRunShape = {
  status: string | null
  startedAt: string | null
  durationMs: number | null
  primaryCount: number | null
}

type EngineSummaryShape = {
  name: string
  enabled: boolean
  schedule: string
  costToday: number
  lastRun: EngineLastRunShape | null
}

const EngineLastRun = builder.objectRef<EngineLastRunShape>('EngineLastRun')
builder.objectType(EngineLastRun, {
  fields: (t) => ({
    status: t.string({ nullable: true, resolve: (l) => l.status }),
    startedAt: t.string({ nullable: true, resolve: (l) => l.startedAt }),
    durationMs: t.int({ nullable: true, resolve: (l) => l.durationMs }),
    primaryCount: t.int({ nullable: true, resolve: (l) => l.primaryCount }),
  }),
})

const EngineSummary = builder.objectRef<EngineSummaryShape>('EngineSummary')
builder.objectType(EngineSummary, {
  fields: (t) => ({
    name: t.exposeString('name'),
    enabled: t.exposeBoolean('enabled'),
    schedule: t.exposeString('schedule'),
    costToday: t.exposeFloat('costToday'),
    lastRun: t.field({ type: EngineLastRun, nullable: true, resolve: (e) => e.lastRun }),
  }),
})

builder.queryField('engines', (t) =>
  t.field({
    type: [EngineSummary],
    resolve: async (_root, _args, ctx) => {
      requireAuth(ctx)
      const db = ctx.db as DB

      const cfgRows = await db.config.findMany()
      const cfg = Object.fromEntries(cfgRows.map((r) => [r.key, r.value]))

      const todayStart = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z')

      return Promise.all(ENGINES.map(async (def): Promise<EngineSummaryShape> => {
        const [last, todaysCost] = await Promise.all([
          db.cronLog.findFirst({
            where: { jobName: def.name },
            orderBy: { startedAt: 'desc' },
            select: {
              status: true, startedAt: true, durationMs: true,
              recordsProcessed: true,
            },
          }),
          db.cronLog.aggregate({
            where: { jobName: def.name, startedAt: { gte: todayStart } },
            _sum: { costUsd: true },
          }),
        ])
        return {
          name: def.name,
          enabled: def.enabledKey ? cfg[def.enabledKey] !== '0' : true,
          schedule: def.schedule,
          costToday: Number(todaysCost._sum.costUsd ?? 0),
          lastRun: last
            ? {
                status: last.status,
                startedAt: last.startedAt?.toISOString() ?? null,
                durationMs: last.durationMs,
                primaryCount: last.recordsProcessed,
              }
            : null,
        }
      }))
    },
  }),
)
