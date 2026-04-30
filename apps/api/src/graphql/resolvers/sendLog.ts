import { prisma } from 'shared'
import { builder } from '../builder.js'
import { requireAuth } from '../guards.js'

type DB = typeof prisma

type SendLogEmailShape = {
  id: number
  leadId: number | null
  sequenceStep: number
  inboxUsed: string | null
  fromDomain: string | null
  fromName: string | null
  subject: string | null
  body: string | null
  wordCount: number | null
  hook: string | null
  containsLink: boolean
  isHtml: boolean
  isPlainText: boolean
  contentValid: boolean
  validationFailReason: string | null
  regenerated: boolean
  status: string
  sentAt: string | null
  smtpResponse: string | null
  smtpCode: number | null
  messageId: string | null
  sendDurationMs: number | null
  inReplyTo: string | null
  referencesHeader: string | null
  hookModel: string | null
  bodyModel: string | null
  hookCostUsd: number | null
  bodyCostUsd: number | null
  totalCostUsd: number | null
  createdAt: string
  businessName: string | null
  contactName: string | null
  contactEmail: string | null
}

type SendLogAggregatesShape = {
  totalSent: number
  hardBounces: number
  softBounces: number
  contentRejected: number
  avgDurationMs: number
  totalCost: number
}

type SendLogPayloadShape = {
  emails: SendLogEmailShape[]
  total: number
  page: number
  limit: number
  aggregates: SendLogAggregatesShape
}

const SendLogEmail = builder.objectRef<SendLogEmailShape>('SendLogEmail')
builder.objectType(SendLogEmail, {
  fields: (t) => ({
    id: t.exposeInt('id'),
    leadId: t.int({ nullable: true, resolve: (e) => e.leadId }),
    sequenceStep: t.exposeInt('sequenceStep'),
    inboxUsed: t.string({ nullable: true, resolve: (e) => e.inboxUsed }),
    fromDomain: t.string({ nullable: true, resolve: (e) => e.fromDomain }),
    fromName: t.string({ nullable: true, resolve: (e) => e.fromName }),
    subject: t.string({ nullable: true, resolve: (e) => e.subject }),
    body: t.string({ nullable: true, resolve: (e) => e.body }),
    wordCount: t.int({ nullable: true, resolve: (e) => e.wordCount }),
    hook: t.string({ nullable: true, resolve: (e) => e.hook }),
    containsLink: t.exposeBoolean('containsLink'),
    isHtml: t.exposeBoolean('isHtml'),
    isPlainText: t.exposeBoolean('isPlainText'),
    contentValid: t.exposeBoolean('contentValid'),
    validationFailReason: t.string({ nullable: true, resolve: (e) => e.validationFailReason }),
    regenerated: t.exposeBoolean('regenerated'),
    status: t.exposeString('status'),
    sentAt: t.string({ nullable: true, resolve: (e) => e.sentAt }),
    smtpResponse: t.string({ nullable: true, resolve: (e) => e.smtpResponse }),
    smtpCode: t.int({ nullable: true, resolve: (e) => e.smtpCode }),
    messageId: t.string({ nullable: true, resolve: (e) => e.messageId }),
    sendDurationMs: t.int({ nullable: true, resolve: (e) => e.sendDurationMs }),
    inReplyTo: t.string({ nullable: true, resolve: (e) => e.inReplyTo }),
    referencesHeader: t.string({ nullable: true, resolve: (e) => e.referencesHeader }),
    hookModel: t.string({ nullable: true, resolve: (e) => e.hookModel }),
    bodyModel: t.string({ nullable: true, resolve: (e) => e.bodyModel }),
    hookCostUsd: t.float({ nullable: true, resolve: (e) => e.hookCostUsd }),
    bodyCostUsd: t.float({ nullable: true, resolve: (e) => e.bodyCostUsd }),
    totalCostUsd: t.float({ nullable: true, resolve: (e) => e.totalCostUsd }),
    createdAt: t.exposeString('createdAt'),
    businessName: t.string({ nullable: true, resolve: (e) => e.businessName }),
    contactName: t.string({ nullable: true, resolve: (e) => e.contactName }),
    contactEmail: t.string({ nullable: true, resolve: (e) => e.contactEmail }),
  }),
})

const SendLogAggregates = builder.objectRef<SendLogAggregatesShape>('SendLogAggregates')
builder.objectType(SendLogAggregates, {
  fields: (t) => ({
    totalSent: t.exposeInt('totalSent'),
    hardBounces: t.exposeInt('hardBounces'),
    softBounces: t.exposeInt('softBounces'),
    contentRejected: t.exposeInt('contentRejected'),
    avgDurationMs: t.exposeFloat('avgDurationMs'),
    totalCost: t.exposeFloat('totalCost'),
  }),
})

