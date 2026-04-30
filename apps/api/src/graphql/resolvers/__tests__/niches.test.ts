import { describe, it, expect, vi } from 'vitest'
import { exec, ok, err, mockDb, fakeUser } from './_executor.js'

function isoDate() {
  return new Date('2026-04-30T00:00:00Z')
}

describe('niches resolvers', () => {
  describe('Query.niches', () => {
    it('returns rows ordered by sortOrder asc, id asc', async () => {
      const findMany = vi.fn(async () => [
        { id: 1, label: 'D2C', query: 'direct to consumer brands', dayOfWeek: 1, enabled: true, sortOrder: 0, createdAt: isoDate() },
        { id: 2, label: 'Real estate', query: 'real estate agencies', dayOfWeek: 2, enabled: true, sortOrder: 1, createdAt: isoDate() },
      ])
      const db = mockDb({ niche: { findMany } })
      const result = await exec({ query: '{ niches { id label query dayOfWeek enabled sortOrder } }', db })
      const data = ok<{ niches: { id: number; label: string }[] }>(result)
      expect(data.niches).toHaveLength(2)
      expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      }))
    })

    it('rejects unauthenticated callers', async () => {
      const result = await exec({ query: '{ niches { id } }', user: null, db: mockDb({}) })
      expect(err(result)).toMatch(/Unauthenticated/)
    })
  })

  describe('Mutation.createNiche', () => {
    it('rejects when query is < 10 chars', async () => {
      const result = await exec({
        query: 'mutation C { createNiche(label: "x", query: "short") { id } }',
        db: mockDb({ niche: { aggregate: vi.fn(), create: vi.fn(), updateMany: vi.fn() } }),
      })
      expect(err(result)).toMatch(/at least 10 characters/)
    })

    it('clears day_of_week from any other niche before assigning to new niche (singleton)', async () => {
      const aggregate = vi.fn(async () => ({ _max: { sortOrder: 4 } }))
      const updateMany = vi.fn(async () => ({ count: 1 }))
      const create = vi.fn(async () => ({
        id: 99, label: 'New', query: 'something long enough', dayOfWeek: 3,
        enabled: true, sortOrder: 5, createdAt: isoDate(),
      }))
      const db = mockDb({ niche: { aggregate, updateMany, create } })
      await exec({
        query: 'mutation C { createNiche(label: "New", query: "something long enough", dayOfWeek: 3) { id sortOrder } }',
        db,
      })
      // updateMany should clear dayOfWeek=3 from any other niche
      expect(updateMany).toHaveBeenCalledWith({
        where: { dayOfWeek: 3 },
        data: { dayOfWeek: null },
      })
      // sortOrder should be max+1
      expect(create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ sortOrder: 5, dayOfWeek: 3 }),
      }))
    })

    it('skips updateMany when dayOfWeek is null/unspecified', async () => {
      const aggregate = vi.fn(async () => ({ _max: { sortOrder: null } }))
      const updateMany = vi.fn(async () => ({ count: 0 }))
      const create = vi.fn(async () => ({
        id: 1, label: 'X', query: 'long enough', dayOfWeek: null,
        enabled: true, sortOrder: 0, createdAt: isoDate(),
      }))
      const db = mockDb({ niche: { aggregate, updateMany, create } })
      await exec({
        query: 'mutation C { createNiche(label: "X", query: "long enough text") { id } }',
        db,
      })
      expect(updateMany).not.toHaveBeenCalled()
      expect(create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ dayOfWeek: null, sortOrder: 0 }),
      }))
    })
  })

  describe('Mutation.updateNiche', () => {
    it('throws when niche not found', async () => {
      const findUnique = vi.fn(async () => null)
      const result = await exec({
        query: 'mutation U { updateNiche(id: 99, label: "x", query: "long enough text") { id } }',
        db: mockDb({ niche: { findUnique, updateMany: vi.fn(), update: vi.fn() } }),
      })
      expect(err(result)).toMatch(/not found/i)
    })

    it('clears day_of_week from siblings (excluding self) when reassigning', async () => {
      const findUnique = vi.fn(async () => ({ id: 1, sortOrder: 0 }))
      const updateMany = vi.fn(async () => ({ count: 1 }))
      const update = vi.fn(async () => ({
        id: 1, label: 'X', query: 'long enough text', dayOfWeek: 4,
        enabled: true, sortOrder: 0, createdAt: isoDate(),
      }))
      const db = mockDb({ niche: { findUnique, updateMany, update } })
      await exec({
        query: 'mutation U { updateNiche(id: 1, label: "X", query: "long enough text", dayOfWeek: 4) { id } }',
        db,
      })
      expect(updateMany).toHaveBeenCalledWith({
        where: { dayOfWeek: 4, id: { not: 1 } },
        data: { dayOfWeek: null },
      })
    })
  })

  describe('Mutation.deleteNiche', () => {
    it('returns true on successful delete', async () => {
      const findUnique = vi.fn(async () => ({ id: 7 }))
      const del = vi.fn(async () => ({}))
      const result = await exec({
        query: 'mutation D { deleteNiche(id: 7) }',
        db: mockDb({ niche: { findUnique, delete: del } }),
      })
      expect(ok<{ deleteNiche: boolean }>(result).deleteNiche).toBe(true)
      expect(del).toHaveBeenCalledWith({ where: { id: 7 } })
    })

    it('throws when niche not found', async () => {
      const findUnique = vi.fn(async () => null)
      const result = await exec({
        query: 'mutation D { deleteNiche(id: 99) }',
        db: mockDb({ niche: { findUnique, delete: vi.fn() } }),
      })
      expect(err(result)).toMatch(/not found/i)
    })
  })

  describe('tenant isolation', () => {
    it('orgA list does not return orgB rows (each ctx.db is independent)', async () => {
      const dbA = mockDb({ niche: { findMany: vi.fn(async () => [{ id: 1, label: 'A only', query: 'orgA query', dayOfWeek: null, enabled: true, sortOrder: 0, createdAt: isoDate() }]) } })
      const dbB = mockDb({ niche: { findMany: vi.fn(async () => [{ id: 99, label: 'B only', query: 'orgB query', dayOfWeek: null, enabled: true, sortOrder: 0, createdAt: isoDate() }]) } })

      const a = await exec({ query: '{ niches { label } }', user: fakeUser({ orgId: 1 }), db: dbA })
      const b = await exec({ query: '{ niches { label } }', user: fakeUser({ orgId: 2 }), db: dbB })

      expect(ok<{ niches: { label: string }[] }>(a).niches.map((n) => n.label)).toEqual(['A only'])
      expect(ok<{ niches: { label: string }[] }>(b).niches.map((n) => n.label)).toEqual(['B only'])
    })
  })
})
