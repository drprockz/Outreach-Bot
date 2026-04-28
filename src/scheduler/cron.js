import cron from 'node-cron';
import 'dotenv/config';
import { logError, getConfigMap, getPrisma } from '../core/db/index.js';

// ── DUPLICATE-RUN GUARD ─────────────────────────────────────────────
// This module USED to register all cron schedules at import time. The
// legacy dashboard server (src/api/server.js) imports this module to call
// buildCheckRepliesSchedule(), which had the side-effect of scheduling
// every engine — even when the new BullMQ scheduler in apps/api/ was the
// intended owner.
//
// Now schedules only register when LEGACY_CRON_ENABLED=true. The new
// productized stack (radar-workers-v2) does NOT set this, so importing
// this file from server.js is now safe.
const LEGACY_CRON_ENABLED = process.env.LEGACY_CRON_ENABLED === 'true';

// On a fresh cron-worker boot no engine can possibly be running in this process,
// so any cron_log row still in 'running' is a leftover from a prior PM2 restart /
// crash / OOM. Sweep them so the dashboard's "already running" guard isn't stuck.
async function sweepStaleLocksOnBoot() {
  try {
    const { count } = await getPrisma().cronLog.updateMany({
      where: { status: 'running' },
      data: {
        status: 'failed',
        completedAt: new Date(),
        errorMessage: 'auto-recovered on cron-worker boot (prior process exited mid-run)',
      },
    });
    if (count > 0) console.log(`Radar cron: swept ${count} stale 'running' cron_log row(s) on boot`);
  } catch (err) {
    console.error('Radar cron: stale-lock sweep failed (non-fatal):', err.message);
  }
}
if (LEGACY_CRON_ENABLED) {
  sweepStaleLocksOnBoot();
}

// Helper: wrap any async engine call, log errors to error_log + console.
// Engines now accept `orgId` as their first arg and wrap their body in
// runWithOrg(orgId, …). This legacy rollback path is single-tenant by
// design — pass null so the engine falls through to the raw global
// client (org_id=1 default per schema) instead of a scoped client.
async function runJob(jobName, loader) {
  try {
    const mod = await loader();
    await mod.default(null);
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

if (LEGACY_CRON_ENABLED) {
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

  console.log('Radar cron started (LEGACY_CRON_ENABLED=true)');
} else {
  console.log('Radar legacy cron module loaded but schedules NOT registered (LEGACY_CRON_ENABLED!=true). New BullMQ scheduler in apps/api/ owns engine scheduling.');
}
