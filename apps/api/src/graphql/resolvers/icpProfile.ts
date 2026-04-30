import { prisma } from 'shared'
import { builder } from '../builder.js'
import { requireAuth } from '../guards.js'

type DB = typeof prisma

type IcpProfileShape = {
  id: number | null
  industries: string[]
  companySize: string | null
  revenueRange: string | null
  geography: string[]
  stage: string[]
  techStack: string[]
  internalCapabilities: string[]
  budgetRange: string | null
  problemFrequency: string | null
  problemCost: string | null
  impactedKpis: string[]
  initiatorRoles: string[]
  decisionRoles: string[]
  objections: string[]
  buyingProcess: string | null
  intentSignals: string[]
  currentTools: string[]
  workarounds: string[]
  frustrations: string[]
  switchingBarriers: string[]
  hardDisqualifiers: string[]
  updatedAt: string | null
}

const IcpProfile = builder.objectRef<IcpProfileShape>('IcpProfile')
builder.objectType(IcpProfile, {
  fields: (t) => ({
    id: t.int({ nullable: true, resolve: (i) => i.id }),
    industries: t.stringList({ resolve: (i) => i.industries }),
    companySize: t.string({ nullable: true, resolve: (i) => i.companySize }),
    revenueRange: t.string({ nullable: true, resolve: (i) => i.revenueRange }),
    geography: t.stringList({ resolve: (i) => i.geography }),
    stage: t.stringList({ resolve: (i) => i.stage }),
    techStack: t.stringList({ resolve: (i) => i.techStack }),
    internalCapabilities: t.stringList({ resolve: (i) => i.internalCapabilities }),
    budgetRange: t.string({ nullable: true, resolve: (i) => i.budgetRange }),
    problemFrequency: t.string({ nullable: true, resolve: (i) => i.problemFrequency }),
    problemCost: t.string({ nullable: true, resolve: (i) => i.problemCost }),
    impactedKpis: t.stringList({ resolve: (i) => i.impactedKpis }),
    initiatorRoles: t.stringList({ resolve: (i) => i.initiatorRoles }),
    decisionRoles: t.stringList({ resolve: (i) => i.decisionRoles }),
    objections: t.stringList({ resolve: (i) => i.objections }),
    buyingProcess: t.string({ nullable: true, resolve: (i) => i.buyingProcess }),
    intentSignals: t.stringList({ resolve: (i) => i.intentSignals }),
    currentTools: t.stringList({ resolve: (i) => i.currentTools }),
    workarounds: t.stringList({ resolve: (i) => i.workarounds }),
    frustrations: t.stringList({ resolve: (i) => i.frustrations }),
    switchingBarriers: t.stringList({ resolve: (i) => i.switchingBarriers }),
    hardDisqualifiers: t.stringList({ resolve: (i) => i.hardDisqualifiers }),
    updatedAt: t.string({ nullable: true, resolve: (i) => i.updatedAt }),
  }),
})

type IcpRow = Awaited<ReturnType<DB['icpProfile']['findFirst']>>
const arr = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : [])

function toIcpShape(row: IcpRow): IcpProfileShape {
  if (!row) {
    return {
      id: null, industries: [], companySize: null, revenueRange: null,
      geography: [], stage: [], techStack: [], internalCapabilities: [],
      budgetRange: null, problemFrequency: null, problemCost: null,
      impactedKpis: [], initiatorRoles: [], decisionRoles: [], objections: [],
      buyingProcess: null, intentSignals: [], currentTools: [], workarounds: [],
      frustrations: [], switchingBarriers: [], hardDisqualifiers: [],
      updatedAt: null,
    }
  }
  return {
    id: row.id,
    industries: arr(row.industries),
    companySize: row.companySize,
    revenueRange: row.revenueRange,
    geography: arr(row.geography),
    stage: arr(row.stage),
    techStack: arr(row.techStack),
    internalCapabilities: arr(row.internalCapabilities),
    budgetRange: row.budgetRange,
    problemFrequency: row.problemFrequency,
    problemCost: row.problemCost,
    impactedKpis: arr(row.impactedKpis),
    initiatorRoles: arr(row.initiatorRoles),
    decisionRoles: arr(row.decisionRoles),
    objections: arr(row.objections),
    buyingProcess: row.buyingProcess,
    intentSignals: arr(row.intentSignals),
    currentTools: arr(row.currentTools),
    workarounds: arr(row.workarounds),
    frustrations: arr(row.frustrations),
    switchingBarriers: arr(row.switchingBarriers),
    hardDisqualifiers: arr(row.hardDisqualifiers),
    updatedAt: row.updatedAt.toISOString(),
  }
}

builder.queryField('icpProfile', (t) =>
  t.field({
    type: IcpProfile,
    resolve: async (_root, _args, ctx) => {
      requireAuth(ctx)
      const db = ctx.db as DB
      const row = await db.icpProfile.findFirst({})
      return toIcpShape(row)
    },
  }),
)

builder.mutationField('updateIcpProfile', (t) =>
  t.field({
    type: IcpProfile,
    args: {
      industries: t.arg.stringList({ required: false }),
      companySize: t.arg.string({ required: false }),
      revenueRange: t.arg.string({ required: false }),
      geography: t.arg.stringList({ required: false }),
      stage: t.arg.stringList({ required: false }),
      techStack: t.arg.stringList({ required: false }),
      internalCapabilities: t.arg.stringList({ required: false }),
      budgetRange: t.arg.string({ required: false }),
      problemFrequency: t.arg.string({ required: false }),
      problemCost: t.arg.string({ required: false }),
      impactedKpis: t.arg.stringList({ required: false }),
      initiatorRoles: t.arg.stringList({ required: false }),
      decisionRoles: t.arg.stringList({ required: false }),
      objections: t.arg.stringList({ required: false }),
      buyingProcess: t.arg.string({ required: false }),
      intentSignals: t.arg.stringList({ required: false }),
      currentTools: t.arg.stringList({ required: false }),
      workarounds: t.arg.stringList({ required: false }),
      frustrations: t.arg.stringList({ required: false }),
      switchingBarriers: t.arg.stringList({ required: false }),
      hardDisqualifiers: t.arg.stringList({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      requireAuth(ctx)
      const db = ctx.db as DB
      const data = {
        industries: args.industries ?? [],
        companySize: args.companySize ?? null,
        revenueRange: args.revenueRange ?? null,
        geography: args.geography ?? [],
        stage: args.stage ?? [],
        techStack: args.techStack ?? [],
        internalCapabilities: args.internalCapabilities ?? [],
        budgetRange: args.budgetRange ?? null,
        problemFrequency: args.problemFrequency ?? null,
        problemCost: args.problemCost ?? null,
        impactedKpis: args.impactedKpis ?? [],
        initiatorRoles: args.initiatorRoles ?? [],
        decisionRoles: args.decisionRoles ?? [],
        objections: args.objections ?? [],
        buyingProcess: args.buyingProcess ?? null,
        intentSignals: args.intentSignals ?? [],
        currentTools: args.currentTools ?? [],
        workarounds: args.workarounds ?? [],
        frustrations: args.frustrations ?? [],
        switchingBarriers: args.switchingBarriers ?? [],
        hardDisqualifiers: args.hardDisqualifiers ?? [],
        updatedAt: new Date(),
      }
      const existing = await db.icpProfile.findFirst({ select: { id: true } })
      const saved = existing
        ? await db.icpProfile.update({ where: { id: existing.id }, data })
        : await db.icpProfile.create({ data })
      return toIcpShape(saved)
    },
  }),
)
