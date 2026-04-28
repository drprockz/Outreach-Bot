import pino from 'pino'
import { startScheduler } from './scheduler.js'
import { findLeadsWorker } from './findLeads.worker.js'
import { sendEmailsWorker } from './sendEmails.worker.js'
import { sendFollowupsWorker } from './sendFollowups.worker.js'
import { checkRepliesWorker } from './checkReplies.worker.js'
import { dailyReportWorker } from './dailyReport.worker.js'
import { healthCheckWorker } from './healthCheck.worker.js'
import { trialExpiryWorker } from './trialExpiry.worker.js'
import { redis } from '../lib/redis.js'
import { sendAlert } from '../lib/telegram.js'

const logger = pino({ name: 'workers' })

const allWorkers = [
  findLeadsWorker, sendEmailsWorker, sendFollowupsWorker,
  checkRepliesWorker, dailyReportWorker, healthCheckWorker, trialExpiryWorker,
]

// When a job fails AFTER all retries (BullMQ's defaultJobOptions sets attempts: 3),
// fire a Telegram alert so the operator finds out before the next scheduled run.
// Per-attempt failures still log via worker.on('failed') in each worker file.
const FINAL_FAILURE_NOTICE_THRESHOLD = 3

allWorkers.forEach((worker) => {
  worker.on('failed', (job, err) => {
    if (!job) return
    if ((job.attemptsMade ?? 0) < FINAL_FAILURE_NOTICE_THRESHOLD) return
    const queueName = worker.name
    const orgId = (job.data as { orgId?: number })?.orgId
    const subject = `🚨 Radar worker FAILED after ${job.attemptsMade} attempts`
    const detail =
      `Queue: ${queueName}\n` +
      `Job: ${job.id}\n` +
      `Org: ${orgId ?? 'n/a'}\n` +
      `Error: ${err.message}\n` +
      `Time: ${new Date().toISOString()}`
    void sendAlert(`${subject}\n\n${detail}`)
  })
})

logger.info({ count: allWorkers.length }, 'workers booting')

startScheduler()

logger.info('workers + scheduler ready')

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'shutting down workers')
  await Promise.all(allWorkers.map((w) => w.close()))
  redis.disconnect()
  process.exit(0)
}
process.on('SIGTERM', () => { void shutdown('SIGTERM') })
process.on('SIGINT', () => { void shutdown('SIGINT') })
