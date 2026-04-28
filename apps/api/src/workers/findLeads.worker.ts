import { Worker, type Job } from 'bullmq'
import pino from 'pino'
import { redis } from '../lib/redis.js'
import { prisma } from 'shared'
import { assertSingleActiveOrg } from '../lib/multiTenantGuard.js'

const logger = pino({ name: 'worker:findLeads' })

interface JobData { orgId: number }

async function runForOrg(orgId: number, jobId: string | undefined): Promise<void> {
  // Refuses to run if >1 active org exists — engines are still single-tenant.
  // See docs/runbooks/multi-tenant-pipeline-migration.md
  await assertSingleActiveOrg('findLeads')

  const sub = await prisma.orgSubscription.findUnique({
    where: { orgId },
    include: { plan: true },
  })
  if (!sub || sub.status === 'locked' || sub.status === 'cancelled') {
    logger.warn({ orgId, status: sub?.status }, 'skipping — subscription not eligible')
    return
  }
  if ((await prisma.org.findUnique({ where: { id: orgId } }))?.status === 'suspended') {
    logger.warn({ orgId }, 'skipping — org suspended')
    return
  }

  const cronLog = await prisma.cronLog.create({
    data: { jobName: 'findLeads', orgId, startedAt: new Date(), status: 'running' },
  })

  try {
    // The existing JS engine is single-tenant and reads its config from process.env
    // and the global DB. For Phase 1 (Org 1 only) this is operationally correct.
    // Multi-tenant migration of the pipeline will require parameterizing it by orgId
    // and reading plan limits (claudeDailySpendCapUsd, geminiQueriesPerDay, leadsPerDay)
    // from `sub.plan.limitsJson` instead of process.env. Tracked for Phase 1.5.
    // @ts-expect-error — legacy JS engine has no type declarations (Phase 1.5 migration)
    const findLeads = (await import('../../../../src/engines/findLeads.js')).default as () => Promise<unknown>
    await findLeads()

    await prisma.cronLog.update({
      where: { id: cronLog.id },
      data: { status: 'success', completedAt: new Date(), durationMs: Date.now() - cronLog.startedAt!.getTime() },
    })
    logger.info({ orgId, jobId }, 'findLeads completed')
  } catch (err) {
    await prisma.cronLog.update({
      where: { id: cronLog.id },
      data: { status: 'failed', completedAt: new Date(), errorMessage: String(err) },
    })
    await prisma.errorLog.create({
      data: { orgId, source: 'worker:findLeads', errorMessage: String(err), stackTrace: (err as Error).stack ?? null },
    })
    throw err  // BullMQ will retry per defaultJobOptions
  }
}

export const findLeadsWorker = new Worker<JobData>(
  'findLeads',
  async (job: Job<JobData>) => runForOrg(job.data.orgId, job.id),
  { connection: redis, concurrency: 1 },  // run serially per worker to avoid API rate limits
)

findLeadsWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, attempt: job?.attemptsMade, err: err.message }, 'job failed')
})
