import { Router } from 'express';
import { prisma } from '../../core/db/index.js';

const router = Router();

function serialize(s) {
  return {
    id: s.id,
    lead_id: s.leadId,
    current_step: s.currentStep,
    next_send_date: s.nextSendDate,
    last_sent_at: s.lastSentAt,
    last_message_id: s.lastMessageId,
    last_subject: s.lastSubject,
    status: s.status,
    paused_reason: s.pausedReason,
    updated_at: s.updatedAt,
    business_name: s.lead?.businessName ?? null,
    contact_name: s.lead?.contactName ?? null,
    contact_email: s.lead?.contactEmail ?? null,
  };
}

router.get('/', async (req, res) => {
  const rows = await prisma.sequenceState.findMany({
    include: { lead: { select: { businessName: true, contactName: true, contactEmail: true } } },
    orderBy: { updatedAt: 'desc' },
  });

  const counts = await prisma.sequenceState.groupBy({
    by: ['status'],
    _count: { _all: true },
  });
  const agg = {
    active: 0, paused: 0, completed: 0, replied: 0, unsubscribed: 0,
  };
  for (const c of counts) {
    if (c.status in agg) agg[c.status] = c._count._all;
  }

  res.json({ sequences: rows.map(serialize), aggregates: agg });
});

export default router;
