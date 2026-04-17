import cron from 'node-cron';
import 'dotenv/config';
import { initSchema } from '../core/db/index.js';

initSchema();

// 9:00 AM IST Mon-Sat — Find leads
cron.schedule('0 9 * * 1-6', () => {
  import('../engines/findLeads.js').then(m => m.default()).catch(console.error);
}, { timezone: 'Asia/Kolkata' });

// 9:30 AM IST Mon-Sat — Send cold emails
cron.schedule('30 9 * * 1-6', () => {
  import('../engines/sendEmails.js').then(m => m.default()).catch(console.error);
}, { timezone: 'Asia/Kolkata' });

// 2:00 PM IST daily — Check replies
cron.schedule('0 14 * * *', () => {
  import('../engines/checkReplies.js').then(m => m.default()).catch(console.error);
}, { timezone: 'Asia/Kolkata' });

// 4:00 PM IST daily — Check replies
cron.schedule('0 16 * * *', () => {
  import('../engines/checkReplies.js').then(m => m.default()).catch(console.error);
}, { timezone: 'Asia/Kolkata' });

// 6:00 PM IST Mon-Sat — Send follow-ups
cron.schedule('0 18 * * 1-6', () => {
  import('../engines/sendFollowups.js').then(m => m.default()).catch(console.error);
}, { timezone: 'Asia/Kolkata' });

// 8:00 PM IST daily — Check replies
cron.schedule('0 20 * * *', () => {
  import('../engines/checkReplies.js').then(m => m.default()).catch(console.error);
}, { timezone: 'Asia/Kolkata' });

// 8:30 PM IST daily — Daily report
cron.schedule('30 20 * * *', () => {
  import('../engines/dailyReport.js').then(m => m.default()).catch(console.error);
}, { timezone: 'Asia/Kolkata' });

// 2:00 AM IST Sunday — Health check
cron.schedule('0 2 * * 0', () => {
  import('../engines/healthCheck.js').then(m => m.default()).catch(console.error);
}, { timezone: 'Asia/Kolkata' });

// 2:00 AM IST daily — Backup
cron.schedule('0 2 * * *', () => {
  import('child_process').then(({ exec }) => {
    exec('./backup.sh', (err) => {
      if (err) {
        import('../core/db/index.js').then(({ logError }) => logError('backup', err));
      }
    });
  });
}, { timezone: 'Asia/Kolkata' });

console.log('Radar cron started');
