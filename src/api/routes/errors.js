import { Router } from 'express';

const router = Router();

function serialize(e) {
  if (!e) return null;
  return {
    id: e.id,
    occurred_at: e.occurredAt,
    source: e.source,
    job_name: e.jobName,
    error_type: e.errorType,
    error_code: e.errorCode,
    error_message: e.errorMessage,
    stack_trace: e.stackTrace,
    lead_id: e.leadId,
    email_id: e.emailId,
    resolved: e.resolved ? 1 : 0,
    resolved_at: e.resolvedAt,
  };
}

router.get('/', async (req, res) => {
  const where = {};
  if (req.query.source) where.source = req.query.source;
  if (req.query.error_type) where.errorType = req.query.error_type;
  if (req.query.resolved !== undefined) where.resolved = parseInt(req.query.resolved) === 1;
  if (req.query.date_from) where.occurredAt = { ...(where.occurredAt || {}), gte: new Date(req.query.date_from) };
  if (req.query.date_to) where.occurredAt = { ...(where.occurredAt || {}), lte: new Date(req.query.date_to) };

  const [rows, unresolvedCount] = await Promise.all([
    req.db.errorLog.findMany({ where, orderBy: { occurredAt: 'desc' }, take: 200 }),
    req.db.errorLog.count({ where: { resolved: false } }),
  ]);

  res.json({ errors: rows.map(serialize), unresolvedCount });
});

router.patch('/:id/resolve', async (req, res) => {
  const id = parseInt(req.params.id);

  const err = await req.db.errorLog.findUnique({ where: { id }, select: { id: true } });
  if (!err) return res.status(404).json({ error: 'Error not found' });

  await req.db.errorLog.update({
    where: { id },
    data: { resolved: true, resolvedAt: new Date() },
  });
  res.json({ ok: true });
});

export default router;
