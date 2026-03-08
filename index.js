import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import { initSchema } from './db/database.js';
import apiRouter from './src/api/router.js';
import { runFindLeads } from './src/jobs/findLeads.js';
import { runSendEmails } from './src/jobs/sendEmails.js';
import { runCheckReplies } from './src/jobs/checkReplies.js';
import { runSendFollowups } from './src/jobs/sendFollowups.js';
import { runDailyReport } from './src/jobs/dailyReport.js';
import logger from './src/lib/logger.js';

// Initialize database
initSchema();

// --- Express API server ---
const app = express();
app.use(cors());
app.use(express.json());
app.use('/api', apiRouter);

const PORT = parseInt(process.env.PORT, 10) || 3000;
app.listen(PORT, () => {
  logger.info(`Express API listening on port ${PORT}`);
});

// --- Cron jobs (all IST) ---
const TZ = 'Asia/Kolkata';

// 9:00 AM — Find new leads
cron.schedule('0 9 * * *', () => {
  logger.info('CRON: findLeads triggered');
  runFindLeads().catch((err) => logger.error(`findLeads error: ${err.message}`));
}, { timezone: TZ });

// 9:30 AM — Generate + send emails
cron.schedule('30 9 * * *', () => {
  logger.info('CRON: sendEmails triggered');
  runSendEmails().catch((err) => logger.error(`sendEmails error: ${err.message}`));
}, { timezone: TZ });

// 2:00 PM — Check replies
cron.schedule('0 14 * * *', () => {
  logger.info('CRON: checkReplies triggered (14:00)');
  runCheckReplies().catch((err) => logger.error(`checkReplies error: ${err.message}`));
}, { timezone: TZ });

// 4:00 PM — Check replies
cron.schedule('0 16 * * *', () => {
  logger.info('CRON: checkReplies triggered (16:00)');
  runCheckReplies().catch((err) => logger.error(`checkReplies error: ${err.message}`));
}, { timezone: TZ });

// 6:00 PM — Send due follow-ups
cron.schedule('0 18 * * *', () => {
  logger.info('CRON: sendFollowups triggered');
  runSendFollowups().catch((err) => logger.error(`sendFollowups error: ${err.message}`));
}, { timezone: TZ });

// 8:00 PM — Final reply check
cron.schedule('0 20 * * *', () => {
  logger.info('CRON: checkReplies triggered (20:00)');
  runCheckReplies().catch((err) => logger.error(`checkReplies error: ${err.message}`));
}, { timezone: TZ });

// 8:30 PM — Daily report
cron.schedule('30 20 * * *', () => {
  logger.info('CRON: dailyReport triggered');
  runDailyReport().catch((err) => logger.error(`dailyReport error: ${err.message}`));
}, { timezone: TZ });

logger.info('Outreach Agent started — Express API + 7 cron jobs registered');
