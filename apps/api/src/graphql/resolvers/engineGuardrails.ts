import { prisma } from 'shared'
import { builder } from '../builder.js'
import { requireAuth } from '../guards.js'
import {
  guardrailKeysFor,
  parseStoredValue,
  validateGuardrailPayload,
  GuardrailValidationError,
} from '../lib/guardrailsSchema.js'

type DB = typeof prisma

// Guardrails are heterogeneous (strings, ints, arrays, objects keyed by engine).
// Surface as a JSON-encoded string and let the caller parse — matches how the
// dashboard's GuardrailsPanel already handles the legacy REST response.
builder.queryField('engineGuardrails', (t) =>
  t.field({
    type: 'String',
    args: { engineName: t.arg.string({ required: true }) },
    resolve: async (_root, { engineName }, ctx) => {
      requireAuth(ctx)
      const keys = guardrailKeysFor(engineName)
      if (keys.length === 0) return '{}'
      const db = ctx.db as DB
      const rows = await db.config.findMany({ where: { key: { in: keys } } })
      const out: Record<string, unknown> = {}
      for (const row of rows) {
        out[row.key] = parseStoredValue(row.key, row.value)
      }
      return JSON.stringify(out)
    },
  }),
)

builder.mutationField('updateEngineGuardrails', (t) =>
  t.field({
    type: 'String',
    args: {
      engineName: t.arg.string({ required: true }),
      payloadJson: t.arg.string({ required: true }),
    },
    resolve: async (_root, { engineName, payloadJson }, ctx) => {
      requireAuth(ctx)
      let payload: Record<string, unknown>
      try {
        payload = JSON.parse(payloadJson)
      } catch {
        throw new Error('payloadJson must be valid JSON')
      }
      try {
        validateGuardrailPayload(engineName, payload)
      } catch (err) {
        if (err instanceof GuardrailValidationError && err.field) {
          throw new Error(`${err.message} (field: ${err.field})`)
        }
        throw err
      }
      const db = ctx.db as DB
      for (const [key, value] of Object.entries(payload)) {
        const stored = typeof value === 'string' || typeof value === 'number'
          ? String(value)
          : JSON.stringify(value)
        await db.config.upsert({
          where: { key },
          create: { key, value: stored },
          update: { value: stored },
        })
      }
      const keys = guardrailKeysFor(engineName)
      const rows = await db.config.findMany({ where: { key: { in: keys } } })
      const out: Record<string, unknown> = {}
      for (const row of rows) out[row.key] = parseStoredValue(row.key, row.value)
      return JSON.stringify(out)
    },
  }),
)
