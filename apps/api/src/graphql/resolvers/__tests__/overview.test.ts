import { describe, it, expect, vi } from 'vitest'
import { exec, ok, mockDb } from './_executor.js'

describe('overview resolver', () => {
  it('returns sentinel today metrics + zero aggregates when daily_metrics is empty', async () => {
    const dailyMetrics = {
      findUnique: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
    }
    const config = { findUnique: vi.fn(async () => null) }
    const lead = { findMany: vi.fn(async () => []) }
    const sequenceState = { count: vi.fn(async () => 0) }
    const db = mockDb({ dailyMetrics, config, lead, sequenceState })

    const result = await exec({
      query: '{ overview { metrics { activeSequences replyRate7d bounceRateToday today { leads_discovered: leadsDiscovered emails_sent: emailsSent } week { emails_sent: emailsSent } month { total_api_cost_usd: totalApiCostUsd } } funnel { total } sendActivity { date } } }',
      db,
    })
    const data = ok<{
      overview: {
        metrics: { activeSequences: number; replyRate7d: number; bounceRateToday: number; today: { leads_discovered: number; emails_sent: number }; week: { emails_sent: number }; month: { total_api_cost_usd: number } }
        funnel: { total: number }
        sendActivity: unknown[]
      }
    }>(result)
    expect(data.overview.metrics.activeSequences).toBe(0)
    expect(data.overview.metrics.replyRate7d).toBe(0)
    expect(data.overview.metrics.bounceRateToday).toBe(0)
    expect(data.overview.metrics.today.leads_discovered).toBe(0)
    expect(data.overview.metrics.month.total_api_cost_usd).toBe(0)
    expect(data.overview.funnel.total).toBe(0)
    expect(data.overview.sendActivity).toEqual([])
  })

  it('computes bounceRateToday + replyRate7d as percentages', async () => {
    const dailyMetrics = {
      findUnique: vi.fn(async () => ({
        id: 1, date: '2026-04-30',
        leadsDiscovered: 50, leadsExtracted: 45, leadsJudgePassed: 30,
        leadsEmailFound: 20, leadsEmailValid: 15, leadsIcpAb: 12,
        leadsReady: 8, leadsDisqualified: 2,
        emailsAttempted: 50, emailsSent: 40, emailsHardBounced: 4,
        emailsSoftBounced: 1, emailsContentRejected: 0,
        sentInbox1: 20, sentInbox2: 20,
        repliesTotal: 5, repliesHot: 2, repliesSchedule: 1,
        repliesSoftNo: 1, repliesUnsubscribe: 1, repliesOoo: 0, repliesOther: 0,
        bounceRate: 0.1, replyRate: 0.125, unsubscribeRate: 0.025,
        geminiCostUsd: 0, sonnetCostUsd: 0, haikuCostUsd: 0, mevCostUsd: 0,
        totalApiCostUsd: 0, totalApiCostInr: 0,
        domainBlacklisted: false, mailTesterScore: null, postmasterReputation: null,
        icpParseErrors: 0, followupsSent: 0, blacklistZones: null,
        createdAt: new Date('2026-04-30T00:00:00Z'),
      })),
      findMany: vi.fn(async () => [
        { leadsDiscovered: 50, emailsSent: 100, emailsHardBounced: 5, repliesTotal: 5, repliesHot: 2, totalApiCostUsd: 0, date: '2026-04-29' },
      ]),
    }
    const config = { findUnique: vi.fn(async (a: { where: { key: string } }) => a.where.key === 'icp_threshold_b' ? { value: '40' } : null) }
    const lead = { findMany: vi.fn(async () => []) }
    const sequenceState = { count: vi.fn(async () => 3) }
    const db = mockDb({ dailyMetrics, config, lead, sequenceState })

    const result = await exec({
      query: '{ overview { metrics { activeSequences bounceRateToday replyRate7d } } }',
      db,
    })
    const data = ok<{ overview: { metrics: { activeSequences: number; bounceRateToday: number; replyRate7d: number } } }>(result)
    expect(data.overview.metrics.activeSequences).toBe(3)
    expect(data.overview.metrics.bounceRateToday).toBeCloseTo(10, 1) // 4 / 40 * 100
    expect(data.overview.metrics.replyRate7d).toBeCloseTo(5, 1)      // 5 / 100 * 100
  })
})
