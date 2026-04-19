import { Router } from 'express';
import { getDb } from '../../core/db/index.js';

const router = Router();

const ARRAY_FIELDS = [
  'industries', 'geography', 'stage', 'tech_stack', 'internal_capabilities',
  'impacted_kpis', 'initiator_roles', 'decision_roles', 'objections',
  'intent_signals', 'current_tools', 'workarounds', 'frustrations',
  'switching_barriers', 'hard_disqualifiers'
];
const SCALAR_FIELDS = [
  'company_size', 'revenue_range', 'budget_range',
  'problem_frequency', 'problem_cost', 'buying_process'
];

function serialize(row) {
  if (!row) return null;
  const out = { ...row };
  for (const f of ARRAY_FIELDS) {
    try { out[f] = out[f] ? JSON.parse(out[f]) : []; }
    catch { out[f] = []; }
  }
  return out;
}

router.get('/', (req, res) => {
  const row = getDb().prepare('SELECT * FROM icp_profile WHERE id = 1').get();
  res.json({ profile: serialize(row) });
});

router.put('/', (req, res) => {
  const body = req.body || {};

  for (const f of ARRAY_FIELDS) {
    if (f in body && !Array.isArray(body[f])) {
      return res.status(400).json({ error: `field ${f} must be an array` });
    }
  }

  const values = {};
  for (const f of SCALAR_FIELDS) values[f] = body[f] ?? null;
  for (const f of ARRAY_FIELDS) values[f] = JSON.stringify(body[f] || []);

  getDb().prepare(`
    UPDATE icp_profile SET
      industries=@industries, company_size=@company_size, revenue_range=@revenue_range,
      geography=@geography, stage=@stage, tech_stack=@tech_stack,
      internal_capabilities=@internal_capabilities, budget_range=@budget_range,
      problem_frequency=@problem_frequency, problem_cost=@problem_cost,
      impacted_kpis=@impacted_kpis, initiator_roles=@initiator_roles,
      decision_roles=@decision_roles, objections=@objections,
      buying_process=@buying_process, intent_signals=@intent_signals,
      current_tools=@current_tools, workarounds=@workarounds,
      frustrations=@frustrations, switching_barriers=@switching_barriers,
      hard_disqualifiers=@hard_disqualifiers, updated_at=datetime('now')
    WHERE id = 1
  `).run(values);

  res.json({ ok: true });
});

export default router;
