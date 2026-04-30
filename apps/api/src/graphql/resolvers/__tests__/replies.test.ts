import { describe, it, expect, vi } from 'vitest'
import { exec, ok, err, mockDb } from './_executor.js'

const makeReply = (over: Record<string, unknown> = {}) => ({
  id: 1, leadId: 10, emailId: 50, inboxReceivedAt: null,
  receivedAt: new Date('2026-04-30T08:00:00Z'),
  category: 'cold', rawText: 'thanks', classificationModel: 'haiku',
  classificationCostUsd: 0.0001, sentimentScore: 0,
  telegramAlerted: false, requeueDate: null, actionedAt: null, actionTaken: null,
  lead: { businessName: 'Acme', contactName: 'Alice', contactEmail: 'a@acme.test' },
  ...over,
})

describe('replies resolvers', () => {
  it('Query.replies sorts hot/schedule first, then by receivedAt desc', async () => {
    const findMany = vi.fn(async () => [
      makeReply({ id: 1, category: 'cold',     receivedAt: new Date('2026-04-30T10:00:00Z') }),
      makeReply({ id: 2, category: 'schedule', receivedAt: new Date('2026-04-30T09:00:00Z') }),
      makeReply({ id: 3, category: 'hot',      receivedAt: new Date('2026-04-30T08:00:00Z') }),
    ])
    const db = mockDb({ reply: { findMany } })
    const result = await exec({ query: '{ replies { id category } }', db })
    const data = ok<{ replies: { id: number; category: string }[] }>(result)
    // hot/schedule before cold; among hot/schedule, the more recent one (id=2) wins
    expect(data.replies.map((r) => r.id)).toEqual([2, 3, 1])
  })

  describe('Mutation.actionReply', () => {
    it('records actionedAt + actionTaken', async () => {
      const findUnique = vi.fn(async () => ({ id: 7 }))
      const update = vi.fn(async () => ({}))
      const db = mockDb({ reply: { findUnique, update } })
      const result = await exec({ query: 'mutation A { actionReply(id: 7, action: "booked_call") }', db })
      expect(ok<{ actionReply: boolean }>(result).actionReply).toBe(true)
      expect(update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 7 },
        data: expect.objectContaining({ actionTaken: 'booked_call' }),
      }))
    })

    it('throws when reply not found', async () => {
      const findUnique = vi.fn(async () => null)
      const result = await exec({
        query: 'mutation A { actionReply(id: 99, action: "x") }',
        db: mockDb({ reply: { findUnique, update: vi.fn() } }),
      })
      expect(err(result)).toMatch(/not found/i)
    })
  })

  describe('Mutation.rejectReply', () => {
    it('upserts the email/domain into reject_list and unsubscribes the lead + sequence', async () => {
      const findUnique = vi.fn(async () => ({
        leadId: 30, lead: { contactEmail: 'spam@example.test' },
      }))
      const upsertReject = vi.fn(async () => ({}))
      const updateLead = vi.fn(async () => ({}))
      const updateMany = vi.fn(async () => ({ count: 1 }))
      const db = mockDb({
        reply: { findUnique },
        rejectList: { upsert: upsertReject },
        lead: { update: updateLead },
        sequenceState: { updateMany },
      })
      const result = await exec({ query: 'mutation R { rejectReply(id: 1) }', db })
      expect(ok<{ rejectReply: boolean }>(result).rejectReply).toBe(true)
      expect(upsertReject).toHaveBeenCalledWith(expect.objectContaining({
        where: { email: 'spam@example.test' },
        create: expect.objectContaining({ email: 'spam@example.test', domain: 'example.test', reason: 'manual' }),
      }))
      expect(updateLead).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 30 },
        data: { status: 'unsubscribed' },
      }))
      expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { leadId: 30 },
        data: expect.objectContaining({ status: 'unsubscribed' }),
      }))
    })

    it('skips reject_list write when lead has no contactEmail', async () => {
      const findUnique = vi.fn(async () => ({ leadId: 30, lead: { contactEmail: null } }))
      const upsertReject = vi.fn(async () => ({}))
      const updateLead = vi.fn(async () => ({}))
      const updateMany = vi.fn(async () => ({ count: 0 }))
      const db = mockDb({
        reply: { findUnique },
        rejectList: { upsert: upsertReject },
        lead: { update: updateLead },
        sequenceState: { updateMany },
      })
      await exec({ query: 'mutation R { rejectReply(id: 1) }', db })
      expect(upsertReject).not.toHaveBeenCalled()
      expect(updateLead).toHaveBeenCalled()  // lead unsubscribe still happens
    })
  })
})
