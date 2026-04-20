import cron from 'node-cron';
import 'dotenv/config';
import { logError } from '../core/db/index.js';

// Helper: wrap any async engine call, log errors to error_log + console
async function runJob(jobName, loader) {
  try {
    const mod = await loader();
    await mod.default();
  } catch (err) {
    try {
      await logError('cron', err, { jobName });
    } catch (logErr) {
      console.error(`cron.${jobName} failed and error log write failed:`, logErr);
    }
    console.error(`cron.${jobName} failed:`, err);
  }
}

// 9:00 AM IST Mon-Sat — Find leads
cron.schedule('0 9 * * 1-6', () => runJob('findLeads', () => import('../engines/findLeads.js')),
  { timezone: 'Asia/Kolkata' });

// 9:30 AM IST Mon-Sat — Send cold emails
cron.schedule('30 9 * * 1-6', () => runJob('sendEmails', () => import('../engines/sendEmails.js')),
  { timezone: 'Asia/Kolkata' });

// 2:00 PM IST daily — Check replies
cron.schedule('0 14 * * *', () => runJob('checkReplies', () => import('../engines/checkReplies.js')),
  { timezone: 'Asia/Kolkata' });

// 4:00 PM IST daily — Check replies
cron.schedule('0 16 * * *', () => runJob('checkReplies', () => import('../engines/checkReplies.js')),
  { timezone: 'Asia/Kolkata' });

// 6:00 PM IST Mon-Sat — Send follow-ups
cron.schedule('0 18 * * 1-6', () => runJob('sendFollowups', () => import('../engines/sendFollowups.js')),
  { timezone: 'Asia/Kolkata' });

// 8:00 PM IST daily — Check replies
cron.schedule('0 20 * * *', () => runJob('checkReplies', () => import('../engines/checkReplies.js')),
  { timezone: 'Asia/Kolkata' });

// 8:30 PM IST daily — Daily report
cron.schedule('30 20 * * *', () => runJob('dailyReport', () => import('../engines/dailyReport.js')),
  { timezone: 'Asia/Kolkata' });

// 2:00 AM IST Sunday — Health check
cron.schedule('0 2 * * 0', () => runJob('healthCheck', () => import('../engines/healthCheck.js')),
  { timezone: 'Asia/Kolkata' });

// 2:00 AM IST daily — Backup
cron.schedule('0 2 * * *', () => {
  import('child_process').then(({ exec }) => {
    exec('./backup.sh', async (err) => {
      if (err) {
        try { await logError('cron', err, { jobName: 'backup' }); } catch { /* best effort */ }
      }
    });
  });
}, { timezone: 'Asia/Kolkata' });

console.log('Radar cron started');
