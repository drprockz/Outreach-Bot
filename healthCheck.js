import 'dotenv/config';
import { writeFileSync, readFileSync } from 'fs';
import { getDb, logCron, finishCron, logError, bumpMetric, today } from './utils/db.js';
import { checkDomain } from './utils/blacklistCheck.js';
import { sendAlert } from './utils/telegram.js';

const DOMAIN = process.env.OUTREACH_DOMAIN || 'trysimpleinc.com';

export default async function healthCheck() {
  const cronId = logCron('healthCheck');
  try {
    const db = getDb();
    const d = today();

    // Ensure daily_metrics row exists
    db.prepare(`INSERT INTO daily_metrics (date) VALUES (?) ON CONFLICT(date) DO NOTHING`).run(d);

    // DNS blacklist check
    const { clean, zones } = await checkDomain(DOMAIN);

    // Store blacklist results in daily_metrics
    db.prepare(`UPDATE daily_metrics SET domain_blacklisted=?, blacklist_zones=? WHERE date=?`).run(
      clean ? 0 : 1,
      clean ? null : zones.join(', '),
      d
    );

    if (!clean) {
      await sendAlert(`BLACKLIST: ${DOMAIN} listed on: ${zones.join(', ')} — sending paused`);
      // Persist DAILY_SEND_LIMIT=0 by writing to .env file so it survives PM2 restarts
      try {
        const envPath = process.env.ENV_PATH || '.env';
        let envContent = readFileSync(envPath, 'utf8');
        envContent = envContent.replace(/^DAILY_SEND_LIMIT=\d+/m, 'DAILY_SEND_LIMIT=0');
        writeFileSync(envPath, envContent);
      } catch {
        // If .env write fails, at least set process env
      }
      process.env.DAILY_SEND_LIMIT = '0';
      logError('healthCheck.blacklist', new Error(`Domain ${DOMAIN} listed on ${zones.join(', ')}`), { jobName: 'healthCheck', errorType: 'smtp_error' });
    }

    // Bounce rate check (7-day rolling) — use correct column names
    const rows = db.prepare(`
      SELECT SUM(emails_sent) as sent, SUM(emails_hard_bounced) as bounced
      FROM daily_metrics
      WHERE date >= date('now', '-7 days')
    `).get();
    const bounceRate = rows?.sent > 0 ? (rows.bounced / rows.sent) : 0;
    if (bounceRate > parseFloat(process.env.BOUNCE_RATE_HARD_STOP || '0.02')) {
      await sendAlert(`BOUNCE RATE ${(bounceRate * 100).toFixed(2)}% exceeds threshold — sending paused`);
      try {
        const envPath = process.env.ENV_PATH || '.env';
        let envContent = readFileSync(envPath, 'utf8');
        envContent = envContent.replace(/^DAILY_SEND_LIMIT=\d+/m, 'DAILY_SEND_LIMIT=0');
        writeFileSync(envPath, envContent);
      } catch { /* best effort */ }
      process.env.DAILY_SEND_LIMIT = '0';
    }

    // Unsub rate check (7-day rolling) — use correct column name 'category'
    const replyRows = db.prepare(`
      SELECT COUNT(*) as unsubs
      FROM replies
      WHERE category = 'unsubscribe'
        AND received_at >= datetime('now', '-7 days')
    `).get();
    const unsubRate = rows?.sent > 0 ? ((replyRows?.unsubs || 0) / rows.sent) : 0;
    if (unsubRate > 0.01) {
      await sendAlert(`UNSUB RATE ${(unsubRate * 100).toFixed(2)}% exceeds 1.0% — monitor closely`);
    }

    const summary = `healthCheck: blacklist=${clean ? 'clean' : 'LISTED'}, bounce=${(bounceRate * 100).toFixed(2)}%, unsub=${(unsubRate * 100).toFixed(2)}%`;
    await sendAlert(summary);
    finishCron(cronId, { status: 'success' });
  } catch (err) {
    logError('healthCheck', err, { jobName: 'healthCheck' });
    finishCron(cronId, { status: 'failed', error: err.message });
    await sendAlert(`healthCheck error: ${err.message}`);
  }
}

// Run directly if executed as script
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*[/\\]/, ''))) {
  healthCheck().catch(console.error);
}
