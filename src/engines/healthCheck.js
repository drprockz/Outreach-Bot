import 'dotenv/config';
import { writeFileSync, readFileSync } from 'fs';
import { prisma, logCron, finishCron, logError, today } from '../core/db/index.js';
import { checkDomain } from '../core/integrations/blacklistCheck.js';
import { sendAlert } from '../core/integrations/telegram.js';

const DOMAIN = process.env.OUTREACH_DOMAIN || 'trysimpleinc.com';

async function forceDailySendLimitZero() {
  // Persist to .env so PM2 restarts keep the pause
  try {
    const envPath = process.env.ENV_PATH || '.env';
    let envContent = readFileSync(envPath, 'utf8');
    envContent = envContent.replace(/^DAILY_SEND_LIMIT=\d+/m, 'DAILY_SEND_LIMIT=0');
    writeFileSync(envPath, envContent);
  } catch {
    // If .env write fails, at least set process env + config
  }
  process.env.DAILY_SEND_LIMIT = '0';
  // Also persist in config so getConfigMap-based readers see it
  await prisma.config.upsert({
    where: { key: 'daily_send_limit' },
    create: { key: 'daily_send_limit', value: '0' },
    update: { value: '0' },
  });
}

export default async function healthCheck() {
  const cronId = await logCron('healthCheck');
  try {
    const d = today();

    // DNS blacklist check
    const { clean, zones } = await checkDomain(DOMAIN);

    // Store blacklist results in daily_metrics (upsert — ensures row exists)
    await prisma.dailyMetrics.upsert({
      where: { date: d },
      create: {
        date: d,
        domainBlacklisted: !clean,
        blacklistZones: clean ? null : zones,
      },
      update: {
        domainBlacklisted: !clean,
        blacklistZones: clean ? null : zones,
      },
    });

    if (!clean) {
      await sendAlert(`🚨 BLACKLIST: ${DOMAIN} listed on: ${zones.join(', ')} — sending paused`);
      await forceDailySendLimitZero();
      await logError('healthCheck.blacklist', new Error(`Domain ${DOMAIN} listed on ${zones.join(', ')}`), { jobName: 'healthCheck', errorType: 'smtp_error' });
    }

    // Bounce rate check (7-day rolling)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const rows = await prisma.dailyMetrics.findMany({
      where: { date: { gte: sevenDaysAgo } },
      select: { emailsSent: true, emailsHardBounced: true },
    });
    const sent = rows.reduce((a, r) => a + (r.emailsSent || 0), 0);
    const bounced = rows.reduce((a, r) => a + (r.emailsHardBounced || 0), 0);
    const bounceRate = sent > 0 ? bounced / sent : 0;
    if (bounceRate > parseFloat(process.env.BOUNCE_RATE_HARD_STOP || '0.02')) {
      await sendAlert(`🚨 BOUNCE RATE ${(bounceRate * 100).toFixed(2)}% exceeds threshold — sending paused`);
      await forceDailySendLimitZero();
    }

    // Unsub rate check (7-day rolling)
    const sevenDaysAgoDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const unsubs = await prisma.reply.count({
      where: {
        category: 'unsubscribe',
        receivedAt: { gte: sevenDaysAgoDate },
      },
    });
    const unsubRate = sent > 0 ? unsubs / sent : 0;
    if (unsubRate > 0.01) {
      await sendAlert(`⚠️ UNSUB RATE ${(unsubRate * 100).toFixed(2)}% exceeds 1.0% — monitor closely`);
    }

    const summary = `healthCheck: blacklist=${clean ? 'clean' : 'LISTED'}, bounce=${(bounceRate * 100).toFixed(2)}%, unsub=${(unsubRate * 100).toFixed(2)}%`;
    await sendAlert(summary);
    await finishCron(cronId, { status: 'success' });
  } catch (err) {
    await logError('healthCheck', err, { jobName: 'healthCheck' });
    await finishCron(cronId, { status: 'failed', error: err.message });
    await sendAlert(`healthCheck error: ${err.message}`);
  }
}

// Run directly if executed as script
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*[/\\]/, ''))) {
  healthCheck().catch(console.error);
}