const SendLogPayload = builder.objectRef<SendLogPayloadShape>('SendLogPayload')
builder.objectType(SendLogPayload, {
  fields: (t) => ({
    emails: t.field({ type: [SendLogEmail], resolve: (p) => p.emails }),
    total: t.exposeInt('total'),
    page: t.exposeInt('page'),
    limit: t.exposeInt('limit'),
    aggregates: t.field({ type: SendLogAggregates, resolve: (p) => p.aggregates }),
  }),
})

builder.queryField('sendLog', (t) =>
  t.field({
    type: SendLogPayload,
    args: {
      page: t.arg.int({ defaultValue: 1 }),
      limit: t.arg.int({ defaultValue: 20 }),
      status: t.arg.string({ required: false }),
      inbox: t.arg.string({ required: false }),
      step: t.arg.int({ required: false }),
      dateFrom: t.arg.string({ required: false }),
      dateTo: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      requireAuth(ctx)
      const db = ctx.db as DB

      const page = Math.max(1, args.page ?? 1)
      const limit = Math.min(100, Math.max(1, args.limit ?? 20))
      const offset = (page - 1) * limit

      const where: Record<string, unknown> = {}
      if (args.status) where.status = args.status
      if (args.inbox) where.inboxUsed = args.inbox
      if (args.step !== null && args.step !== undefined) where.sequenceStep = args.step
      const sentAt: { gte?: Date; lte?: Date } = {}
      if (args.dateFrom) sentAt.gte = new Date(args.dateFrom)
      if (args.dateTo) sentAt.lte = new Date(args.dateTo)
      if (sentAt.gte || sentAt.lte) where.sentAt = sentAt

      const [total, rows, allRows] = await Promise.all([
        db.email.count({ where }),
        db.email.findMany({
          where,
          orderBy: { id: 'desc' },
          take: limit,
          skip: offset,
          include: { lead: { select: { businessName: true, contactName: true, contactEmail: true } } },
        }),
        db.email.findMany({
          where,
          select: { status: true, sendDurationMs: true, totalCostUsd: true },
        }),
      ])

      const emails: SendLogEmailShape[] = rows.map((e) => ({
        id: e.id,
        leadId: e.leadId,
        sequenceStep: e.sequenceStep,
        inboxUsed: e.inboxUsed,
        fromDomain: e.fromDomain,
        fromName: e.fromName,
        subject: e.subject,
        body: e.body,
        wordCount: e.wordCount,
        hook: e.hook,
        containsLink: e.containsLink,
        isHtml: e.isHtml,
        isPlainText: e.isPlainText,
        contentValid: e.contentValid,
        validationFailReason: e.validationFailReason,
        regenerated: e.regenerated,
        status: e.status,
        sentAt: e.sentAt?.toISOString() ?? null,
        smtpResponse: e.smtpResponse,
        smtpCode: e.smtpCode,
        messageId: e.messageId,
        sendDurationMs: e.sendDurationMs,
        inReplyTo: e.inReplyTo,
        referencesHeader: e.referencesHeader,
        hookModel: e.hookModel,
        bodyModel: e.bodyModel,
        hookCostUsd: e.hookCostUsd !== null ? Number(e.hookCostUsd) : null,
        bodyCostUsd: e.bodyCostUsd !== null ? Number(e.bodyCostUsd) : null,
        totalCostUsd: e.totalCostUsd !== null ? Number(e.totalCostUsd) : null,
        createdAt: e.createdAt.toISOString(),
        businessName: e.lead?.businessName ?? null,
        contactName: e.lead?.contactName ?? null,
        contactEmail: e.lead?.contactEmail ?? null,
      }))

      let hardBounces = 0, softBounces = 0, contentRejected = 0
      let durSum = 0, durCount = 0, costSum = 0
      for (const e of allRows) {
        if (e.status === 'hard_bounce') hardBounces++
        if (e.status === 'soft_bounce') softBounces++
        if (e.status === 'content_rejected') contentRejected++
        if (e.sendDurationMs !== null) {
          durSum += e.sendDurationMs
          durCount++
        }
        if (e.totalCostUsd !== null) costSum += Number(e.totalCostUsd)
      }
      const aggregates: SendLogAggregatesShape = {
        totalSent: allRows.length,
        hardBounces,
        softBounces,
        contentRejected,
        avgDurationMs: durCount > 0 ? durSum / durCount : 0,
        totalCost: costSum,
      }

      return { emails, total, page, limit, aggregates }
    },
  }),
)
