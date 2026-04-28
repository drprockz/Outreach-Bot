import { prisma } from './prismaClient.js'

const TENANT_MODELS = [
  'lead', 'email', 'reply', 'bounce', 'cronLog', 'dailyMetrics',
  'errorLog', 'sequenceState', 'config', 'niche', 'offer',
  'icpProfile', 'savedView', 'leadSignal', 'rejectList',
] as const

type Args = Record<string, unknown>
type Op = (params: { args: Args; query: (args: Args) => unknown }) => unknown

function injectWhere(orgId: number): Op {
  return async ({ args, query }) => {
    args.where = { ...((args.where as Args) ?? {}), orgId }
    return query(args)
  }
}

function injectCreateData(orgId: number): Op {
  return async ({ args, query }) => {
    const data = args.data as Args | Args[] | undefined
    if (Array.isArray(data)) {
      args.data = data.map((row) => ({ orgId, ...row }))
    } else {
      args.data = { orgId, ...((data as Args) ?? {}) }
    }
    return query(args)
  }
}

function injectUpsert(orgId: number): Op {
  return async ({ args, query }) => {
    args.where = { ...((args.where as Args) ?? {}), orgId }
    args.create = { orgId, ...((args.create as Args) ?? {}) }
    return query(args)
  }
}

export function createScopedPrisma(orgId: number) {
  const where = injectWhere(orgId)
  const create = injectCreateData(orgId)
  const upsert = injectUpsert(orgId)
  const queryExtensions = Object.fromEntries(
    TENANT_MODELS.map((model) => [
      model,
      {
        // Reads
        findMany:   where,
        findFirst:  where,
        findUnique: where,
        count:      where,
        aggregate:  where,
        groupBy:    where,
        // Writes
        create:     create,
        createMany: create,
        upsert:     upsert,
        update:     where,
        updateMany: where,
        delete:     where,
        deleteMany: where,
      },
    ])
  )
  return prisma.$extends({ query: queryExtensions } as Parameters<typeof prisma.$extends>[0])
}

export type ScopedPrisma = ReturnType<typeof createScopedPrisma>
