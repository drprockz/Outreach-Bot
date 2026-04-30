import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { exec, execSubscription, ok, err, mockDb } from './_executor.js'

describe('bulkRetry resolvers', () => {
  describe('Query.bulkRetryEstimate', () => {
    it('rejects unknown stage', async () => {
      const result = await exec({
        query: 'query E { bulkRetryEstimate(stage: "nope", leadIds: [1]) { count } }',
        db: mockDb({}),
      })
      expect(err(result)).toMatch(/invalid_stage/)
    })

    it('rejects empty leadIds', async () => {
      const result = await exec({
        query: 'query E { bulkRetryEstimate(stage: "verify_email", leadIds: []) { count } }',
        db: mockDb({}),
      })
      expect(err(result)).toMatch(/no_lead_ids/)
    })

    it('rejects batch larger than 25', async () => {
      const ids = Array.from({ length: 26 }, (_, i) => i + 1)
      const result = await exec({
        query: 'query E($ids: [Int!]!) { bulkRetryEstimate(stage: "verify_email", leadIds: $ids) { count } }',
        variables: { ids },
        db: mockDb({}),
      })
      expect(err(result)).toMatch(/batch_too_large/)
    })

    it('verify_email uses MEV fallback constant and reports estimateQuality=normal (count=999)', async () => {
      // No DB hits expected for verify_email — the MEV fallback short-circuits.
      const db = mockDb({})
      const result = await exec({
        query: 'query E { bulkRetryEstimate(stage: "verify_email", leadIds: [1,2,3]) { count estimatedCostUsd estimateQuality stage } }',
        db,
      })
      const data = ok<{ bulkRetryEstimate: { count: number; estimatedCostUsd: number; estimateQuality: string; stage: string } }>(result)
      expect(data.bulkRetryEstimate).toMatchObject({ count: 3, stage: 'verify_email', estimateQuality: 'normal' })
      expect(data.bulkRetryEstimate.estimatedCostUsd).toBeGreaterThan(0)
    })

    it('regen_hook with <5 historical rows reports estimateQuality=low', async () => {
      const findMany = vi.fn(async () => [
        { hookCostUsd: 0.001, bodyCostUsd: 0.0005 },
        { hookCostUsd: 0.002, bodyCostUsd: 0.001 },
      ])
      const db = mockDb({ email: { findMany } })
      const result = await exec({
        query: 'query E { bulkRetryEstimate(stage: "regen_hook", leadIds: [1,2]) { estimateQuality count } }',
        db,
      })
      const data = ok<{ bulkRetryEstimate: { estimateQuality: string; count: number } }>(result)
      expect(data.bulkRetryEstimate.estimateQuality).toBe('low')
      expect(data.bulkRetryEstimate.count).toBe(2)
    })

    it('regen_hook with >=5 historical rows reports estimateQuality=normal', async () => {
      const rows = Array.from({ length: 8 }, (_, i) => ({
        hookCostUsd: 0.001 + i * 0.0001,
        bodyCostUsd: 0.0005,
      }))
      const findMany = vi.fn(async () => rows)
      const db = mockDb({ email: { findMany } })
      const result = await exec({
        query: 'query E { bulkRetryEstimate(stage: "regen_hook", leadIds: [1,2,3]) { estimateQuality } }',
        db,
      })
      expect(ok<{ bulkRetryEstimate: { estimateQuality: string } }>(result).bulkRetryEstimate.estimateQuality).toBe('normal')
    })
  })

  describe('Subscription.bulkRetryRun', () => {
    let originalFlag: string | undefined
    beforeEach(() => {
      originalFlag = process.env.BULK_RETRY_ENABLED
    })
    afterEach(() => {
      if (originalFlag === undefined) delete process.env.BULK_RETRY_ENABLED
      else process.env.BULK_RETRY_ENABLED = originalFlag
    })

    it('refuses to start when BULK_RETRY_ENABLED is not "true"', async () => {
      process.env.BULK_RETRY_ENABLED = 'false'
      const events = await execSubscription({
        query: 'subscription S { bulkRetryRun(stage: "verify_email", leadIds: [1]) { status } }',
        db: mockDb({ lead: { findMany: vi.fn(async () => []) } }),
      })
      // Yoga returns one event with the error in `errors`
      expect(events.length).toBeGreaterThan(0)
      const allErrors = events.flatMap((e) => e.errors ?? [])
      expect(allErrors.some((e) => /bulk_retry_disabled/.test(e.message))).toBe(true)
    })

    it('emits one event per lead + a final {status: done} sentinel (errors are swallowed per-lead, sentinel still fires)', async () => {
      process.env.BULK_RETRY_ENABLED = 'true'

      // The resolver dynamically imports legacy pipeline helpers via a runtime
      // `import(<path>)` call. vitest's doMock doesn't intercept that path, so
      // instead we exercise the per-lead error-catching path: mock the lead
      // findMany to return a lead WITHOUT a contactEmail — verify_email will
      // throw `no_contact_email` and the resolver should yield an error event
      // for that lead, then the `done` sentinel.
      const findMany = vi.fn(async () => [
        { id: 10, contactEmail: null },
      ])
      const errorCreate = vi.fn(async () => ({}))
      const db = mockDb({
        lead: { findMany, update: vi.fn() },
        config: { findUnique: vi.fn(async () => null) },
        errorLog: { create: errorCreate },
      })

      const events = await execSubscription({
        query: 'subscription S { bulkRetryRun(stage: "verify_email", leadIds: [10]) { leadId status error } }',
        db,
      })

      const payloads = events
        .map((e) => (e.data as { bulkRetryRun?: { leadId: number | null; status: string; error: string | null } } | undefined)?.bulkRetryRun)
        .filter((p): p is NonNullable<typeof p> => !!p)
      // First payload: per-lead error
      expect(payloads[0]).toMatchObject({ leadId: 10, status: 'error' })
      expect(payloads[0].error).toMatch(/no_contact_email/)
      // Last payload: done sentinel
      expect(payloads[payloads.length - 1]).toMatchObject({ leadId: null, status: 'done' })
      // ErrorLog row was written for the failed lead
      expect(errorCreate).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          source: 'bulk_retry',
          errorType: 'verify_email',
          leadId: 10,
        }),
      }))
    })
  })
})
