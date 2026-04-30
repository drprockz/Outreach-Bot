import { describe, it, expect, vi } from 'vitest'
import { exec, ok, err, mockDb } from './_executor.js'

describe('runEngine resolvers', () => {
  describe('Mutation.runEngine', () => {
    it('rejects unknown engine names', async () => {
      const result = await exec({
        query: 'mutation R { runEngine(engineName: "doesNotExist") { jobId } }',
        db: mockDb({ cronLog: { findFirst: vi.fn(async () => null), updateMany: vi.fn(async () => ({ count: 0 })) } }),
      })
      expect(err(result)).toMatch(/Unknown.*engine/i)
    })

    it('throws when an in-flight cron_log row is already running', async () => {
      const db = mockDb({
        cronLog: {
          updateMany: vi.fn(async () => ({ count: 0 })),
          findFirst: vi.fn(async () => ({ id: 5, startedAt: new Date('2026-04-30T03:00:00Z') })),
        },
      })
      const result = await exec({
        query: 'mutation R { runEngine(engineName: "findLeads") { jobId } }',
        db,
      })
      expect(err(result)).toMatch(/already running/i)
    })

    it('sweeps stale locks (returns recoveredStaleLocks count) before queuing', async () => {
      const updateMany = vi.fn(async () => ({ count: 2 }))
      const findFirst = vi.fn(async () => null)
      const db = mockDb({ cronLog: { updateMany, findFirst } })
      const result = await exec({
        query: 'mutation R { runEngine(engineName: "findLeads", leadsCount: 10, perBatch: 5) { engineName jobId status overrideJson recoveredStaleLocks } }',
        db,
      })
      const data = ok<{ runEngine: { engineName: string; jobId: string; status: string; overrideJson: string; recoveredStaleLocks: number } }>(result)
      expect(data.runEngine.engineName).toBe('findLeads')
      expect(data.runEngine.status).toBe('queued')
      expect(data.runEngine.recoveredStaleLocks).toBe(2)
      expect(JSON.parse(data.runEngine.overrideJson)).toEqual({ leadsCount: 10, perBatch: 5 })
    })
  })

  describe('Mutation.unlockEngine', () => {
    it('marks all running cron_logs for the engine as failed and returns the count', async () => {
      const updateMany = vi.fn(async () => ({ count: 3 }))
      const db = mockDb({ cronLog: { updateMany } })
      const result = await exec({ query: 'mutation U { unlockEngine(engineName: "sendEmails") }', db })
      expect(ok<{ unlockEngine: number }>(result).unlockEngine).toBe(3)
      expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { jobName: 'sendEmails', status: 'running' },
        data: expect.objectContaining({ status: 'failed' }),
      }))
    })

    it('rejects unknown engine names', async () => {
      const db = mockDb({ cronLog: { updateMany: vi.fn() } })
      const result = await exec({ query: 'mutation U { unlockEngine(engineName: "nope") }', db })
      expect(err(result)).toMatch(/Unknown engine/)
    })
  })

  describe('Query.engineLatest', () => {
    it('returns null when no cron_log exists for the engine', async () => {
      const findFirst = vi.fn(async () => null)
      const db = mockDb({ cronLog: { findFirst } })
      const result = await exec({
        query: 'query L { engineLatest(engineName: "findLeads") { id status } }',
        db,
      })
      expect(ok<{ engineLatest: null }>(result).engineLatest).toBeNull()
    })

    it('returns the most-recent cron_log summary', async () => {
      const findFirst = vi.fn(async () => ({
        id: 99, jobName: 'findLeads', status: 'success',
        startedAt: new Date('2026-04-30T03:00:00Z'),
        completedAt: new Date('2026-04-30T03:05:00Z'),
        durationMs: 300_000, recordsProcessed: 34, recordsSkipped: 116,
        costUsd: 0.42, errorMessage: null,
      }))
      const db = mockDb({ cronLog: { findFirst } })
      const result = await exec({
        query: 'query L { engineLatest(engineName: "findLeads") { id status recordsProcessed costUsd } }',
        db,
      })
      const data = ok<{ engineLatest: { id: number; status: string; recordsProcessed: number; costUsd: number } }>(result)
      expect(data.engineLatest).toMatchObject({ id: 99, status: 'success', recordsProcessed: 34, costUsd: 0.42 })
    })
  })

  describe('Query.engineStats', () => {
    it('returns sample_size:0 sentinel when no successful runs exist', async () => {
      const findMany = vi.fn(async () => [])
      const db = mockDb({ cronLog: { findMany } })
      const result = await exec({
        query: 'query S { engineStats(engineName: "findLeads") { sampleSize avgCostPerLeadUsd avgDurationMs } }',
        db,
      })
      const data = ok<{ engineStats: { sampleSize: number; avgCostPerLeadUsd: null; avgDurationMs: null } }>(result)
      expect(data.engineStats.sampleSize).toBe(0)
      expect(data.engineStats.avgCostPerLeadUsd).toBeNull()
      expect(data.engineStats.avgDurationMs).toBeNull()
    })

    it('weighted avg cost is total_cost / total_leads (not naive mean of ratios)', async () => {
      const findMany = vi.fn(async () => [
        { costUsd: 1.0, recordsProcessed: 10, durationMs: 1000, completedAt: new Date('2026-04-30T03:00:00Z') }, // 0.10/lead
        { costUsd: 9.0, recordsProcessed: 90, durationMs: 9000, completedAt: new Date('2026-04-30T02:00:00Z') }, // 0.10/lead
      ])
      const db = mockDb({ cronLog: { findMany } })
      const result = await exec({
        query: 'query S { engineStats(engineName: "findLeads") { sampleSize avgCostPerLeadUsd avgDurationMs } }',
        db,
      })
      const data = ok<{ engineStats: { sampleSize: number; avgCostPerLeadUsd: number; avgDurationMs: number } }>(result)
      expect(data.engineStats.sampleSize).toBe(2)
      expect(data.engineStats.avgCostPerLeadUsd).toBeCloseTo(10 / 100, 4)
      expect(data.engineStats.avgDurationMs).toBe(5000)
    })
  })

  describe('Query.engineRunStatus', () => {
    it('returns null when cron_log id is not found', async () => {
      const findUnique = vi.fn(async () => null)
      const db = mockDb({
        cronLog: { findUnique },
        dailyMetrics: { findUnique: vi.fn(async () => null) },
      })
      const result = await exec({
        query: 'query S { engineRunStatus(cronLogId: 999) { cronLog { id } } }',
        db,
      })
      expect(ok<{ engineRunStatus: null }>(result).engineRunStatus).toBeNull()
    })
  })

  describe('Query.engineTodayCosts', () => {
    it('returns zero shape when daily_metrics has no row for today', async () => {
      const findUnique = vi.fn(async () => null)
      const db = mockDb({ dailyMetrics: { findUnique } })
      const result = await exec({
        query: '{ engineTodayCosts { date totalApiCostUsd leadsDiscovered emailsSent } }',
        db,
      })
      const data = ok<{ engineTodayCosts: { date: string; totalApiCostUsd: number; leadsDiscovered: number; emailsSent: number } }>(result)
      expect(data.engineTodayCosts.totalApiCostUsd).toBe(0)
      expect(data.engineTodayCosts.leadsDiscovered).toBe(0)
      expect(data.engineTodayCosts.emailsSent).toBe(0)
    })
  })
})
