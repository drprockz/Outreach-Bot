import { prisma, getConfigMap, getConfigInt } from '../../../core/db/index.js';
import { bucket } from '../../../core/ai/icpScorer.js';

const ALLOWED = new Set(['nurture', 'unsubscribed', 'reject', 'requeue']);
const TERMINAL = new Set(['bounced', 'replied']);

export async function bulkStatus(req, res) {
  const { leadIds, action } = req.body || {};
  if (!ALLOWED.has(action)) return res.status(400).json({ error: 'invalid_action' });
  if (!Array.isArray(leadIds) || leadIds.length === 0) return res.status(400).json({ error: 'no_lead_ids' });
  if (leadIds.length > 200) return res.status(400).json({ error: 'batch_too_large', max: 200 });

  let threshA = 70, threshB = 40;
  if (action === 'requeue') {
    const cfg = await getConfigMap();
    threshA = getConfigInt(cfg, 'icp_threshold_a', 70);
    threshB = getConfigInt(cfg, 'icp_threshold_b', 40);
  }

  const leads = await prisma.lead.findMany({
    where: { id: { in: leadIds } },
    include: { emails: { where: { sequenceStep: 0, status: 'pending' }, take: 1 } },
  });
  const updated = [];
  const skipped = [];

  for (const lead of leads) {
    if (TERMINAL.has(lead.status)) { skipped.push({ id: lead.id, reason: `terminal_${lead.status}` }); continue; }
    if (action === 'nurture') {
      await prisma.lead.update({ where: { id: lead.id }, data: { status: 'nurture' } });
      updated.push(lead.id);
    } else if (action === 'unsubscribed') {
      await prisma.lead.update({ where: { id: lead.id }, data: { status: 'unsubscribed' } });
      updated.push(lead.id);
    } else if (action === 'reject') {
      if (!lead.contactEmail) { skipped.push({ id: lead.id, reason: 'no_email' }); continue; }
      const domain = lead.contactEmail.split('@')[1] || null;
      await prisma.rejectList.upsert({
        where: { email: lead.contactEmail },
        update: {},
        create: { email: lead.contactEmail, domain, reason: 'manual_bulk_reject' },
      });
      await prisma.lead.update({ where: { id: lead.id }, data: { status: 'unsubscribed', inRejectList: true } });
      updated.push(lead.id);
    } else if (action === 'requeue') {
      if (!lead.emails.length) { skipped.push({ id: lead.id, reason: 'no_pending_email' }); continue; }
      const b = lead.icpScore != null ? bucket(lead.icpScore, threshA, threshB) : null;
      if (b === 'low') { skipped.push({ id: lead.id, reason: 'icp_c_cannot_queue' }); continue; }
      await prisma.lead.update({ where: { id: lead.id }, data: { status: 'ready' } });
      updated.push(lead.id);
    }
  }

  res.json({ updated: updated.length, updatedIds: updated, skipped });
}
