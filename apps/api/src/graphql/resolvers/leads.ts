import { prisma } from 'shared'
import { builder } from '../builder.js'
import { requireAuth } from '../guards.js'

type DB = typeof prisma

builder.prismaObject('Lead', {
  fields: (t) => ({
    id: t.exposeInt('id'),
    businessName: t.exposeString('businessName', { nullable: true }),
    websiteUrl: t.exposeString('websiteUrl', { nullable: true }),
    category: t.exposeString('category', { nullable: true }),
    city: t.exposeString('city', { nullable: true }),
    country: t.exposeString('country', { nullable: true }),
    status: t.exposeString('status'),
    icpScore: t.exposeInt('icpScore', { nullable: true }),
    websiteQualityScore: t.exposeInt('websiteQualityScore', { nullable: true }),
    contactEmail: t.exposeString('contactEmail', { nullable: true }),
    contactName: t.exposeString('contactName', { nullable: true }),
    discoveredAt: t.string({ resolve: (lead) => lead.discoveredAt.toISOString() }),
  }),
})

builder.queryField('leads', (t) =>
  t.prismaField({
    type: ['Lead'],
    args: {
      take: t.arg.int({ defaultValue: 50 }),
      skip: t.arg.int({ defaultValue: 0 }),
      status: t.arg.string({ required: false }),
    },
    resolve: async (query, _root, args, ctx) => {
      requireAuth(ctx)
      // ctx.db is scoped to ctx.user.orgId for non-superadmin users.
      // For superadmin (ctx.db === prisma), no orgId filter is auto-applied —
      // resolver must handle if needed.
      const where = args.status ? { status: args.status } : {}
      const db = ctx.db as DB
      return db.lead.findMany({
        ...query,
        where,
        take: args.take ?? 50,
        skip: args.skip ?? 0,
        orderBy: { icpScore: 'desc' },
      })
    },
  }),
)
