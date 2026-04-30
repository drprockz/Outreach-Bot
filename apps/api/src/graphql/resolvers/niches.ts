import { prisma } from 'shared'
import { builder } from '../builder.js'
import { requireAuth } from '../guards.js'

type DB = typeof prisma

builder.prismaObject('Niche', {
  fields: (t) => ({
    id: t.exposeInt('id'),
    label: t.exposeString('label'),
    query: t.exposeString('query'),
    dayOfWeek: t.exposeInt('dayOfWeek', { nullable: true }),
    enabled: t.exposeBoolean('enabled'),
    sortOrder: t.exposeInt('sortOrder'),
    createdAt: t.string({ resolve: (n) => n.createdAt.toISOString() }),
  }),
})

builder.queryField('niches', (t) =>
  t.prismaField({
    type: ['Niche'],
    resolve: async (query, _root, _args, ctx) => {
      requireAuth(ctx)
      const db = ctx.db as DB
      return db.niche.findMany({
        ...query,
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      })
    },
  }),
)

function validateLabelQuery(label: string | null | undefined, query: string | null | undefined) {
  if (!label || !query) {
    const field = !label ? 'label' : 'query'
    throw new Error(`label and query are required (field: ${field})`)
  }
  if (query.length < 10) throw new Error('query must be at least 10 characters (field: query)')
}

builder.mutationField('createNiche', (t) =>
  t.prismaField({
    type: 'Niche',
    args: {
      label: t.arg.string({ required: true }),
      query: t.arg.string({ required: true }),
      dayOfWeek: t.arg.int({ required: false }),
      enabled: t.arg.boolean({ defaultValue: true }),
    },
    resolve: async (query, _root, args, ctx) => {
      requireAuth(ctx)
      validateLabelQuery(args.label, args.query)
      const db = ctx.db as DB
      return db.$transaction(async (tx) => {
        const agg = await tx.niche.aggregate({ _max: { sortOrder: true } })
        const maxOrder = agg._max.sortOrder ?? -1
        if (args.dayOfWeek !== null && args.dayOfWeek !== undefined) {
          await tx.niche.updateMany({
            where: { dayOfWeek: args.dayOfWeek },
            data: { dayOfWeek: null },
          })
        }
        return tx.niche.create({
          ...query,
          data: {
            label: args.label,
            query: args.query,
            dayOfWeek: args.dayOfWeek ?? null,
            enabled: args.enabled ?? true,
            sortOrder: maxOrder + 1,
          },
        })
      })
    },
  }),
)

builder.mutationField('updateNiche', (t) =>
  t.prismaField({
    type: 'Niche',
    args: {
      id: t.arg.int({ required: true }),
      label: t.arg.string({ required: true }),
      query: t.arg.string({ required: true }),
      dayOfWeek: t.arg.int({ required: false }),
      enabled: t.arg.boolean({ defaultValue: true }),
      sortOrder: t.arg.int({ required: false }),
    },
    resolve: async (query, _root, args, ctx) => {
      requireAuth(ctx)
      validateLabelQuery(args.label, args.query)
      const db = ctx.db as DB
      const existing = await db.niche.findUnique({ where: { id: args.id } })
      if (!existing) throw new Error('Niche not found')
      return db.$transaction(async (tx) => {
        if (args.dayOfWeek !== null && args.dayOfWeek !== undefined) {
          await tx.niche.updateMany({
            where: { dayOfWeek: args.dayOfWeek, id: { not: args.id } },
            data: { dayOfWeek: null },
          })
        }
        return tx.niche.update({
          ...query,
          where: { id: args.id },
          data: {
            label: args.label,
            query: args.query,
            dayOfWeek: args.dayOfWeek ?? null,
            enabled: args.enabled ?? true,
            sortOrder: args.sortOrder ?? existing.sortOrder,
          },
        })
      })
    },
  }),
)

builder.mutationField('deleteNiche', (t) =>
  t.field({
    type: 'Boolean',
    args: { id: t.arg.int({ required: true }) },
    resolve: async (_root, { id }, ctx) => {
      requireAuth(ctx)
      const db = ctx.db as DB
      const existing = await db.niche.findUnique({ where: { id } })
      if (!existing) throw new Error('Niche not found')
      await db.niche.delete({ where: { id } })
      return true
    },
  }),
)
