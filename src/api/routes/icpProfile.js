import { Router } from 'express';
import { prisma } from '../../core/db/index.js';

const router = Router();

const ARRAY_FIELDS = [
  'industries', 'geography', 'stage', 'tech_stack', 'internal_capabilities',
  'impacted_kpis', 'initiator_roles', 'decision_roles', 'objections',
  'intent_signals', 'current_tools', 'workarounds', 'frustrations',
  'switching_barriers', 'hard_disqualifiers'
];

function serialize(row) {
  if (!row) return null;
  return {
    id: row.id,
    industries: row.industries || [],
    company_size: row.companySize,
    revenue_range: row.revenueRange,
    geography: row.geography || [],
    stage: row.stage || [],
    tech_stack: row.techStack || [],
    internal_capabilities: row.internalCapabilities || [],
    budget_range: row.budgetRange,
    problem_frequency: row.problemFrequency,
    problem_cost: row.problemCost,
    impacted_kpis: row.impactedKpis || [],
    initiator_roles: row.initiatorRoles || [],
    decision_roles: row.decisionRoles || [],
    objections: row.objections || [],
    buying_process: row.buyingProcess,
    intent_signals: row.intentSignals || [],
    current_tools: row.currentTools || [],
    workarounds: row.workarounds || [],
    frustrations: row.frustrations || [],
    switching_barriers: row.switchingBarriers || [],
    hard_disqualifiers: row.hardDisqualifiers || [],
    updated_at: row.updatedAt,
  };
}

router.get('/', async (req, res) => {
  const row = await prisma.icpProfile.findUnique({ where: { id: 1 } });
  res.json({ profile: serialize(row) });
});

router.put('/', async (req, res) => {
  const body = req.body || {};

  for (const f of ARRAY_FIELDS) {
    if (f in body && !Array.isArray(body[f])) {
      return res.status(400).json({ error: `field ${f} must be an array` });
    }
  }

  const data = {
    industries: body.industries || [],
    companySize: body.company_size ?? null,
    revenueRange: body.revenue_range ?? null,
    geography: body.geography || [],
    stage: body.stage || [],
    techStack: body.tech_stack || [],
    internalCapabilities: body.internal_capabilities || [],
    budgetRange: body.budget_range ?? null,
    problemFrequency: body.problem_frequency ?? null,
    problemCost: body.problem_cost ?? null,
    impactedKpis: body.impacted_kpis || [],
    initiatorRoles: body.initiator_roles || [],
    decisionRoles: body.decision_roles || [],
    objections: body.objections || [],
    buyingProcess: body.buying_process ?? null,
    intentSignals: body.intent_signals || [],
    currentTools: body.current_tools || [],
    workarounds: body.workarounds || [],
    frustrations: body.frustrations || [],
    switchingBarriers: body.switching_barriers || [],
    hardDisqualifiers: body.hard_disqualifiers || [],
    updatedAt: new Date(),
  };

  await prisma.icpProfile.upsert({
    where: { id: 1 },
    create: { id: 1, ...data },
    update: data,
  });

  res.json({ ok: true });
});

export default router;
