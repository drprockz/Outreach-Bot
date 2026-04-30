import { describe, it, expect, vi } from 'vitest'
import { exec, ok, err, mockDb, fakeUser } from './_executor.js'

describe('config resolvers', () => {
  describe('Query.config', () => {
    it('returns rows from ctx.db.config.findMany', async () => {
      const db = mockDb({
        config: { findMany: vi.fn(async () => [
          { key: 'icp_threshold_a', value: '70' },
          { key: 'icp_threshold_b', value: '40' },
        ]) },
      })
      const result = await exec({ query: '{ config { key value } }', db })
      const data = ok<{ config: { key: string; value: string }[] }>(result)
      expect(data.config).toEqual([
        { key: 'icp_threshold_a', value: '70' },
        { key: 'icp_threshold_b', value: '40' },
      ])
    })

    it('rejects unauthenticated callers', async () => {
      const result = await exec({ query: '{ config { key value } }', user: null, db: mockDb({}) })
      expect(err(result)).toMatch(/Unauthenticated/)
    })
  })

  describe('Mutation.updateConfig', () => {
    it('upserts each key/value in the JSON payload', async () => {
      const upsert = vi.fn(async () => ({}))
      const db = mockDb({ config: { upsert } })
      const result = await exec({
        query: 'mutation U($u: String!) { updateConfig(updatesJson: $u) }',
        variables: { u: JSON.stringify({ daily_send_limit: '34', send_window_start_ist: '9' }) },
        db,
      })
      ok(result)
      expect(upsert).toHaveBeenCalledTimes(2)
      expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
        where: { key: 'daily_send_limit' },
        create: { key: 'daily_send_limit', value: '34' },
      }))
    })

    it('rejects malformed JSON', async () => {
      const result = await exec({
        query: 'mutation U($u: String!) { updateConfig(updatesJson: $u) }',
        variables: { u: 'not-json' },
        db: mockDb({ config: { upsert: vi.fn() } }),
      })
      expect(err(result)).toMatch(/must be valid JSON/)
    })

    it('rejects non-object JSON (arrays included)', async () => {
      const result = await exec({
        query: 'mutation U($u: String!) { updateConfig(updatesJson: $u) }',
        variables: { u: '[1,2,3]' },
        db: mockDb({ config: { upsert: vi.fn() } }),
      })
      expect(err(result)).toMatch(/must be a JSON object/)
    })

    it('validates icp_weights sums to 100', async () => {
      const result = await exec({
        query: 'mutation U($u: String!) { updateConfig(updatesJson: $u) }',
        variables: {
          u: JSON.stringify({
            icp_weights: JSON.stringify({
              firmographic: 10, problem: 10, intent: 10, tech: 10, economic: 10, buying: 10,
            }),
          }),
        },
        db: mockDb({ config: { upsert: vi.fn() } }),
      })
      expect(err(result)).toMatch(/sum to 100/)
    })

    it('accepts valid icp_weights and persists', async () => {
      const upsert = vi.fn(async () => ({}))
      const result = await exec({
        query: 'mutation U($u: String!) { updateConfig(updatesJson: $u) }',
        variables: {
          u: JSON.stringify({
            icp_weights: JSON.stringify({
              firmographic: 20, problem: 20, intent: 20, tech: 15, economic: 15, buying: 10,
            }),
          }),
        },
        db: mockDb({ config: { upsert } }),
      })
      ok(result)
      expect(upsert).toHaveBeenCalledOnce()
    })

    it('tenant isolation: each ctx.db is scoped to its caller', async () => {
      // OrgA and orgB resolve against their own ctx.db — neither call reaches
      // a shared store. The fakePrisma in _executor throws if a resolver bypasses
      // ctx.db, so this also locks down "no global prisma access".
      const upsertA = vi.fn(async () => ({}))
      const upsertB = vi.fn(async () => ({}))
      const dbA = mockDb({ config: { upsert: upsertA } })
      const dbB = mockDb({ config: { upsert: upsertB } })

      await exec({
        query: 'mutation U($u: String!) { updateConfig(updatesJson: $u) }',
        variables: { u: JSON.stringify({ a: '1' }) },
        user: fakeUser({ orgId: 1 }),
        db: dbA,
      })
      await exec({
        query: 'mutation U($u: String!) { updateConfig(updatesJson: $u) }',
        variables: { u: JSON.stringify({ b: '2' }) },
        user: fakeUser({ orgId: 2 }),
        db: dbB,
      })

      expect(upsertA).toHaveBeenCalledWith(expect.objectContaining({ where: { key: 'a' } }))
      expect(upsertA).not.toHaveBeenCalledWith(expect.objectContaining({ where: { key: 'b' } }))
      expect(upsertB).toHaveBeenCalledWith(expect.objectContaining({ where: { key: 'b' } }))
      expect(upsertB).not.toHaveBeenCalledWith(expect.objectContaining({ where: { key: 'a' } }))
    })
  })
})
