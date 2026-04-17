import cron from 'node-cron';
import 'dotenv/config';
import { initSchema } from './utils/db.js';

initSchema();

// 9:00 AM IST Mon-Sat — Find leads
cron.schedule('0 9 * * 1-6', () => {
  import('./findLeads.js').then(m => m.default()).catch(console.error);
}, { timezone: 'Asia/Kolkata' });

// 9:30 AM IST Mon-Sat — Send cold emails
cron.schedule('30 9 * * 1-6', () => {
  import('./sendEmails.js').then(m => m.default()).catch(console.error);
}, { timezone: 'Asia/Kolkata' });

// 2:00 PM IST daily — Check replies
cron.schedule('0 14 * * *', () => {
  import('./checkReplies.js').then(m => m.default()).catch(console.error);
}, { timezone: 'Asia/Kolkata' });

// 4:00 PM IST daily — Check replies
cron.schedule('0 16 * * *', () => {
  import('./checkReplies.js').then(m => m.default()).catch(console.error);
}, { timezone: 'Asia/Kolkata' });

// 6:00 PM IST Mon-Sat — Send follow-ups
cron.schedule('0 18 * * 1-6', () => {
  import('./sendFollowups.js').then(m => m.default()).catch(console.error);
}, { timezone: 'Asia/Kolkata' });

// 8:00 PM IST daily — Check replies
cron.schedule('0 20 * * *', () => {
  import('./checkReplies.js').then(m => m.default()).catch(console.error);
}, { timezone: 'Asia/Kolkata' });

// 8:30 PM IST daily — Daily report
cron.schedule('30 20 * * *', () => {
  import('./dailyReport.js').then(m => m.default()).catch(console.error);
}, { timezone: 'Asia/Kolkata' });

// 2:00 AM IST Sunday — Health check
cron.schedule('0 2 * * 0', () => {
  import('./healthCheck.js').then(m => m.default()).catch(console.error);
}, { timezone: 'Asia/Kolkata' });

// 2:00 AM IST daily — Backup
cron.schedule('0 2 * * *', () => {
  import('child_process').then(({ exec }) => {
    exec('./backup.sh', (err) => {
      if (err) {
        import('./utils/db.js').then(({ logError }) => logError('backup', err));
      }
    });
  });
}, { timezone: 'Asia/Kolkata' });

console.log('Radar cron started');
