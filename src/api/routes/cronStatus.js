import { Router } from 'express';
import { today } from '../../core/db/index.js';

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

function serializeLog(l) {
  if (!l) return null;
  return {
    id: l.id,
    job_name: l.jobName,
    scheduled_at: l.scheduledAt,
    started_at: l.startedAt,
    completed_at: l.completedAt,
    duration_ms: l.durationMs,
    status: l.status,
    error_message: l.errorMessage,
    records_processed: l.recordsProcessed,
    records_skipped: l.recordsSkipped,
    cost_usd: l.costUsd !== null && l.costUsd !== undefined ? Number(l.costUsd) : null,
    notes: l.notes,
  };
}

router.get('/', async (req, res) => {
  const d = today();

  // Today bounds — startedAt is a Timestamptz, so we need a range
  const dayStart = new Date(`${d}T00:00:00.000Z`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const todayLogs = await req.db.cronLog.findMany({
    where: { startedAt: { gte: dayStart, lt: dayEnd } },
    orderBy: { startedAt: 'asc' },
  });

  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const ist = new Date(now.getTime() + istOffset);
  const currentIstHour = ist.getUTCHours();
  const currentIstMinute = ist.getUTCMinutes();
  const currentIstTime = currentIstHour * 60 + currentIstMinute;

  const jobs = JOB_SCHEDULE.map((sched, idx) => {
    const matching = todayLogs.filter(l => l.jobName === sched.name);
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

    return { ...sched, id: idx, log: log ? serializeLog(log) : null, status };
  });

  res.json({ jobs, date: d });
});

router.get('/:job/history', async (req, res) => {
  const history = await req.db.cronLog.findMany({
    where: { jobName: req.params.job },
    orderBy: { startedAt: 'desc' },
    take: 30,
  });
  res.json({ history: history.map(serializeLog) });
});

export default router;
