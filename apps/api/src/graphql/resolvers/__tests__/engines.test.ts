import { describe, it, expect, vi } from 'vitest'
import { exec, ok, mockDb } from './_executor.js'

describe('engines resolver', () => {
  it('returns one row per defined engine, with enabled flag flipped from config', async () => {
    const cfgRows = [
      { key: 'find_leads_enabled', value: '0' },
      { key: 'send_emails_enabled', value: '1' },
    ]
    const db = mockDb({
      config: { findMany: vi.fn(async () => cfgRows) },
      cronLog: {
        findFirst: vi.fn(async () => null),
        aggregate: vi.fn(async () => ({ _sum: { costUsd: 0 } })),
      },
    })
    const result = await exec({ query: '{ engines { name enabled costToday lastRun { status } } }', db })
    const data = ok<{ engines: { name: string; enabled: boolean; costToday: number; lastRun: null }[] }>(result)
    const findLeads = data.engines.find((e) => e.name === 'findLeads')!
    const sendEmails = data.engines.find((e) => e.name === 'sendEmails')!
    expect(findLeads.enabled).toBe(false) // explicitly disabled
    expect(sendEmails.enabled).toBe(true) // value !== '0'
    expect(findLeads.costToday).toBe(0)
    expect(findLeads.lastRun).toBeNull()
  })

  it('exposes lastRun + sums cost from today\'s cronLog rows', async () => {
    const findFirst = vi.fn(async () => ({
      status: 'success', startedAt: new Date('2026-04-30T03:30:00Z'),
      durationMs: 4000, recordsProcessed: 27,
    }))
    const aggregate = vi.fn(async () => ({ _sum: { costUsd: 0.42 } }))
    const db = mockDb({
      config: { findMany: vi.fn(async () => []) },
      cronLog: { findFirst, aggregate },
    })
    const result = await exec({ query: '{ engines { name costToday lastRun { status durationMs primaryCount } } }', db })
    const data = ok<{ engines: { name: string; costToday: number; lastRun: { status: string; durationMs: number; primaryCount: number } | null }[] }>(result)
    const ee = data.engines.find((e) => e.name === 'findLeads')!
    expect(ee.costToday).toBeCloseTo(0.42, 4)
    expect(ee.lastRun?.primaryCount).toBe(27)
    expect(ee.lastRun?.durationMs).toBe(4000)
  })
})
