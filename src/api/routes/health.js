import { Router } from 'express';
import { getDb, today } from '../../core/db/index.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDb();
  const d = today();

  const todayMetrics = db.prepare(`SELECT * FROM daily_metrics WHERE date = ?`).get(d);
  const emailsSent = todayMetrics?.emails_sent || 0;
  const bounces = todayMetrics?.emails_hard_bounced || 0;
  const bounceRate = emailsSent > 0 ? (bounces / emailsSent * 100).toFixed(2) : '0.00';

  const weekReplies = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN category = 'unsubscribe' THEN 1 ELSE 0 END) AS unsubs
    FROM replies
    WHERE received_at >= date('now', '-7 days')
  `).get();
  const unsubRate = weekReplies.total > 0
    ? (weekReplies.unsubs / weekReplies.total * 100).toFixed(2)
    : '0.00';

  const inbox1Email = process.env.INBOX_1_USER || 'darshan@trysimpleinc.com';
  const inbox2Email = process.env.INBOX_2_USER || 'hello@trysimpleinc.com';

  const lastSendInbox1 = db.prepare(
    `SELECT sent_at FROM emails WHERE inbox_used = ? AND status = 'sent' ORDER BY sent_at DESC LIMIT 1`
  ).get(inbox1Email);

  const lastSendInbox2 = db.prepare(
    `SELECT sent_at FROM emails WHERE inbox_used = ? AND status = 'sent' ORDER BY sent_at DESC LIMIT 1`
  ).get(inbox2Email);

  const rejectCount = db.prepare(`SELECT COUNT(*) AS count FROM reject_list`).get();

  const blacklistStatus = todayMetrics?.domain_blacklisted || 0;
  const blacklistZones = todayMetrics?.blacklist_zones || null;

  const mailTester = db.prepare(`
    SELECT mail_tester_score, date FROM daily_metrics
    WHERE mail_tester_score IS NOT NULL
    ORDER BY date DESC LIMIT 1
  `).get();

  res.json({
    bounceRate: parseFloat(bounceRate),
    unsubscribeRate: parseFloat(unsubRate),
    domain: process.env.OUTREACH_DOMAIN || 'trysimpleinc.com',
    blacklisted: blacklistStatus === 1,
    blacklistZones,
    postmasterReputation: todayMetrics?.postmaster_reputation || null,
    mailTesterScore: mailTester?.mail_tester_score || null,
    mailTesterDate: mailTester?.date || null,
    inboxes: {
      inbox1: { email: inbox1Email, lastSend: lastSendInbox1?.sent_at || null },
      inbox2: { email: inbox2Email, lastSend: lastSendInbox2?.sent_at || null }
    },
    rejectListSize: rejectCount?.count || 0
  });
});

router.patch('/mail-tester', (req, res) => {
  const db = getDb();
  const { score } = req.body || {};

  if (score === undefined || score === null) return res.status(400).json({ error: 'score is required' });

  const d = today();
  db.prepare(`INSERT INTO daily_metrics (date) VALUES (?) ON CONFLICT(date) DO NOTHING`).run(d);
  db.prepare(`UPDATE daily_metrics SET mail_tester_score = ? WHERE date = ?`).run(parseFloat(score), d);
  res.json({ ok: true });
});

export default router;
