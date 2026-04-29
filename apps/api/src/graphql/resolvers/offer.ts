import { prisma } from 'shared'
import { builder } from '../builder.js'
import { requireAuth } from '../guards.js'

type DB = typeof prisma

type OfferShape = {
  id: number | null
  problem: string | null
  outcome: string | null
  category: string | null
  useCases: string[]
  triggers: string[]
  alternatives: string[]
  differentiation: string | null
  priceRange: string | null
  salesCycle: string | null
  criticality: string | null
  inactionCost: string | null
  requiredInputs: string[]
  proofPoints: string[]
  updatedAt: string | null
}

const Offer = builder.objectRef<OfferShape>('Offer')
builder.objectType(Offer, {
  fields: (t) => ({
    id: t.int({ nullable: true, resolve: (o) => o.id }),
    problem: t.string({ nullable: true, resolve: (o) => o.problem }),
    outcome: t.string({ nullable: true, resolve: (o) => o.outcome }),
    category: t.string({ nullable: true, resolve: (o) => o.category }),
    useCases: t.stringList({ resolve: (o) => o.useCases }),
    triggers: t.stringList({ resolve: (o) => o.triggers }),
    alternatives: t.stringList({ resolve: (o) => o.alternatives }),
    differentiation: t.string({ nullable: true, resolve: (o) => o.differentiation }),
    priceRange: t.string({ nullable: true, resolve: (o) => o.priceRange }),
    salesCycle: t.string({ nullable: true, resolve: (o) => o.salesCycle }),
    criticality: t.string({ nullable: true, resolve: (o) => o.criticality }),
    inactionCost: t.string({ nullable: true, resolve: (o) => o.inactionCost }),
    requiredInputs: t.stringList({ resolve: (o) => o.requiredInputs }),
    proofPoints: t.stringList({ resolve: (o) => o.proofPoints }),
    updatedAt: t.string({ nullable: true, resolve: (o) => o.updatedAt }),
  }),
})

type OfferRow = Awaited<ReturnType<DB['offer']['findFirst']>>

function toOfferShape(row: OfferRow): OfferShape {
  if (!row) {
    return {
      id: null, problem: null, outcome: null, category: null,
      useCases: [], triggers: [], alternatives: [],
      differentiation: null, priceRange: null, salesCycle: null,
      criticality: null, inactionCost: null,
      requiredInputs: [], proofPoints: [], updatedAt: null,
    }
  }
  const arr = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : [])
  return {
    id: row.id,
    problem: row.problem,
    outcome: row.outcome,
    category: row.category,
    useCases: arr(row.useCases),
    triggers: arr(row.triggers),
    alternatives: arr(row.alternatives),
    differentiation: row.differentiation,
    priceRange: row.priceRange,
    salesCycle: row.salesCycle,
    criticality: row.criticality,
    inactionCost: row.inactionCost,
    requiredInputs: arr(row.requiredInputs),
    proofPoints: arr(row.proofPoints),
    updatedAt: row.updatedAt.toISOString(),
  }
}

builder.queryField('offer', (t) =>
  t.field({
    type: Offer,
    resolve: async (_root, _args, ctx) => {
      requireAuth(ctx)
      const db = ctx.db as DB
      const row = await db.offer.findFirst({})
      return toOfferShape(row)
    },
  }),
)

builder.mutationField('updateOffer', (t) =>
  t.field({
    type: Offer,
    args: {
      problem: t.arg.string({ required: false }),
      outcome: t.arg.string({ required: false }),
      category: t.arg.string({ required: false }),
      useCases: t.arg.stringList({ required: false }),
      triggers: t.arg.stringList({ required: false }),
      alternatives: t.arg.stringList({ required: false }),
      differentiation: t.arg.string({ required: false }),
      priceRange: t.arg.string({ required: false }),
      salesCycle: t.arg.string({ required: false }),
      criticality: t.arg.string({ required: false }),
      inactionCost: t.arg.string({ required: false }),
      requiredInputs: t.arg.stringList({ required: false }),
      proofPoints: t.arg.stringList({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      requireAuth(ctx)
      const db = ctx.db as DB
      const data = {
        problem: args.problem ?? null,
        outcome: args.outcome ?? null,
        category: args.category ?? null,
        useCases: args.useCases ?? [],
        triggers: args.triggers ?? [],
        alternatives: args.alternatives ?? [],
        differentiation: args.differentiation ?? null,
        priceRange: args.priceRange ?? null,
        salesCycle: args.salesCycle ?? null,
        criticality: args.criticality ?? null,
        inactionCost: args.inactionCost ?? null,
        requiredInputs: args.requiredInputs ?? [],
        proofPoints: args.proofPoints ?? [],
        updatedAt: new Date(),
      }
      // Schema lacks a one-row-per-org @@unique, so find-then-update-or-create
      // via the scoped client (matches legacy src/api/routes/offer.js).
      const existing = await db.offer.findFirst({ select: { id: true } })
      const saved = existing
        ? await db.offer.update({ where: { id: existing.id }, data })
        : await db.offer.create({ data })
      return toOfferShape(saved)
    },
  }),
)
