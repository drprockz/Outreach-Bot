import { Router } from 'express';
import { getDb, today } from '../../core/db/index.js';

const router = Router();

const JOB_SCHEDULE = [
  { name: 'findLeads', time: '09:00' },
  { name: 'sendEmails', time: '09:30' },
  { name: 'checkReplies', time: '14:00', pass: 1 },
  { name: 'checkReplies', time: '16:00', pass: 2 },
  { name: 'sendFollowups', time: '18:00' },
  { name: 'checkReplies', time: '20:00', pass: 3 },
  { name: 'dailyReport', time: '20:30' },
  { name: 'healthCheck', time: '02:00', day: 'sunday' },
  { name: 'backup', time: '02:00' }
];

router.get('/', (req, res) => {
  const db = getDb();
  const d = today();

  const todayLogs = db.prepare(`
    SELECT * FROM cron_log
    WHERE date(started_at) = ?
    ORDER BY started_at ASC
  `).all(d);

  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const ist = new Date(now.getTime() + istOffset);
  const currentIstHour = ist.getUTCHours();
  const currentIstMinute = ist.getUTCMinutes();
  const currentIstTime = currentIstHour * 60 + currentIstMinute;

  const jobs = JOB_SCHEDULE.map((sched, idx) => {
    const matching = todayLogs.filter(l => l.job_name === sched.name);
    let log;
    if (sched.name === 'checkReplies' && sched.pass) {
      log = matching[sched.pass - 1];
    } else {
      log = matching[0];
    }

    let status = log ? log.status : 'not_triggered';
    if (!log) {
      const [schedHour, schedMin] = sched.time.split(':').map(Number);
      const schedTime = schedHour * 60 + schedMin;
      const istDay = ist.getUTCDay();
      if (sched.day === 'sunday' && istDay !== 0) {
        status = 'pending';
      } else if (currentIstTime < schedTime + 30) {
        status = 'pending';
      }
    }

    return { ...sched, id: idx, log: log || null, status };
  });

  res.json({ jobs, date: d });
});

router.get('/:job/history', (req, res) => {
  const history = getDb().prepare(`
    SELECT * FROM cron_log
    WHERE job_name = ?
    ORDER BY started_at DESC
    LIMIT 30
  `).all(req.params.job);

  res.json({ history });
});

export default router;
