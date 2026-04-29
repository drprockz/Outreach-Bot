import { Router } from 'express';
import { today } from '../../core/db/index.js';

// All engines known to the dashboard. `enabledKey` is the config KV flag
// consulted by the Status tab; engines without a flag (healthCheck) are
// always "on" from the UI's perspective.
const ENGINES = [
  { name: 'findLeads',     schedule: '0 9 * * 1-6',           enabledKey: 'find_leads_enabled' },
  { name: 'sendEmails',    schedule: '30 9 * * 1-6',          enabledKey: 'send_emails_enabled' },
  { name: 'checkReplies',  schedule: 'dynamic',               enabledKey: 'check_replies_enabled' },
  { name: 'sendFollowups', schedule: '0 18 * * 1-6',          enabledKey: 'send_followups_enabled' },
  { name: 'healthCheck',   schedule: '0 2 * * 0',             enabledKey: null },
  { name: 'dailyReport',   schedule: '30 20 * * *',           enabledKey: null },
];

const router = Router();

router.get('/', async (_req, res) => {
  const cfgRows = await req.db.config.findMany();
  const cfg = Object.fromEntries(cfgRows.map(r => [r.key, r.value]));

  // Today's window in UTC — cronLog.startedAt is a TIMESTAMPTZ so we compare
  // to a JS Date anchored at midnight of `today()` in the server's local zone.
  const todayStart = new Date(today() + 'T00:00:00Z');

  const items = await Promise.all(ENGINES.map(async def => {
    const last = await req.db.cronLog.findFirst({
      where: { jobName: def.name },
      orderBy: { startedAt: 'desc' },
      select: {
        status: true, startedAt: true, durationMs: true,
        recordsProcessed: true, costUsd: true,
      },
    });
    const todaysCost = await req.db.cronLog.aggregate({
      where: { jobName: def.name, startedAt: { gte: todayStart } },
      _sum: { costUsd: true },
    });
    return {
      name: def.name,
      enabled: def.enabledKey ? cfg[def.enabledKey] !== '0' : true,
      lastRun: last ? {
        status: last.status,
        startedAt: last.startedAt,
        durationMs: last.durationMs,
        primaryCount: last.recordsProcessed,
      } : null,
      schedule: def.schedule,
      costToday: Number(todaysCost._sum.costUsd || 0),
    };
  }));
  res.json({ items });
});

export default router;
