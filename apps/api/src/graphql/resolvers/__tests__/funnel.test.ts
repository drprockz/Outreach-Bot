import { describe, it, expect, vi } from 'vitest'
import { exec, ok, mockDb } from './_executor.js'

describe('funnel resolver', () => {
  it('returns empty stages when no leads exist', async () => {
    const db = mockDb({
      lead: { findMany: vi.fn(async () => []) },
      config: { findUnique: vi.fn(async () => null) },
      dailyMetrics: { findMany: vi.fn(async () => []) },
    })
    const result = await exec({
      query: '{ funnel { stages { discovered nurture ready sent } dropReasons { extraction_failed: extractionFailed } } }',
      db,
    })
    const data = ok<{
      funnel: {
        stages: { discovered: number; nurture: number; ready: number; sent: number }
        dropReasons: { extraction_failed: number }
      }
    }>(result)
    expect(data.funnel.stages).toEqual({ discovered: 0, nurture: 0, ready: 0, sent: 0 })
    expect(data.funnel.dropReasons.extraction_failed).toBe(0)
  })

  it('counts ICP buckets from leads and rolls up category/city aggregates', async () => {
    const leads = [
      { status: 'ready',     websiteQualityScore: 6, contactEmail: 'a@a.test', emailStatus: 'valid', icpScore: 80, judgeSkip: false, category: 'D2C', city: 'Mumbai', contactConfidence: 'high' },
      { status: 'sent',      websiteQualityScore: 5, contactEmail: 'b@b.test', emailStatus: 'valid', icpScore: 50, judgeSkip: false, category: 'D2C', city: 'Pune',   contactConfidence: 'high' },
      { status: 'nurture',   websiteQualityScore: 4, contactEmail: 'c@c.test', emailStatus: 'invalid', icpScore: 20, judgeSkip: false, category: 'Real estate', city: 'Mumbai', contactConfidence: 'medium' },
      { status: 'replied',   websiteQualityScore: 7, contactEmail: 'd@d.test', emailStatus: 'valid', icpScore: 90, judgeSkip: false, category: 'D2C', city: 'Mumbai', contactConfidence: 'high' },
    ]
    const findMany = vi.fn(async () => leads)
    const findUniqueConfig = vi.fn(async (args: { where: { key: string } }) => {
      if (args.where.key === 'icp_threshold_a') return { value: '70' }
      if (args.where.key === 'icp_threshold_b') return { value: '40' }
      return null
    })
    const db = mockDb({
      lead: { findMany },
      config: { findUnique: findUniqueConfig },
      dailyMetrics: { findMany: vi.fn(async () => []) },
    })
    const result = await exec({
      query: '{ funnel { stages { discovered icp_high: icpHigh icp_medium: icpMedium icp_low: icpLow nurture replied } byCategory { category total } } }',
      db,
    })
    const data = ok<{
      funnel: {
        stages: { discovered: number; icp_high: number; icp_medium: number; icp_low: number; nurture: number; replied: number }
        byCategory: { category: string; total: number }[]
      }
    }>(result)
    expect(data.funnel.stages.discovered).toBe(4)
    expect(data.funnel.stages.icp_high).toBe(2)   // scores 80, 90
    expect(data.funnel.stages.icp_medium).toBe(1) // score 50
    expect(data.funnel.stages.icp_low).toBe(1)    // score 20
    expect(data.funnel.stages.nurture).toBe(1)
    expect(data.funnel.stages.replied).toBe(1)
    const d2c = data.funnel.byCategory.find((c) => c.category === 'D2C')
    expect(d2c?.total).toBe(3)
  })
})
