import { Router } from 'express';
import { prisma } from '../../core/db/index.js';
import { serializeReply } from './leads.js';

const router = Router();

router.get('/', async (req, res) => {
  const rows = await prisma.reply.findMany({
    include: { lead: { select: { businessName: true, contactName: true, contactEmail: true } } },
    orderBy: { receivedAt: 'desc' },
  });

  // Custom sort: hot/schedule first, then by receivedAt desc (already ordered)
  rows.sort((a, b) => {
    const aPri = (a.category === 'hot' || a.category === 'schedule') ? 0 : 1;
    const bPri = (b.category === 'hot' || b.category === 'schedule') ? 0 : 1;
    if (aPri !== bPri) return aPri - bPri;
    return (b.receivedAt?.getTime() || 0) - (a.receivedAt?.getTime() || 0);
  });

  const replies = rows.map(r => ({
    ...serializeReply(r),
    business_name: r.lead?.businessName ?? null,
    contact_name: r.lead?.contactName ?? null,
    contact_email: r.lead?.contactEmail ?? null,
  }));

  res.json({ replies });
});

router.patch('/:id/action', async (req, res) => {
  const id = parseInt(req.params.id);
  const { action } = req.body || {};

  if (!action) return res.status(400).json({ error: 'action is required' });

  const reply = await prisma.reply.findUnique({ where: { id }, select: { id: true } });
  if (!reply) return res.status(404).json({ error: 'Reply not found' });

  await prisma.reply.update({
    where: { id },
    data: { actionedAt: new Date(), actionTaken: action },
  });
  res.json({ ok: true });
});

router.post('/:id/reject', async (req, res) => {
  const id = parseInt(req.params.id);

  const reply = await prisma.reply.findUnique({
    where: { id },
    select: { leadId: true, lead: { select: { contactEmail: true } } },
  });
  if (!reply) return res.status(404).json({ error: 'Reply not found' });

  const email = reply.lead?.contactEmail;
  if (email) {
    const domain = email.split('@')[1];
    await prisma.rejectList.upsert({
      where: { email },
      create: { email, domain, reason: 'manual' },
      update: {},
    });
  }

  if (reply.leadId) {
    await prisma.lead.update({ where: { id: reply.leadId }, data: { status: 'unsubscribed' } });
    await prisma.sequenceState.updateMany({
      where: { leadId: reply.leadId },
      data: { status: 'unsubscribed', updatedAt: new Date() },
    });
  }

  res.json({ ok: true });
});

export default router;
