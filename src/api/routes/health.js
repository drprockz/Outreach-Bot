import { Router } from 'express';
import { today } from '../../core/db/index.js';

const router = Router();

router.get('/', async (req, res) => {
  const d = today();

  const todayMetrics = await req.db.dailyMetrics.findUnique({ where: { date: d } });
  const emailsSent = todayMetrics?.emailsSent || 0;
  const bounces = todayMetrics?.emailsHardBounced || 0;
  const bounceRate = emailsSent > 0 ? (bounces / emailsSent * 100).toFixed(2) : '0.00';

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const weekReplyRows = await req.db.reply.findMany({
    where: { receivedAt: { gte: sevenDaysAgo } },
    select: { category: true },
  });
  const weekTotal = weekReplyRows.length;
  const weekUnsubs = weekReplyRows.filter(r => r.category === 'unsubscribe').length;
  const unsubRate = weekTotal > 0 ? (weekUnsubs / weekTotal * 100).toFixed(2) : '0.00';

  const inbox1Email = process.env.INBOX_1_USER || 'darshan@trysimpleinc.com';
  const inbox2Email = process.env.INBOX_2_USER || 'hello@trysimpleinc.com';

  const lastSendInbox1 = await req.db.email.findFirst({
    where: { inboxUsed: inbox1Email, status: 'sent' },
    orderBy: { sentAt: 'desc' },
    select: { sentAt: true },
  });
  const lastSendInbox2 = await req.db.email.findFirst({
    where: { inboxUsed: inbox2Email, status: 'sent' },
    orderBy: { sentAt: 'desc' },
    select: { sentAt: true },
  });

  const rejectCount = await req.db.rejectList.count();

  const blacklisted = todayMetrics?.domainBlacklisted === true;
  const blacklistZones = todayMetrics?.blacklistZones || null;

  const mailTester = await req.db.dailyMetrics.findFirst({
    where: { mailTesterScore: { not: null } },
    orderBy: { date: 'desc' },
    select: { mailTesterScore: true, date: true },
  });

  res.json({
    bounceRate: parseFloat(bounceRate),
    unsubscribeRate: parseFloat(unsubRate),
    domain: process.env.OUTREACH_DOMAIN || 'trysimpleinc.com',
    blacklisted,
    blacklistZones,
    postmasterReputation: todayMetrics?.postmasterReputation || null,
    mailTesterScore: mailTester?.mailTesterScore ?? null,
    mailTesterDate: mailTester?.date || null,
    inboxes: {
      inbox1: { email: inbox1Email, lastSend: lastSendInbox1?.sentAt || null },
      inbox2: { email: inbox2Email, lastSend: lastSendInbox2?.sentAt || null }
    },
    rejectListSize: rejectCount
  });
});

router.patch('/mail-tester', async (req, res) => {
  const { score } = req.body || {};
  if (score === undefined || score === null) return res.status(400).json({ error: 'score is required' });

  const d = today();
  await req.db.dailyMetrics.upsert({
    where: { date: d },
    create: { date: d, mailTesterScore: parseFloat(score) },
    update: { mailTesterScore: parseFloat(score) },
  });
  res.json({ ok: true });
});

export default router;
