import { describe, it, expect, vi } from 'vitest'
import { exec, ok, err, mockDb } from './_executor.js'

function isoDate() {
  return new Date('2026-04-30T10:00:00Z')
}

describe('savedViews resolvers', () => {
  describe('Query.savedViews', () => {
    it('returns rows ordered by updatedAt desc', async () => {
      const findMany = vi.fn(async () => [
        { id: 1, name: 'Hot leads', filtersJson: { status: ['ready'] }, sort: 'icp_desc', updatedAt: isoDate() },
      ])
      const db = mockDb({ savedView: { findMany } })
      const result = await exec({ query: '{ savedViews { id name filtersJson sort updatedAt } }', db })
      const data = ok<{ savedViews: { id: number; name: string; filtersJson: string }[] }>(result)
      expect(data.savedViews[0].name).toBe('Hot leads')
      // filtersJson should be a JSON-encoded string
      expect(JSON.parse(data.savedViews[0].filtersJson)).toEqual({ status: ['ready'] })
      expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { updatedAt: 'desc' } }))
    })

    it('rejects unauthenticated callers', async () => {
      const result = await exec({ query: '{ savedViews { id } }', user: null, db: mockDb({}) })
      expect(err(result)).toMatch(/Unauthenticated/)
    })
  })

  describe('Mutation.createSavedView', () => {
    it('parses filtersJson into Prisma JSON value before insert', async () => {
      const create = vi.fn(async () => ({ id: 1, name: 'X', filtersJson: { a: 1 }, sort: null, updatedAt: isoDate() }))
      const db = mockDb({ savedView: { create } })
      await exec({
        query: 'mutation C($n: String!, $f: String!) { createSavedView(name: $n, filtersJson: $f) { id } }',
        variables: { n: 'X', f: '{"a":1}' },
        db,
      })
      expect(create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ name: 'X', filtersJson: { a: 1 }, sort: null }),
      }))
    })

    it('rejects malformed filtersJson', async () => {
      const result = await exec({
        query: 'mutation C { createSavedView(name: "X", filtersJson: "not-json") { id } }',
        db: mockDb({ savedView: { create: vi.fn() } }),
      })
      expect(err(result)).toMatch(/must be valid JSON/)
    })
  })

  describe('Mutation.updateSavedView', () => {
    it('only updates fields that were provided', async () => {
      const update = vi.fn(async () => ({ id: 1, name: 'New name', filtersJson: {}, sort: null, updatedAt: isoDate() }))
      const db = mockDb({ savedView: { update } })
      await exec({
        query: 'mutation U { updateSavedView(id: 1, name: "New name") { id } }',
        db,
      })
      const callArg = (update.mock.calls[0] as unknown as [unknown])[0] as { where: unknown; data: unknown }
      expect(callArg.where).toEqual({ id: 1 })
      expect(callArg.data).toEqual({ name: 'New name' })
    })

    it('parses filtersJson when provided', async () => {
      const update = vi.fn(async () => ({ id: 1, name: 'X', filtersJson: { y: 2 }, sort: null, updatedAt: isoDate() }))
      const db = mockDb({ savedView: { update } })
      await exec({
        query: 'mutation U($f: String!) { updateSavedView(id: 1, filtersJson: $f) { id } }',
        variables: { f: '{"y":2}' },
        db,
      })
      const callArg = (update.mock.calls[0] as unknown as [unknown])[0] as { data: { filtersJson: unknown } }
      expect(callArg.data.filtersJson).toEqual({ y: 2 })
    })
  })

  describe('Mutation.deleteSavedView', () => {
    it('returns true after deletion', async () => {
      const del = vi.fn(async () => ({}))
      const db = mockDb({ savedView: { delete: del } })
      const result = await exec({ query: 'mutation D { deleteSavedView(id: 5) }', db })
      expect(ok<{ deleteSavedView: boolean }>(result).deleteSavedView).toBe(true)
      expect(del).toHaveBeenCalledWith({ where: { id: 5 } })
    })
  })
})
