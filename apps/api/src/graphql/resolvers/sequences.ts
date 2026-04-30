import { prisma } from 'shared'
import { builder } from '../builder.js'
import { requireAuth } from '../guards.js'

type DB = typeof prisma

type SequenceShape = {
  id: number
  leadId: number
  currentStep: number
  nextSendDate: string | null
  lastSentAt: string | null
  lastMessageId: string | null
  lastSubject: string | null
  status: string
  pausedReason: string | null
  updatedAt: string
  businessName: string | null
  contactName: string | null
  contactEmail: string | null
}

type SequenceAggregatesShape = {
  active: number
  paused: number
  completed: number
  replied: number
  unsubscribed: number
}

type SequencesPayloadShape = {
  sequences: SequenceShape[]
  aggregates: SequenceAggregatesShape
}

const Sequence = builder.objectRef<SequenceShape>('Sequence')
builder.objectType(Sequence, {
  fields: (t) => ({
    id: t.exposeInt('id'),
    leadId: t.exposeInt('leadId'),
    currentStep: t.exposeInt('currentStep'),
    nextSendDate: t.string({ nullable: true, resolve: (s) => s.nextSendDate }),
    lastSentAt: t.string({ nullable: true, resolve: (s) => s.lastSentAt }),
    lastMessageId: t.string({ nullable: true, resolve: (s) => s.lastMessageId }),
    lastSubject: t.string({ nullable: true, resolve: (s) => s.lastSubject }),
    status: t.exposeString('status'),
    pausedReason: t.string({ nullable: true, resolve: (s) => s.pausedReason }),
    updatedAt: t.exposeString('updatedAt'),
    businessName: t.string({ nullable: true, resolve: (s) => s.businessName }),
    contactName: t.string({ nullable: true, resolve: (s) => s.contactName }),
    contactEmail: t.string({ nullable: true, resolve: (s) => s.contactEmail }),
  }),
})

const SequenceAggregates = builder.objectRef<SequenceAggregatesShape>('SequenceAggregates')
builder.objectType(SequenceAggregates, {
  fields: (t) => ({
    active: t.exposeInt('active'),
    paused: t.exposeInt('paused'),
    completed: t.exposeInt('completed'),
    replied: t.exposeInt('replied'),
    unsubscribed: t.exposeInt('unsubscribed'),
  }),
})

const SequencesPayload = builder.objectRef<SequencesPayloadShape>('SequencesPayload')
builder.objectType(SequencesPayload, {
  fields: (t) => ({
    sequences: t.field({ type: [Sequence], resolve: (p) => p.sequences }),
    aggregates: t.field({ type: SequenceAggregates, resolve: (p) => p.aggregates }),
  }),
})

const STATUSES = ['active', 'paused', 'completed', 'replied', 'unsubscribed'] as const

builder.queryField('sequences', (t) =>
  t.field({
    type: SequencesPayload,
    resolve: async (_root, _args, ctx) => {
      requireAuth(ctx)
      const db = ctx.db as DB
      const rows = await db.sequenceState.findMany({
        include: { lead: { select: { businessName: true, contactName: true, contactEmail: true } } },
        orderBy: { updatedAt: 'desc' },
      })
      const counts = await db.sequenceState.groupBy({
        by: ['status'],
        _count: { _all: true },
      })
      const agg: SequenceAggregatesShape = {
        active: 0, paused: 0, completed: 0, replied: 0, unsubscribed: 0,
      }
      for (const c of counts) {
        if ((STATUSES as readonly string[]).includes(c.status)) {
          agg[c.status as keyof SequenceAggregatesShape] = c._count._all
        }
      }
      const sequences: SequenceShape[] = rows.map((s) => ({
        id: s.id,
        leadId: s.leadId,
        currentStep: s.currentStep,
        nextSendDate: s.nextSendDate ? s.nextSendDate.toISOString() : null,
        lastSentAt: s.lastSentAt ? s.lastSentAt.toISOString() : null,
        lastMessageId: s.lastMessageId,
        lastSubject: s.lastSubject,
        status: s.status,
        pausedReason: s.pausedReason,
        updatedAt: s.updatedAt.toISOString(),
        businessName: s.lead?.businessName ?? null,
        contactName: s.lead?.contactName ?? null,
        contactEmail: s.lead?.contactEmail ?? null,
      }))
      return { sequences, aggregates: agg }
    },
  }),
)
