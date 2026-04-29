import { prisma } from 'shared'
import { builder } from '../builder.js'
import { requireAuth } from '../guards.js'

type DB = typeof prisma

type ErrorLogEntryShape = {
  id: number
  occurredAt: string
  source: string | null
  jobName: string | null
  errorType: string | null
  errorCode: string | null
  errorMessage: string | null
  stackTrace: string | null
  leadId: number | null
  emailId: number | null
  resolved: boolean
  resolvedAt: string | null
}

type ErrorsPayloadShape = {
  errors: ErrorLogEntryShape[]
  unresolvedCount: number
}

const ErrorLogEntry = builder.objectRef<ErrorLogEntryShape>('ErrorLogEntry')
builder.objectType(ErrorLogEntry, {
  fields: (t) => ({
    id: t.exposeInt('id'),
    occurredAt: t.exposeString('occurredAt'),
    source: t.string({ nullable: true, resolve: (e) => e.source }),
    jobName: t.string({ nullable: true, resolve: (e) => e.jobName }),
    errorType: t.string({ nullable: true, resolve: (e) => e.errorType }),
    errorCode: t.string({ nullable: true, resolve: (e) => e.errorCode }),
    errorMessage: t.string({ nullable: true, resolve: (e) => e.errorMessage }),
    stackTrace: t.string({ nullable: true, resolve: (e) => e.stackTrace }),
    leadId: t.int({ nullable: true, resolve: (e) => e.leadId }),
    emailId: t.int({ nullable: true, resolve: (e) => e.emailId }),
    resolved: t.exposeBoolean('resolved'),
    resolvedAt: t.string({ nullable: true, resolve: (e) => e.resolvedAt }),
  }),
})

const ErrorsPayload = builder.objectRef<ErrorsPayloadShape>('ErrorsPayload')
builder.objectType(ErrorsPayload, {
  fields: (t) => ({
    errors: t.field({ type: [ErrorLogEntry], resolve: (p) => p.errors }),
    unresolvedCount: t.exposeInt('unresolvedCount'),
  }),
})

type ErrorRow = Awaited<ReturnType<DB['errorLog']['findFirst']>>
function toErrorShape(e: NonNullable<ErrorRow>): ErrorLogEntryShape {
  return {
    id: e.id,
    occurredAt: e.occurredAt.toISOString(),
    source: e.source,
    jobName: e.jobName,
    errorType: e.errorType,
    errorCode: e.errorCode,
    errorMessage: e.errorMessage,
    stackTrace: e.stackTrace,
    leadId: e.leadId,
    emailId: e.emailId,
    resolved: e.resolved,
    resolvedAt: e.resolvedAt?.toISOString() ?? null,
  }
}

builder.queryField('errors', (t) =>
  t.field({
    type: ErrorsPayload,
    args: {
      source: t.arg.string({ required: false }),
      errorType: t.arg.string({ required: false }),
      resolved: t.arg.boolean({ required: false }),
      dateFrom: t.arg.string({ required: false }),
      dateTo: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      requireAuth(ctx)
      const db = ctx.db as DB

      const where: Record<string, unknown> = {}
      if (args.source) where.source = args.source
      if (args.errorType) where.errorType = args.errorType
      if (args.resolved !== null && args.resolved !== undefined) where.resolved = args.resolved
      const occurredAt: { gte?: Date; lte?: Date } = {}
      if (args.dateFrom) occurredAt.gte = new Date(args.dateFrom)
      if (args.dateTo) occurredAt.lte = new Date(args.dateTo)
      if (occurredAt.gte || occurredAt.lte) where.occurredAt = occurredAt

      const [rows, unresolvedCount] = await Promise.all([
        db.errorLog.findMany({ where, orderBy: { occurredAt: 'desc' }, take: 200 }),
        db.errorLog.count({ where: { resolved: false } }),
      ])

      return { errors: rows.map(toErrorShape), unresolvedCount }
    },
  }),
)

builder.mutationField('resolveError', (t) =>
  t.field({
    type: 'Boolean',
    args: { id: t.arg.int({ required: true }) },
    resolve: async (_root, { id }, ctx) => {
      requireAuth(ctx)
      const db = ctx.db as DB
      const err = await db.errorLog.findUnique({ where: { id }, select: { id: true } })
      if (!err) throw new Error('Error not found')
      await db.errorLog.update({
        where: { id },
        data: { resolved: true, resolvedAt: new Date() },
      })
      return true
    },
  }),
)
