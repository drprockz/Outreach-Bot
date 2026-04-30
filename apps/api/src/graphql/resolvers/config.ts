import { prisma } from 'shared'
import { builder } from '../builder.js'
import { requireAuth } from '../guards.js'

type DB = typeof prisma

type ConfigEntryShape = { key: string; value: string | null }

const ConfigEntry = builder.objectRef<ConfigEntryShape>('ConfigEntry')
builder.objectType(ConfigEntry, {
  fields: (t) => ({
    key: t.exposeString('key'),
    value: t.string({ nullable: true, resolve: (e) => e.value }),
  }),
})

builder.queryField('config', (t) =>
  t.field({
    type: [ConfigEntry],
    resolve: async (_root, _args, ctx) => {
      requireAuth(ctx)
      const db = ctx.db as DB
      const rows = await db.config.findMany()
      return rows.map((r) => ({ key: r.key, value: r.value }))
    },
  }),
)

const ICP_WEIGHT_KEYS = ['firmographic', 'problem', 'intent', 'tech', 'economic', 'buying'] as const

builder.mutationField('updateConfig', (t) =>
  t.field({
    type: 'Boolean',
    args: {
      // JSON-encoded { [key]: stringValue } map. Mirrors legacy PUT /api/config body.
      updatesJson: t.arg.string({ required: true }),
    },
    resolve: async (_root, { updatesJson }, ctx) => {
      requireAuth(ctx)
      let updates: Record<string, unknown>
      try {
        updates = JSON.parse(updatesJson)
      } catch {
        throw new Error('updatesJson must be valid JSON')
      }
      if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
        throw new Error('updatesJson must be a JSON object')
      }

      // Validate icp_weights JSON structure if provided
      if ('icp_weights' in updates) {
        let parsed: Record<string, number>
        try {
          parsed = JSON.parse(String(updates.icp_weights))
        } catch {
          throw new Error('icp_weights must be valid JSON')
        }
        if (!ICP_WEIGHT_KEYS.every((k) => Number.isFinite(parsed[k]) && parsed[k] >= 0)) {
          throw new Error(`icp_weights must contain non-negative finite numbers: ${ICP_WEIGHT_KEYS.join(', ')}`)
        }
        const sum = ICP_WEIGHT_KEYS.reduce((a, k) => a + parsed[k], 0)
        if (sum !== 100) throw new Error(`icp_weights values must sum to 100 (got ${sum})`)
      }

      const db = ctx.db as DB
      for (const [key, value] of Object.entries(updates)) {
        await db.config.upsert({
          where: { key },
          create: { key, value: String(value) },
          update: { value: String(value) },
        })
      }
      return true
    },
  }),
)
