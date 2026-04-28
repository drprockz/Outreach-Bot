import { Worker, type Job } from 'bullmq'
import pino from 'pino'
import { redis } from '../lib/redis.js'
import { prisma } from 'shared'

const logger = pino({ name: 'worker:trialExpiry' })

export async function lockExpiredSubscriptions(): Promise<void> {
  const now = new Date()

  // Lock expired trials
  const expiredTrials = await prisma.orgSubscription.updateMany({
    where: { status: 'trial', trialEndsAt: { lt: now } },
    data: { status: 'locked' },
  })

  // Lock expired grace periods
  const expiredGrace = await prisma.orgSubscription.updateMany({
    where: { status: 'grace', graceEndsAt: { lt: now } },
    data: { status: 'locked' },
  })

  // Sync Org.status to locked for affected orgs
  const lockedSubs = await prisma.orgSubscription.findMany({
    where: { status: 'locked' },
    select: { orgId: true },
  })
  const lockedOrgIds = lockedSubs.map((s) => s.orgId)
  if (lockedOrgIds.length > 0) {
    await prisma.org.updateMany({
      where: { id: { in: lockedOrgIds }, status: { notIn: ['suspended'] } },
      data: { status: 'locked' },
    })
  }

  logger.info(
    { expiredTrials: expiredTrials.count, expiredGrace: expiredGrace.count },
    'trial expiry run complete',
  )
}

export const trialExpiryWorker = new Worker(
  'trialExpiry',
  async (_job: Job) => {
    await lockExpiredSubscriptions()
  },
  { connection: redis, concurrency: 1 },
)

trialExpiryWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err }, 'trialExpiry job failed')
})
