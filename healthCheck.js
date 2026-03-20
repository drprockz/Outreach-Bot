import 'dotenv/config';
import { getDb, logCron, finishCron, logError, today } from './utils/db.js';
import { checkDomain } from './utils/blacklistCheck.js';
import { sendAlert } from './utils/telegram.js';

const DOMAIN = process.env.OUTREACH_DOMAIN || 'trysimpleinc.com';

export default async function healthCheck() {
  const cronId = logCron('healthCheck');
  try {
    // DNS blacklist check
    const { clean, zones } = await checkDomain(DOMAIN);
    if (!clean) {
      await sendAlert(`🚨 BLACKLIST: ${DOMAIN} listed on: ${zones.join(', ')} — sending paused`);
      // Set DAILY_SEND_LIMIT=0 by writing to process env (runtime override)
      process.env.DAILY_SEND_LIMIT = '0';
      logError('healthCheck.blacklist', new Error(`Domain ${DOMAIN} listed on ${zones.join(', ')}`));
    }

    // Bounce rate check (7-day rolling)
    const db = getDb();
    const rows = db.prepare(`
      SELECT SUM(emails_sent) as sent, SUM(bounces) as bounced
      FROM daily_metrics
      WHERE date >= date('now', '-7 days')
    `).get();
    const bounceRate = rows?.sent > 0 ? (rows.bounced / rows.sent) : 0;
    if (bounceRate > parseFloat(process.env.BOUNCE_RATE_HARD_STOP || '0.02')) {
      await sendAlert(`🚨 BOUNCE RATE ${(bounceRate * 100).toFixed(2)}% exceeds threshold — sending paused`);
      process.env.DAILY_SEND_LIMIT = '0';
    }

    // Unsub rate check (7-day rolling)
    const replyRows = db.prepare(`
      SELECT COUNT(*) as unsubs
      FROM replies
      WHERE classification = 'unsubscribe'
        AND received_at >= datetime('now', '-7 days')
    `).get();
    const unsubRate = rows?.sent > 0 ? ((replyRows?.unsubs || 0) / rows.sent) : 0;
    if (unsubRate > 0.01) {
      await sendAlert(`⚠️ UNSUB RATE ${(unsubRate * 100).toFixed(2)}% exceeds 1.0% — monitor closely`);
    }

    const summary = `✅ healthCheck: blacklist=${clean ? 'clean' : '🚨LISTED'}, bounce=${(bounceRate * 100).toFixed(2)}%, unsub=${(unsubRate * 100).toFixed(2)}%`;
    await sendAlert(summary);
    finishCron(cronId, { status: 'ok' });
  } catch (err) {
    logError('healthCheck', err);
    finishCron(cronId, { status: 'error', error: err.message });
    await sendAlert(`🚨 healthCheck error: ${err.message}`);
  }
}

// Run directly if executed as script
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*[/\\]/, ''))) {
  healthCheck().catch(console.error);
}
