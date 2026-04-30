import { describe, it, expect, vi } from 'vitest'
import { exec, ok, mockDb } from './_executor.js'

describe('health resolvers', () => {
  describe('Query.health', () => {
    it('computes bounce + unsub rates and assembles the inbox cards', async () => {
      const dailyMetrics = {
        findUnique: vi.fn(async () => ({
          emailsSent: 100, emailsHardBounced: 3, domainBlacklisted: false,
          blacklistZones: null, postmasterReputation: 'HIGH',
        })),
        findFirst: vi.fn(async () => ({ mailTesterScore: 9.2, date: '2026-04-29' })),
      }
      const reply = { findMany: vi.fn(async () => [{ category: 'unsubscribe' }, { category: 'hot' }, { category: 'unsubscribe' }]) }
      const email = {
        findFirst: vi.fn(async () => ({ sentAt: new Date('2026-04-30T10:00:00Z') })),
      }
      const rejectList = { count: vi.fn(async () => 42) }
      const db = mockDb({ dailyMetrics, reply, email, rejectList })
      const result = await exec({
        query: '{ health { bounceRate unsubscribeRate domain blacklisted mailTesterScore rejectListSize inbox1 { email lastSend } } }',
        db,
      })
      const data = ok<{
        health: { bounceRate: number; unsubscribeRate: number; rejectListSize: number; mailTesterScore: number; inbox1: { email: string; lastSend: string } }
      }>(result)
      expect(data.health.bounceRate).toBeCloseTo(3, 2)
      expect(data.health.unsubscribeRate).toBeCloseTo(66.67, 1)
      expect(data.health.rejectListSize).toBe(42)
      expect(data.health.mailTesterScore).toBe(9.2)
      expect(data.health.inbox1.lastSend).toBeTruthy()
    })

    it('returns 0 rates when no emails were sent today', async () => {
      const dailyMetrics = { findUnique: vi.fn(async () => null), findFirst: vi.fn(async () => null) }
      const db = mockDb({
        dailyMetrics,
        reply: { findMany: vi.fn(async () => []) },
        email: { findFirst: vi.fn(async () => null) },
        rejectList: { count: vi.fn(async () => 0) },
      })
      const result = await exec({ query: '{ health { bounceRate unsubscribeRate rejectListSize } }', db })
      const data = ok<{ health: { bounceRate: number; unsubscribeRate: number; rejectListSize: number } }>(result)
      expect(data.health).toEqual({ bounceRate: 0, unsubscribeRate: 0, rejectListSize: 0 })
    })
  })

  describe('Mutation.setMailTesterScore', () => {
    it('upserts today\'s daily metrics row with the score', async () => {
      const upsert = vi.fn(async () => ({}))
      const db = mockDb({ dailyMetrics: { upsert } })
      const result = await exec({ query: 'mutation S { setMailTesterScore(score: 8.5) }', db })
      expect(ok<{ setMailTesterScore: boolean }>(result).setMailTesterScore).toBe(true)
      expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
        create: expect.objectContaining({ mailTesterScore: 8.5 }),
        update: { mailTesterScore: 8.5 },
      }))
    })
  })
})
