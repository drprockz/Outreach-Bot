import { prisma } from 'shared'
import { builder } from '../builder.js'
import { requireAuth } from '../guards.js'

type DB = typeof prisma

type InboxHealthShape = {
  email: string
  lastSend: string | null
}

type HealthPayloadShape = {
  bounceRate: number
  unsubscribeRate: number
  domain: string
  blacklisted: boolean
  blacklistZonesJson: string | null
  postmasterReputation: string | null
  mailTesterScore: number | null
  mailTesterDate: string | null
  inbox1: InboxHealthShape
  inbox2: InboxHealthShape
  rejectListSize: number
}

const InboxHealth = builder.objectRef<InboxHealthShape>('InboxHealth')
builder.objectType(InboxHealth, {
  fields: (t) => ({
    email: t.exposeString('email'),
    lastSend: t.string({ nullable: true, resolve: (i) => i.lastSend }),
  }),
})

const HealthPayload = builder.objectRef<HealthPayloadShape>('HealthPayload')
builder.objectType(HealthPayload, {
  fields: (t) => ({
    bounceRate: t.exposeFloat('bounceRate'),
    unsubscribeRate: t.exposeFloat('unsubscribeRate'),
    domain: t.exposeString('domain'),
    blacklisted: t.exposeBoolean('blacklisted'),
    blacklistZonesJson: t.string({ nullable: true, resolve: (h) => h.blacklistZonesJson }),
    postmasterReputation: t.string({ nullable: true, resolve: (h) => h.postmasterReputation }),
    mailTesterScore: t.float({ nullable: true, resolve: (h) => h.mailTesterScore }),
    mailTesterDate: t.string({ nullable: true, resolve: (h) => h.mailTesterDate }),
    inbox1: t.field({ type: InboxHealth, resolve: (h) => h.inbox1 }),
    inbox2: t.field({ type: InboxHealth, resolve: (h) => h.inbox2 }),
    rejectListSize: t.exposeInt('rejectListSize'),
  }),
})

builder.queryField('health', (t) =>
  t.field({
    type: HealthPayload,
    resolve: async (_root, _args, ctx) => {
      requireAuth(ctx)
      const db = ctx.db as DB

      const date = new Date().toISOString().slice(0, 10)
      const todayMetrics = await db.dailyMetrics.findUnique({ where: { date } })
      const emailsSent = todayMetrics?.emailsSent ?? 0
      const bounces = todayMetrics?.emailsHardBounced ?? 0
      const bounceRate = emailsSent > 0 ? Number(((bounces / emailsSent) * 100).toFixed(2)) : 0

      const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000)
      const weekReplyRows = await db.reply.findMany({
        where: { receivedAt: { gte: sevenDaysAgo } },
        select: { category: true },
      })
      const weekTotal = weekReplyRows.length
      const weekUnsubs = weekReplyRows.filter((r) => r.category === 'unsubscribe').length
      const unsubRate = weekTotal > 0 ? Number(((weekUnsubs / weekTotal) * 100).toFixed(2)) : 0

      const inbox1Email = process.env.INBOX_1_USER ?? 'darshan@trysimpleinc.com'
      const inbox2Email = process.env.INBOX_2_USER ?? 'hello@trysimpleinc.com'

      const [lastSendInbox1, lastSendInbox2, rejectListSize, mailTester] = await Promise.all([
        db.email.findFirst({
          where: { inboxUsed: inbox1Email, status: 'sent' },
          orderBy: { sentAt: 'desc' },
          select: { sentAt: true },
        }),
        db.email.findFirst({
          where: { inboxUsed: inbox2Email, status: 'sent' },
          orderBy: { sentAt: 'desc' },
          select: { sentAt: true },
        }),
        db.rejectList.count(),
        db.dailyMetrics.findFirst({
          where: { mailTesterScore: { not: null } },
          orderBy: { date: 'desc' },
          select: { mailTesterScore: true, date: true },
        }),
      ])

      return {
        bounceRate,
        unsubscribeRate: unsubRate,
        domain: process.env.OUTREACH_DOMAIN ?? 'trysimpleinc.com',
        blacklisted: todayMetrics?.domainBlacklisted === true,
        blacklistZonesJson: todayMetrics?.blacklistZones !== null && todayMetrics?.blacklistZones !== undefined
          ? JSON.stringify(todayMetrics.blacklistZones)
          : null,
        postmasterReputation: todayMetrics?.postmasterReputation ?? null,
        mailTesterScore: mailTester?.mailTesterScore ?? null,
        mailTesterDate: mailTester?.date ?? null,
        inbox1: { email: inbox1Email, lastSend: lastSendInbox1?.sentAt?.toISOString() ?? null },
        inbox2: { email: inbox2Email, lastSend: lastSendInbox2?.sentAt?.toISOString() ?? null },
        rejectListSize,
      }
    },
  }),
)

builder.mutationField('setMailTesterScore', (t) =>
  t.field({
    type: 'Boolean',
    args: { score: t.arg.float({ required: true }) },
    resolve: async (_root, { score }, ctx) => {
      requireAuth(ctx)
      const db = ctx.db as DB
      const date = new Date().toISOString().slice(0, 10)
      await db.dailyMetrics.upsert({
        where: { date },
        create: { date, mailTesterScore: score },
        update: { mailTesterScore: score },
      })
      return true
    },
  }),
)
