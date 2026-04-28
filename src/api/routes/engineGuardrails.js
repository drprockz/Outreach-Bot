import { Router } from 'express';
import {
  guardrailKeysFor, validateGuardrailPayload, parseStoredValue,
} from '../../core/config/guardrailsSchema.js';

const router = Router();

router.get('/:engineName/guardrails', async (req, res) => {
  const keys = guardrailKeysFor(req.params.engineName);
  if (keys.length === 0) return res.json({});
  const rows = await req.db.config.findMany({ where: { key: { in: keys } } });
  const out = {};
  for (const row of rows) {
    out[row.key] = parseStoredValue(row.key, row.value);
  }
  res.json(out);
});

router.put('/:engineName/guardrails', async (req, res) => {
  const { engineName } = req.params;
  try {
    validateGuardrailPayload(engineName, req.body || {});
  } catch (err) {
    return res.status(400).json({ error: err.message, field: err.field });
  }
  for (const [key, value] of Object.entries(req.body)) {
    const stored = typeof value === 'string' || typeof value === 'number'
      ? String(value)
      : JSON.stringify(value);
    await req.db.config.upsert({
      where: { key },
      create: { key, value: stored },
      update: { value: stored },
    });
  }
  const keys = guardrailKeysFor(engineName);
  const rows = await req.db.config.findMany({ where: { key: { in: keys } } });
  const data = {};
  for (const row of rows) data[row.key] = parseStoredValue(row.key, row.value);
  res.json({ ok: true, data });
});

export default router;
