import { Worker, type Job } from 'bullmq'
import pino from 'pino'
import { redis } from '../lib/redis.js'
import { prisma } from 'shared'

const logger = pino({ name: 'worker:checkReplies' })

interface JobData { orgId: number }

async function runForOrg(orgId: number, jobId: string | undefined): Promise<void> {
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
    data: { jobName: 'checkReplies', orgId, startedAt: new Date(), status: 'running' },
  })

  try {
    // @ts-expect-error — legacy JS engine has no type declarations
    const fn = (await import('../../../../src/engines/checkReplies.js')).default as (orgId: number) => Promise<unknown>
    await fn(orgId)

    await prisma.cronLog.update({
      where: { id: cronLog.id },
      data: { status: 'success', completedAt: new Date(), durationMs: Date.now() - cronLog.startedAt!.getTime() },
    })
    logger.info({ orgId, jobId }, 'checkReplies completed')
  } catch (err) {
    await prisma.cronLog.update({
      where: { id: cronLog.id },
      data: { status: 'failed', completedAt: new Date(), errorMessage: String(err) },
    })
    await prisma.errorLog.create({
      data: { orgId, source: 'worker:checkReplies', errorMessage: String(err), stackTrace: (err as Error).stack ?? null },
    })
    throw err
  }
}

export const checkRepliesWorker = new Worker<JobData>(
  'checkReplies',
  async (job: Job<JobData>) => runForOrg(job.data.orgId, job.id),
  { connection: redis, concurrency: 1 },
)

checkRepliesWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, attempt: job?.attemptsMade, err: err.message }, 'job failed')
})
