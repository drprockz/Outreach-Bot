import { prisma } from './prismaClient.js'

const TENANT_MODELS = [
  'lead', 'email', 'reply', 'bounce', 'cronLog', 'dailyMetrics',
  'errorLog', 'sequenceState', 'config', 'niche', 'offer',
  'icpProfile', 'savedView', 'leadSignal', 'rejectList',
] as const

function addOrgFilter(orgId: number) {
  return async ({ args, query }: { args: Record<string, unknown>; query: (args: unknown) => unknown }) => {
    args.where = { ...((args.where as Record<string, unknown>) ?? {}), orgId }
    return query(args)
  }
}

export function createScopedPrisma(orgId: number) {
  const queryExtensions = Object.fromEntries(
    TENANT_MODELS.map((model) => [
      model,
      {
        findMany:   addOrgFilter(orgId),
        findFirst:  addOrgFilter(orgId),
        findUnique: addOrgFilter(orgId),
        update:     addOrgFilter(orgId),
        updateMany: addOrgFilter(orgId),
        delete:     addOrgFilter(orgId),
        deleteMany: addOrgFilter(orgId),
      },
    ])
  )
  return prisma.$extends({ query: queryExtensions } as Parameters<typeof prisma.$extends>[0])
}

export type ScopedPrisma = ReturnType<typeof createScopedPrisma>
