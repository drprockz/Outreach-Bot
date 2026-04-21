import cron from 'node-cron';
import 'dotenv/config';
import { logError, getConfigMap } from '../core/db/index.js';

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

// check_replies_interval_minutes: configurable via /api/engines/checkReplies config.
// Falls back to fixed 14:00/16:00/20:00 schedule if the key is missing/invalid.
const FIXED_CHECK_REPLIES_SCHEDULE = '0 14,16,20 * * *';

let _fellBackCheckRepliesInterval = false;
export function didFallbackCheckRepliesInterval() { return _fellBackCheckRepliesInterval; }

export async function buildCheckRepliesSchedule() {
  try {
    const cfg = await getConfigMap();
    const raw = cfg.check_replies_interval_minutes;
    const n = parseInt(raw, 10);
    if (Number.isInteger(n) && n >= 1 && n <= 1440) {
      _fellBackCheckRepliesInterval = false;
      return `*/${n} * * * *`;
    }
  } catch { /* fall through */ }
  _fellBackCheckRepliesInterval = true;
  return FIXED_CHECK_REPLIES_SCHEDULE;
}

// 9:00 AM IST Mon-Sat — Find leads
cron.schedule('0 9 * * 1-6', () => runJob('findLeads', () => import('../engines/findLeads.js')),
  { timezone: 'Asia/Kolkata' });

// 9:30 AM IST Mon-Sat — Send cold emails
cron.schedule('30 9 * * 1-6', () => runJob('sendEmails', () => import('../engines/sendEmails.js')),
  { timezone: 'Asia/Kolkata' });

// checkReplies: schedule resolved from config at boot
buildCheckRepliesSchedule().then(schedule => {
  cron.schedule(schedule, () => runJob('checkReplies', () => import('../engines/checkReplies.js')),
    { timezone: 'Asia/Kolkata' });
}).catch(err => {
  console.error('checkReplies schedule init failed; using fixed fallback:', err);
  cron.schedule(FIXED_CHECK_REPLIES_SCHEDULE, () => runJob('checkReplies', () => import('../engines/checkReplies.js')),
    { timezone: 'Asia/Kolkata' });
});

// 6:00 PM IST Mon-Sat — Send follow-ups
cron.schedule('0 18 * * 1-6', () => runJob('sendFollowups', () => import('../engines/sendFollowups.js')),
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
