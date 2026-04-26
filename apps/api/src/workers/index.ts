import pino from 'pino'
import { startScheduler } from './scheduler.js'
import { findLeadsWorker } from './findLeads.worker.js'
import { sendEmailsWorker } from './sendEmails.worker.js'
import { sendFollowupsWorker } from './sendFollowups.worker.js'
import { checkRepliesWorker } from './checkReplies.worker.js'
import { dailyReportWorker } from './dailyReport.worker.js'
import { healthCheckWorker } from './healthCheck.worker.js'
import { redis } from '../lib/redis.js'

const logger = pino({ name: 'workers' })

const allWorkers = [
  findLeadsWorker, sendEmailsWorker, sendFollowupsWorker,
  checkRepliesWorker, dailyReportWorker, healthCheckWorker,
]

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
