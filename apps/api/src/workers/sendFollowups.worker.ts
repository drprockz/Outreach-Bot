import { Worker, type Job } from 'bullmq'
import pino from 'pino'
import { redis } from '../lib/redis.js'
import { prisma } from 'shared'
import { assertSingleActiveOrg } from '../lib/multiTenantGuard.js'

const logger = pino({ name: 'worker:sendFollowups' })

interface JobData { orgId: number }

async function runForOrg(orgId: number, jobId: string | undefined): Promise<void> {
  await assertSingleActiveOrg('sendFollowups')

  const sub = await prisma.orgSubscription.findUnique({ where: { orgId }, include: { plan: true } })
  if (!sub || sub.status === 'locked' || sub.status === 'cancelled') {
    logger.warn({ orgId, status: sub?.status }, 'skipping — subscription not eligible')
    return
  }
  if ((await prisma.org.findUnique({ where: { id: orgId } }))?.status === 'suspended') {
    logger.warn({ orgId }, 'skipping — org suspended')
    return
  }

  const cronLog = await prisma.cronLog.create({
    data: { jobName: 'sendFollowups', orgId, startedAt: new Date(), status: 'running' },
  })

  try {
    // @ts-expect-error — legacy JS engine has no type declarations (Phase 1.5 migration)
    const fn = (await import('../../../../src/engines/sendFollowups.js')).default as () => Promise<unknown>
    await fn()

    await prisma.cronLog.update({
      where: { id: cronLog.id },
      data: { status: 'success', completedAt: new Date(), durationMs: Date.now() - cronLog.startedAt!.getTime() },
    })
    logger.info({ orgId, jobId }, 'sendFollowups completed')
  } catch (err) {
    await prisma.cronLog.update({
      where: { id: cronLog.id },
      data: { status: 'failed', completedAt: new Date(), errorMessage: String(err) },
    })
    await prisma.errorLog.create({
      data: { orgId, source: 'worker:sendFollowups', errorMessage: String(err), stackTrace: (err as Error).stack ?? null },
    })
    throw err
  }
}

export const sendFollowupsWorker = new Worker<JobData>(
  'sendFollowups',
  async (job: Job<JobData>) => runForOrg(job.data.orgId, job.id),
  { connection: redis, concurrency: 1 },
)

sendFollowupsWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, attempt: job?.attemptsMade, err: err.message }, 'job failed')
})
