import { describe, it, expect, vi } from 'vitest'
import { exec, ok, err, mockDb } from './_executor.js'

const isoDate = () => new Date('2026-04-30T00:00:00Z')

describe('offer resolvers', () => {
  describe('Query.offer', () => {
    it('returns the empty-shape sentinel when no row exists', async () => {
      const findFirst = vi.fn(async () => null)
      const db = mockDb({ offer: { findFirst } })
      const result = await exec({ query: '{ offer { id problem useCases triggers } }', db })
      const data = ok<{ offer: { id: number | null; problem: string | null; useCases: string[]; triggers: string[] } }>(result)
      expect(data.offer).toEqual({ id: null, problem: null, useCases: [], triggers: [] })
    })

    it('rejects unauthenticated callers', async () => {
      const result = await exec({ query: '{ offer { id } }', user: null, db: mockDb({}) })
      expect(err(result)).toMatch(/Unauthenticated/)
    })
  })

  describe('Mutation.updateOffer', () => {
    it('creates the offer row when none exists (find-then-create)', async () => {
      const findFirst = vi.fn(async () => null)
      const create = vi.fn(async (args) => ({
        id: 1, ...args.data, updatedAt: isoDate(),
      }))
      const update = vi.fn()
      const db = mockDb({ offer: { findFirst, create, update } })
      await exec({
        query: 'mutation U { updateOffer(problem: "p", outcome: "o", useCases: ["a","b"]) { id problem } }',
        db,
      })
      expect(create).toHaveBeenCalledTimes(1)
      expect(update).not.toHaveBeenCalled()
      expect(create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ problem: 'p', outcome: 'o', useCases: ['a', 'b'] }),
      }))
    })

    it('updates the offer row when one exists (find-then-update)', async () => {
      const findFirst = vi.fn(async () => ({ id: 7 }))
      const create = vi.fn()
      const update = vi.fn(async () => ({
        id: 7, problem: 'new problem', outcome: null, category: null,
        useCases: [], triggers: [], alternatives: [],
        differentiation: null, priceRange: null, salesCycle: null,
        criticality: null, inactionCost: null,
        requiredInputs: [], proofPoints: [], updatedAt: isoDate(),
      }))
      const db = mockDb({ offer: { findFirst, create, update } })
      await exec({
        query: 'mutation U { updateOffer(problem: "new problem") { id } }',
        db,
      })
      expect(update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 7 },
        data: expect.objectContaining({ problem: 'new problem' }),
      }))
      expect(create).not.toHaveBeenCalled()
    })
  })
})
