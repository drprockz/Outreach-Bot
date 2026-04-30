import { prisma } from 'shared'
import { builder } from '../builder.js'
import { requireAuth } from '../guards.js'

type DB = typeof prisma

builder.prismaObject('SavedView', {
  fields: (t) => ({
    id: t.exposeInt('id'),
    name: t.exposeString('name'),
    // filtersJson is a Prisma Json field — surface as a JSON-encoded string.
    filtersJson: t.string({ resolve: (v) => JSON.stringify(v.filtersJson) }),
    sort: t.exposeString('sort', { nullable: true }),
    updatedAt: t.string({ resolve: (v) => v.updatedAt.toISOString() }),
  }),
})

builder.queryField('savedViews', (t) =>
  t.prismaField({
    type: ['SavedView'],
    resolve: async (query, _root, _args, ctx) => {
      requireAuth(ctx)
      const db = ctx.db as DB
      return db.savedView.findMany({
        ...query,
        orderBy: { updatedAt: 'desc' },
      })
    },
  }),
)

function parseFilters(json: string): unknown {
  try {
    return JSON.parse(json)
  } catch {
    throw new Error('filtersJson must be valid JSON')
  }
}

builder.mutationField('createSavedView', (t) =>
  t.prismaField({
    type: 'SavedView',
    args: {
      name: t.arg.string({ required: true }),
      filtersJson: t.arg.string({ required: true }),
      sort: t.arg.string({ required: false }),
    },
    resolve: async (query, _root, args, ctx) => {
      requireAuth(ctx)
      const filters = parseFilters(args.filtersJson)
      const db = ctx.db as DB
      return db.savedView.create({
        ...query,
        data: {
          name: args.name,
          filtersJson: filters as Parameters<DB['savedView']['create']>[0]['data']['filtersJson'],
          sort: args.sort ?? null,
        },
      })
    },
  }),
)

builder.mutationField('updateSavedView', (t) =>
  t.prismaField({
    type: 'SavedView',
    args: {
      id: t.arg.int({ required: true }),
      name: t.arg.string({ required: false }),
      filtersJson: t.arg.string({ required: false }),
      sort: t.arg.string({ required: false }),
    },
    resolve: async (query, _root, args, ctx) => {
      requireAuth(ctx)
      const db = ctx.db as DB
      const data: { name?: string; filtersJson?: unknown; sort?: string | null } = {}
      if (args.name !== null && args.name !== undefined) data.name = args.name
      if (args.filtersJson !== null && args.filtersJson !== undefined) {
        data.filtersJson = parseFilters(args.filtersJson)
      }
      if (args.sort !== undefined) data.sort = args.sort
      return db.savedView.update({
        ...query,
        where: { id: args.id },
        data: data as Parameters<DB['savedView']['update']>[0]['data'],
      })
    },
  }),
)

builder.mutationField('deleteSavedView', (t) =>
  t.field({
    type: 'Boolean',
    args: { id: t.arg.int({ required: true }) },
    resolve: async (_root, { id }, ctx) => {
      requireAuth(ctx)
      const db = ctx.db as DB
      await db.savedView.delete({ where: { id } })
      return true
    },
  }),
)
