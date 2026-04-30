import { prisma } from 'shared'
import { builder } from '../builder.js'
import { requireAuth } from '../guards.js'

type DB = typeof prisma

type JobScheduleEntry = { name: string; time: string; pass?: number; day?: string }

const JOB_SCHEDULE: JobScheduleEntry[] = [
  { name: 'findLeads', time: '09:00' },
  { name: 'sendEmails', time: '09:30' },
  { name: 'checkReplies', time: '14:00', pass: 1 },
  { name: 'checkReplies', time: '16:00', pass: 2 },
  { name: 'sendFollowups', time: '18:00' },
  { name: 'checkReplies', time: '20:00', pass: 3 },
  { name: 'dailyReport', time: '20:30' },
  { name: 'healthCheck', time: '02:00', day: 'sunday' },
  { name: 'backup', time: '02:00' },
]

type CronLogShape = {
  id: number
  jobName: string | null
  scheduledAt: string | null
  startedAt: string | null
  completedAt: string | null
  durationMs: number | null
  status: string | null
  errorMessage: string | null
  recordsProcessed: number | null
  recordsSkipped: number | null
  costUsd: number | null
  notes: string | null
}

type CronJobShape = {
  id: number
  name: string
  time: string
  pass: number | null
  day: string | null
  log: CronLogShape | null
  status: string
}

type CronStatusPayloadShape = { jobs: CronJobShape[]; date: string }

const CronLogObj = builder.objectRef<CronLogShape>('CronLogEntry')
builder.objectType(CronLogObj, {
  fields: (t) => ({
    id: t.exposeInt('id'),
    jobName: t.string({ nullable: true, resolve: (l) => l.jobName }),
    scheduledAt: t.string({ nullable: true, resolve: (l) => l.scheduledAt }),
    startedAt: t.string({ nullable: true, resolve: (l) => l.startedAt }),
    completedAt: t.string({ nullable: true, resolve: (l) => l.completedAt }),
    durationMs: t.int({ nullable: true, resolve: (l) => l.durationMs }),
    status: t.string({ nullable: true, resolve: (l) => l.status }),
    errorMessage: t.string({ nullable: true, resolve: (l) => l.errorMessage }),
    recordsProcessed: t.int({ nullable: true, resolve: (l) => l.recordsProcessed }),
    recordsSkipped: t.int({ nullable: true, resolve: (l) => l.recordsSkipped }),
    costUsd: t.float({ nullable: true, resolve: (l) => l.costUsd }),
    notes: t.string({ nullable: true, resolve: (l) => l.notes }),
  }),
})

const CronJob = builder.objectRef<CronJobShape>('CronJob')
builder.objectType(CronJob, {
  fields: (t) => ({
    id: t.exposeInt('id'),
    name: t.exposeString('name'),
    time: t.exposeString('time'),
    pass: t.int({ nullable: true, resolve: (j) => j.pass }),
    day: t.string({ nullable: true, resolve: (j) => j.day }),
    log: t.field({ type: CronLogObj, nullable: true, resolve: (j) => j.log }),
    status: t.exposeString('status'),
  }),
})

const CronStatusPayload = builder.objectRef<CronStatusPayloadShape>('CronStatusPayload')
builder.objectType(CronStatusPayload, {
  fields: (t) => ({
    jobs: t.field({ type: [CronJob], resolve: (p) => p.jobs }),
    date: t.exposeString('date'),
  }),
})

type CronRow = Awaited<ReturnType<DB['cronLog']['findFirst']>>
function toCronLogShape(l: NonNullable<CronRow>): CronLogShape {
  return {
    id: l.id,
    jobName: l.jobName,
    scheduledAt: l.scheduledAt?.toISOString() ?? null,
    startedAt: l.startedAt?.toISOString() ?? null,
    completedAt: l.completedAt?.toISOString() ?? null,
    durationMs: l.durationMs,
    status: l.status,
    errorMessage: l.errorMessage,
    recordsProcessed: l.recordsProcessed,
    recordsSkipped: l.recordsSkipped,
    costUsd: l.costUsd !== null && l.costUsd !== undefined ? Number(l.costUsd) : null,
    notes: l.notes,
  }
}

builder.queryField('cronStatus', (t) =>
  t.field({
    type: CronStatusPayload,
    resolve: async (_root, _args, ctx) => {
      requireAuth(ctx)
      const db = ctx.db as DB

      const date = new Date().toISOString().slice(0, 10)
      const dayStart = new Date(`${date}T00:00:00.000Z`)
      const dayEnd = new Date(dayStart.getTime() + 86_400_000)

      const todayLogs = await db.cronLog.findMany({
        where: { startedAt: { gte: dayStart, lt: dayEnd } },
        orderBy: { startedAt: 'asc' },
      })

      const now = new Date()
      const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000)
      const currentIstTime = ist.getUTCHours() * 60 + ist.getUTCMinutes()
      const istDay = ist.getUTCDay()

      const jobs: CronJobShape[] = JOB_SCHEDULE.map((sched, idx) => {
        const matching = todayLogs.filter((l) => l.jobName === sched.name)
        const log = sched.name === 'checkReplies' && sched.pass
          ? matching[sched.pass - 1]
          : matching[0]

        let status = log ? (log.status ?? 'unknown') : 'not_triggered'
        if (!log) {
          const [schedHour, schedMin] = sched.time.split(':').map(Number)
          const schedTime = schedHour * 60 + schedMin
          if (sched.day === 'sunday' && istDay !== 0) {
            status = 'pending'
          } else if (currentIstTime < schedTime + 30) {
            status = 'pending'
          }
        }

        return {
          id: idx,
          name: sched.name,
          time: sched.time,
          pass: sched.pass ?? null,
          day: sched.day ?? null,
          log: log ? toCronLogShape(log) : null,
          status,
        }
      })

      return { jobs, date }
    },
  }),
)

builder.queryField('cronJobHistory', (t) =>
  t.field({
    type: [CronLogObj],
    args: { jobName: t.arg.string({ required: true }) },
    resolve: async (_root, { jobName }, ctx) => {
      requireAuth(ctx)
      const db = ctx.db as DB
      const history = await db.cronLog.findMany({
        where: { jobName },
        orderBy: { startedAt: 'desc' },
        take: 30,
      })
      return history.map(toCronLogShape)
    },
  }),
)
