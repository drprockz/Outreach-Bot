import { prisma } from 'shared'
import { builder } from '../builder.js'
import { requireAuth } from '../guards.js'

type DB = typeof prisma

type ReplyShape = {
  id: number
  leadId: number | null
  emailId: number | null
  inboxReceivedAt: string | null
  receivedAt: string
  category: string | null
  rawText: string | null
  classificationModel: string | null
  classificationCostUsd: number | null
  sentimentScore: number | null
  telegramAlerted: boolean
  requeueDate: string | null
  actionedAt: string | null
  actionTaken: string | null
  businessName: string | null
  contactName: string | null
  contactEmail: string | null
}

const Reply = builder.objectRef<ReplyShape>('Reply')
builder.objectType(Reply, {
  fields: (t) => ({
    id: t.exposeInt('id'),
    leadId: t.int({ nullable: true, resolve: (r) => r.leadId }),
    emailId: t.int({ nullable: true, resolve: (r) => r.emailId }),
    inboxReceivedAt: t.string({ nullable: true, resolve: (r) => r.inboxReceivedAt }),
    receivedAt: t.exposeString('receivedAt'),
    category: t.string({ nullable: true, resolve: (r) => r.category }),
    rawText: t.string({ nullable: true, resolve: (r) => r.rawText }),
    classificationModel: t.string({ nullable: true, resolve: (r) => r.classificationModel }),
    classificationCostUsd: t.float({ nullable: true, resolve: (r) => r.classificationCostUsd }),
    sentimentScore: t.int({ nullable: true, resolve: (r) => r.sentimentScore }),
    telegramAlerted: t.exposeBoolean('telegramAlerted'),
    requeueDate: t.string({ nullable: true, resolve: (r) => r.requeueDate }),
    actionedAt: t.string({ nullable: true, resolve: (r) => r.actionedAt }),
    actionTaken: t.string({ nullable: true, resolve: (r) => r.actionTaken }),
    businessName: t.string({ nullable: true, resolve: (r) => r.businessName }),
    contactName: t.string({ nullable: true, resolve: (r) => r.contactName }),
    contactEmail: t.string({ nullable: true, resolve: (r) => r.contactEmail }),
  }),
})

builder.queryField('replies', (t) =>
  t.field({
    type: [Reply],
    resolve: async (_root, _args, ctx) => {
      requireAuth(ctx)
      const db = ctx.db as DB
      const rows = await db.reply.findMany({
        include: { lead: { select: { businessName: true, contactName: true, contactEmail: true } } },
        orderBy: { receivedAt: 'desc' },
      })

      // Custom sort: hot/schedule replies first, then by receivedAt desc
      // (already ordered desc above so the secondary sort is a no-op).
      rows.sort((a, b) => {
        const aPri = a.category === 'hot' || a.category === 'schedule' ? 0 : 1
        const bPri = b.category === 'hot' || b.category === 'schedule' ? 0 : 1
        if (aPri !== bPri) return aPri - bPri
        return (b.receivedAt?.getTime() ?? 0) - (a.receivedAt?.getTime() ?? 0)
      })

      return rows.map((r): ReplyShape => ({
        id: r.id,
        leadId: r.leadId,
        emailId: r.emailId,
        inboxReceivedAt: r.inboxReceivedAt,
        receivedAt: r.receivedAt.toISOString(),
        category: r.category,
        rawText: r.rawText,
        classificationModel: r.classificationModel,
        classificationCostUsd: r.classificationCostUsd !== null
          ? Number(r.classificationCostUsd)
          : null,
        sentimentScore: r.sentimentScore,
        telegramAlerted: r.telegramAlerted,
        requeueDate: r.requeueDate?.toISOString() ?? null,
        actionedAt: r.actionedAt?.toISOString() ?? null,
        actionTaken: r.actionTaken,
        businessName: r.lead?.businessName ?? null,
        contactName: r.lead?.contactName ?? null,
        contactEmail: r.lead?.contactEmail ?? null,
      }))
    },
  }),
)

builder.mutationField('actionReply', (t) =>
  t.field({
    type: 'Boolean',
    args: {
      id: t.arg.int({ required: true }),
      action: t.arg.string({ required: true }),
    },
    resolve: async (_root, { id, action }, ctx) => {
      requireAuth(ctx)
      const db = ctx.db as DB
      const reply = await db.reply.findUnique({ where: { id }, select: { id: true } })
      if (!reply) throw new Error('Reply not found')
      await db.reply.update({
        where: { id },
        data: { actionedAt: new Date(), actionTaken: action },
      })
      return true
    },
  }),
)

builder.mutationField('rejectReply', (t) =>
  t.field({
    type: 'Boolean',
    args: { id: t.arg.int({ required: true }) },
    resolve: async (_root, { id }, ctx) => {
      requireAuth(ctx)
      const db = ctx.db as DB

      const reply = await db.reply.findUnique({
        where: { id },
        select: { leadId: true, lead: { select: { contactEmail: true } } },
      })
      if (!reply) throw new Error('Reply not found')

      const email = reply.lead?.contactEmail
      if (email) {
        const domain = email.split('@')[1] ?? null
        await db.rejectList.upsert({
          where: { email },
          create: { email, domain, reason: 'manual' },
          update: {},
        })
      }

      if (reply.leadId) {
        await db.lead.update({ where: { id: reply.leadId }, data: { status: 'unsubscribed' } })
        await db.sequenceState.updateMany({
          where: { leadId: reply.leadId },
          data: { status: 'unsubscribed', updatedAt: new Date() },
        })
      }

      return true
    },
  }),
)
