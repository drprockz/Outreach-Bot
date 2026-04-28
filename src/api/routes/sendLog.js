import { Router } from 'express';
import { serializeEmail } from './leads.js';

const router = Router();

router.get('/', async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const offset = (page - 1) * limit;

  const where = {};
  if (req.query.status) where.status = req.query.status;
  if (req.query.inbox) where.inboxUsed = req.query.inbox;
  if (req.query.step !== undefined) where.sequenceStep = parseInt(req.query.step);
  if (req.query.date_from) where.sentAt = { ...(where.sentAt || {}), gte: new Date(req.query.date_from) };
  if (req.query.date_to) where.sentAt = { ...(where.sentAt || {}), lte: new Date(req.query.date_to) };

  const [total, rows] = await Promise.all([
    req.db.email.count({ where }),
    req.db.email.findMany({
      where,
      orderBy: { id: 'desc' },
      take: limit,
      skip: offset,
      include: { lead: { select: { businessName: true, contactName: true, contactEmail: true } } },
    }),
  ]);

  const emails = rows.map(e => ({
    ...serializeEmail(e),
    business_name: e.lead?.businessName ?? null,
    contact_name: e.lead?.contactName ?? null,
    contact_email: e.lead?.contactEmail ?? null,
  }));

  // Aggregates
  const allRows = await req.db.email.findMany({
    where,
    select: {
      status: true,
      sendDurationMs: true,
      totalCostUsd: true,
    },
  });
  const totalSent = allRows.length;
  let hardBounces = 0, softBounces = 0, contentRejected = 0;
  let durSum = 0, durCount = 0, costSum = 0;
  for (const e of allRows) {
    if (e.status === 'hard_bounce') hardBounces++;
    if (e.status === 'soft_bounce') softBounces++;
    if (e.status === 'content_rejected') contentRejected++;
    if (e.sendDurationMs !== null && e.sendDurationMs !== undefined) { durSum += e.sendDurationMs; durCount++; }
    if (e.totalCostUsd !== null && e.totalCostUsd !== undefined) costSum += Number(e.totalCostUsd);
  }
  const agg = {
    total_sent: totalSent,
    hard_bounces: hardBounces,
    soft_bounces: softBounces,
    content_rejected: contentRejected,
    avg_duration_ms: durCount > 0 ? durSum / durCount : 0,
    total_cost: costSum,
  };

  res.json({ emails, total, page, limit, aggregates: agg });
});

export default router;
