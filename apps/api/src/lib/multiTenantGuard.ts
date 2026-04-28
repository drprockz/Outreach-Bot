import { prisma } from 'shared'
import pino from 'pino'

const logger = pino({ name: 'multiTenantGuard' })

/**
 * Runtime guard that prevents engine workers from running while the legacy
 * single-tenant pipeline is still in place AND more than one customer is active.
 *
 * Background: src/engines/*.js are still single-tenant — they read config from
 * process.env and write rows that all fall back to org_id=1 (via the DEFAULT 1
 * we added in migration 20260428153151_add_orgid_defaults). If a second org
 * becomes active before the engines are made tenant-aware, that org's leads /
 * emails / replies will all be tagged to Org 1.
 *
 * Until the migration described in docs/runbooks/multi-tenant-pipeline-migration.md
 * is complete, this guard refuses to run when >1 org is active. Onboarding a
 * second customer is then explicitly blocked at the worker level.
 *
 * Once the migration is done, drop this file and remove imports from the
 * worker files.
 */
export async function assertSingleActiveOrg(jobName: string): Promise<void> {
  const count = await prisma.org.count({
    where: { status: { in: ['trial', 'active'] } },
  })

  if (count <= 1) return

  const message =
    `Refusing to run ${jobName}: ${count} active orgs detected, but the engine ` +
    `pipeline is still single-tenant. Migrate engines per ` +
    `docs/runbooks/multi-tenant-pipeline-migration.md before activating a ` +
    `second customer.`

  logger.error({ jobName, activeOrgCount: count }, message)
  throw new Error(message)
}
