import pino from 'pino'

const logger = pino({ name: 'multiTenantGuard' })

/**
 * @deprecated As of Tier 1.G1.2, the legacy JS engines accept an `orgId`
 * parameter and wrap their bodies in `runWithOrg(orgId, …)` so every Prisma
 * read/write resolves through the requesting org's scoped client (see
 * src/core/db/index.js + packages/shared/src/scopedPrisma.ts). The previous
 * single-tenant safety guard is no longer needed and the workers no longer
 * call this function.
 *
 * Kept as a no-op shim so any out-of-tree caller doesn't break before the
 * file is deleted in a follow-up cleanup.
 */
export async function assertSingleActiveOrg(jobName: string): Promise<void> {
  logger.warn({ jobName }, 'assertSingleActiveOrg is deprecated and is now a no-op')
}
