import { describe, it, expect, vi } from 'vitest'
import { exec, ok, mockDb } from './_executor.js'

describe('costs resolver', () => {
  it('returns zero monthly aggregates when there are no rows', async () => {
    const findMany = vi.fn(async () => [])
    const db = mockDb({ dailyMetrics: { findMany } })
    const result = await exec({
      query: '{ costs { daily { date } monthly { totalApiCostUsd emailsSent perEmailCost } } }',
      db,
    })
    const data = ok<{ costs: { daily: unknown[]; monthly: { totalApiCostUsd: number; emailsSent: number; perEmailCost: number } } }>(result)
    expect(data.costs.daily).toEqual([])
    expect(data.costs.monthly).toEqual({ totalApiCostUsd: 0, emailsSent: 0, perEmailCost: 0 })
  })

  it('sums monthly + computes perEmailCost', async () => {
    const findMany = vi.fn(async () => [
      { date: '2026-04-29', geminiCostUsd: 0.1, sonnetCostUsd: 0.2, haikuCostUsd: 0.05, mevCostUsd: 0.01, totalApiCostUsd: 0.36, emailsSent: 12 },
      { date: '2026-04-30', geminiCostUsd: 0.2, sonnetCostUsd: 0.3, haikuCostUsd: 0.1,  mevCostUsd: 0.02, totalApiCostUsd: 0.62, emailsSent: 8 },
    ])
    const db = mockDb({ dailyMetrics: { findMany } })
    const result = await exec({
      query: '{ costs { monthly { totalApiCostUsd emailsSent perEmailCost geminiCostUsd } } }',
      db,
    })
    const data = ok<{ costs: { monthly: { totalApiCostUsd: number; emailsSent: number; perEmailCost: number; geminiCostUsd: number } } }>(result)
    expect(data.costs.monthly.totalApiCostUsd).toBeCloseTo(0.98, 4)
    expect(data.costs.monthly.emailsSent).toBe(20)
    expect(data.costs.monthly.geminiCostUsd).toBeCloseTo(0.3, 4)
    expect(data.costs.monthly.perEmailCost).toBeCloseTo(0.049, 4)
  })
})
