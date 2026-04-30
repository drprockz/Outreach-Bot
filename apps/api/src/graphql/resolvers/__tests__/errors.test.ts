import { describe, it, expect, vi } from 'vitest'
import { exec, ok, err, mockDb } from './_executor.js'

const isoDate = (d = '2026-04-30T12:00:00Z') => new Date(d)

describe('errors resolvers', () => {
  describe('Query.errors', () => {
    it('passes filter args through to Prisma where clause', async () => {
      const findMany = vi.fn(async () => [])
      const count = vi.fn(async () => 0)
      const db = mockDb({ errorLog: { findMany, count } })
      await exec({
        query: 'query E { errors(source: "send", errorType: "smtp", resolved: false, dateFrom: "2026-04-01", dateTo: "2026-04-30") { unresolvedCount } }',
        db,
      })
      const findCallArg = (findMany.mock.calls[0] as unknown as [unknown])[0] as { where: Record<string, unknown>; orderBy: unknown; take: number }
      expect(findCallArg.where).toMatchObject({
        source: 'send',
        errorType: 'smtp',
        resolved: false,
      })
      expect((findCallArg.where as { occurredAt?: unknown }).occurredAt).toBeDefined()
      expect(findCallArg.orderBy).toEqual({ occurredAt: 'desc' })
      expect(findCallArg.take).toBe(200)
      // unresolvedCount always counts WHERE resolved=false (independent of filters)
      expect(count).toHaveBeenCalledWith({ where: { resolved: false } })
    })

    it('returns shaped errors with unresolvedCount', async () => {
      const findMany = vi.fn(async () => [
        { id: 1, occurredAt: isoDate(), source: 'send', jobName: 'sendEmails',
          errorType: 'smtp', errorCode: '5.7.1', errorMessage: 'blocked',
          stackTrace: null, leadId: 10, emailId: 20, resolved: false, resolvedAt: null },
      ])
      const count = vi.fn(async () => 3)
      const db = mockDb({ errorLog: { findMany, count } })
      const result = await exec({
        query: '{ errors { errors { id errorMessage resolved } unresolvedCount } }',
        db,
      })
      const data = ok<{ errors: { errors: { id: number; errorMessage: string; resolved: boolean }[]; unresolvedCount: number } }>(result)
      expect(data.errors.unresolvedCount).toBe(3)
      expect(data.errors.errors).toHaveLength(1)
      expect(data.errors.errors[0]).toMatchObject({ id: 1, errorMessage: 'blocked', resolved: false })
    })
  })

  describe('Mutation.resolveError', () => {
    it('marks the error resolved + sets resolvedAt', async () => {
      const findUnique = vi.fn(async () => ({ id: 5 }))
      const update = vi.fn(async () => ({}))
      const db = mockDb({ errorLog: { findUnique, update } })
      const result = await exec({ query: 'mutation R { resolveError(id: 5) }', db })
      expect(ok<{ resolveError: boolean }>(result).resolveError).toBe(true)
      expect(update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 5 },
        data: expect.objectContaining({ resolved: true }),
      }))
    })

    it('throws when error row not found', async () => {
      const findUnique = vi.fn(async () => null)
      const result = await exec({
        query: 'mutation R { resolveError(id: 99) }',
        db: mockDb({ errorLog: { findUnique, update: vi.fn() } }),
      })
      expect(err(result)).toMatch(/not found/i)
    })
  })
})
