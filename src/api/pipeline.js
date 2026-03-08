import { Router } from 'express';
import { getPipelineGrouped, getPipelineLeadDetail, updatePipelineStatus } from '../../db/database.js';

const router = Router();

router.get('/', (req, res) => {
  const leads = getPipelineGrouped();
  // Group by status
  const grouped = {};
  for (const lead of leads) {
    if (!grouped[lead.status]) grouped[lead.status] = [];
    grouped[lead.status].push(lead);
  }
  res.json(grouped);
});

router.get('/:id', (req, res) => {
  const detail = getPipelineLeadDetail(parseInt(req.params.id, 10));
  if (!detail) return res.status(404).json({ error: 'Lead not found' });
  res.json(detail);
});

router.patch('/:id/status', (req, res) => {
  const { status } = req.body;
  const validStatuses = ['cold', 'contacted', 'hot', 'schedule', 'soft', 'closed', 'rejected', 'dormant'];
  if (!status || !validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  updatePipelineStatus(parseInt(req.params.id, 10), status);
  res.json({ success: true });
});

export default router;
