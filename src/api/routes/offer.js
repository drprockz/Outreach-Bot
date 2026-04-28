import { Router } from 'express';

const router = Router();

const ARRAY_FIELDS = ['use_cases', 'triggers', 'alternatives', 'required_inputs', 'proof_points'];

function serialize(row) {
  if (!row) return null;
  return {
    id: row.id,
    problem: row.problem,
    outcome: row.outcome,
    category: row.category,
    use_cases: row.useCases || [],
    triggers: row.triggers || [],
    alternatives: row.alternatives || [],
    differentiation: row.differentiation,
    price_range: row.priceRange,
    sales_cycle: row.salesCycle,
    criticality: row.criticality,
    inaction_cost: row.inactionCost,
    required_inputs: row.requiredInputs || [],
    proof_points: row.proofPoints || [],
    updated_at: row.updatedAt,
  };
}

router.get('/', async (req, res) => {
  const row = await req.db.offer.findFirst({});
  res.json(serialize(row) || {});
});

router.put('/', async (req, res) => {
  const body = req.body || {};

  for (const f of ARRAY_FIELDS) {
    if (f in body && !Array.isArray(body[f])) {
      return res.status(400).json({ error: `field ${f} must be an array`, field: f });
    }
  }

  const data = {
    problem: body.problem ?? null,
    outcome: body.outcome ?? null,
    category: body.category ?? null,
    useCases: body.use_cases || [],
    triggers: body.triggers || [],
    alternatives: body.alternatives || [],
    differentiation: body.differentiation ?? null,
    priceRange: body.price_range ?? null,
    salesCycle: body.sales_cycle ?? null,
    criticality: body.criticality ?? null,
    inactionCost: body.inaction_cost ?? null,
    requiredInputs: body.required_inputs || [],
    proofPoints: body.proof_points || [],
    updatedAt: new Date(),
  };

  // The schema doesn't enforce one-offer-per-org with @@unique, so we look up
  // the org's existing row first (scoped client) and create-or-update.
  const existing = await req.db.offer.findFirst({ select: { id: true } });
  const saved = existing
    ? await req.db.offer.update({ where: { id: existing.id }, data })
    : await req.db.offer.create({ data });

  res.json({ ok: true, data: serialize(saved) });
});

export default router;
