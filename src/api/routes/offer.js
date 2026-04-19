import { Router } from 'express';
import { getDb, logError } from '../../core/db/index.js';

const router = Router();

const ARRAY_FIELDS = ['use_cases', 'triggers', 'alternatives', 'required_inputs', 'proof_points'];
const SCALAR_FIELDS = [
  'problem', 'outcome', 'category', 'differentiation',
  'price_range', 'sales_cycle', 'criticality', 'inaction_cost'
];

function serialize(row) {
  if (!row) return null;
  const out = { ...row };
  for (const f of ARRAY_FIELDS) {
    try { out[f] = out[f] ? JSON.parse(out[f]) : []; }
    catch (err) {
      logError('api.offer.serialize', err, { rawField: f, rawValue: String(out[f]).slice(0, 200) });
      out[f] = [];
    }
  }
  return out;
}

router.get('/', (req, res) => {
  const row = getDb().prepare('SELECT * FROM offer WHERE id = 1').get();
  res.json({ offer: serialize(row) });
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
    UPDATE offer SET
      problem=@problem, outcome=@outcome, category=@category,
      use_cases=@use_cases, triggers=@triggers, alternatives=@alternatives,
      differentiation=@differentiation, price_range=@price_range,
      sales_cycle=@sales_cycle, criticality=@criticality,
      inaction_cost=@inaction_cost, required_inputs=@required_inputs,
      proof_points=@proof_points, updated_at=datetime('now')
    WHERE id = 1
  `).run(values);

  res.json({ ok: true });
});

export default router;
