import cron from 'node-cron'
import { Queue } from 'bullmq'
import pino from 'pino'
import { redis } from '../lib/redis.js'
import { prisma } from 'shared'

const logger = pino({ name: 'scheduler' })

// Create one queue per engine. BullMQ retries failed jobs with exponential backoff.
const makeQueue = (name: string) =>
  new Queue(name, {
    connection: redis,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 60_000 },
      removeOnComplete: { count: 100, age: 7 * 86400 },
      removeOnFail: { count: 500, age: 30 * 86400 },
    },
  })

export const queues = {
  findLeads: makeQueue('findLeads'),
  sendEmails: makeQueue('sendEmails'),
  sendFollowups: makeQueue('sendFollowups'),
  checkReplies: makeQueue('checkReplies'),
  dailyReport: makeQueue('dailyReport'),
  healthCheck: makeQueue('healthCheck'),
  trialExpiry: makeQueue('trialExpiry'),
} as const

// Enqueue one job per active org. Trial / active orgs run; locked / suspended skip.
async function enqueueForAllOrgs(queueName: keyof typeof queues): Promise<void> {
  const orgs = await prisma.org.findMany({ where: { status: { in: ['trial', 'active'] } } })
  if (orgs.length === 0) {
    logger.info({ queue: queueName }, 'no active orgs — nothing to enqueue')
    return
  }
  await Promise.all(orgs.map((org) => queues[queueName].add(queueName, { orgId: org.id })))
  logger.info({ queue: queueName, count: orgs.length }, 'enqueued')
}

// Schedule entries match the legacy cron schedule (IST timezone).
// node-cron supports timezone via { timezone } option.
const TZ = 'Asia/Kolkata'

export function startScheduler(): void {
  // findLeads: 09:00 IST Mon-Sat
  cron.schedule('0 9 * * 1-6', () => enqueueForAllOrgs('findLeads'), { timezone: TZ })
  // sendEmails: 09:30 IST Mon-Sat
  cron.schedule('30 9 * * 1-6', () => enqueueForAllOrgs('sendEmails'), { timezone: TZ })
  // sendFollowups: 18:00 IST daily
  cron.schedule('0 18 * * *', () => enqueueForAllOrgs('sendFollowups'), { timezone: TZ })
  // checkReplies: 14:00, 16:00, 20:00 IST
  cron.schedule('0 14,16,20 * * *', () => enqueueForAllOrgs('checkReplies'), { timezone: TZ })
  // dailyReport: 20:30 IST daily
  cron.schedule('30 20 * * *', () => enqueueForAllOrgs('dailyReport'), { timezone: TZ })
  // healthCheck: 02:00 IST Sunday
  cron.schedule('0 2 * * 0', () => enqueueForAllOrgs('healthCheck'), { timezone: TZ })
  // trialExpiry: midnight IST daily — locks expired trials and grace periods globally
  cron.schedule('0 0 * * *', () => {
    void queues.trialExpiry.add('trialExpiry', {})
  }, { timezone: TZ })

  logger.info('scheduler started — engines enqueue per active org on IST schedule')
}
