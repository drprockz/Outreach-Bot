import { describe, it, expect, vi } from 'vitest'
import { exec, ok, mockDb } from './_executor.js'

describe('cronStatus resolvers', () => {
  it('Query.cronStatus returns the JOB_SCHEDULE table tagged with today\'s logs', async () => {
    const findMany = vi.fn(async () => [
      { id: 1, jobName: 'findLeads', startedAt: new Date('2026-04-30T03:30:00Z'),
        completedAt: new Date('2026-04-30T03:35:00Z'), status: 'success',
        durationMs: 300_000, errorMessage: null, recordsProcessed: 34, recordsSkipped: 116,
        costUsd: 0.42, scheduledAt: null, notes: null },
    ])
    const db = mockDb({ cronLog: { findMany } })
    const result = await exec({
      query: '{ cronStatus { date jobs { name status time log { id status recordsProcessed } } } }',
      db,
    })
    const data = ok<{
      cronStatus: { date: string; jobs: { name: string; status: string; log: null | { id: number; status: string; recordsProcessed: number } }[] }
    }>(result)
    const findLeads = data.cronStatus.jobs.find((j) => j.name === 'findLeads')
    expect(findLeads).toBeDefined()
    expect(findLeads!.log?.recordsProcessed).toBe(34)
    expect(findLeads!.status).toBe('success')
  })

  it('Query.cronJobHistory returns up to 30 most-recent log rows', async () => {
    const findMany = vi.fn(async () => [
      { id: 9, jobName: 'sendEmails', startedAt: new Date(), completedAt: null, status: 'running',
        durationMs: null, errorMessage: null, recordsProcessed: null, recordsSkipped: null,
        costUsd: null, scheduledAt: null, notes: null },
    ])
    const db = mockDb({ cronLog: { findMany } })
    const result = await exec({
      query: 'query H { cronJobHistory(jobName: "sendEmails") { id jobName status } }',
      db,
    })
    const data = ok<{ cronJobHistory: { id: number; jobName: string; status: string }[] }>(result)
    expect(data.cronJobHistory).toHaveLength(1)
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { jobName: 'sendEmails' },
      orderBy: { startedAt: 'desc' },
      take: 30,
    }))
  })
})
