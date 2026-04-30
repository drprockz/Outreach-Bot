import { describe, it, expect, vi } from 'vitest'
import { exec, ok, err, mockDb } from './_executor.js'

const isoDate = (d = '2026-04-30T00:00:00Z') => new Date(d)

describe('sequences resolvers', () => {
  it('Query.sequences returns sequences + aggregates folded from groupBy', async () => {
    const findMany = vi.fn(async () => [
      {
        id: 1, leadId: 10, currentStep: 0, nextSendDate: isoDate('2026-05-01T09:00:00Z'),
        lastSentAt: null, lastMessageId: null, lastSubject: null,
        status: 'active', pausedReason: null, updatedAt: isoDate(),
        lead: { businessName: 'Acme', contactName: 'Alice', contactEmail: 'a@acme.test' },
      },
    ])
    const groupBy = vi.fn(async () => [
      { status: 'active', _count: { _all: 7 } },
      { status: 'paused', _count: { _all: 2 } },
      { status: 'completed', _count: { _all: 1 } },
      { status: 'unknown_bucket', _count: { _all: 99 } }, // ignored
    ])
    const db = mockDb({ sequenceState: { findMany, groupBy } })
    const result = await exec({
      query: '{ sequences { sequences { id status businessName contactEmail } aggregates { active paused completed replied unsubscribed } } }',
      db,
    })
    const data = ok<{
      sequences: {
        sequences: { id: number; status: string; businessName: string; contactEmail: string }[]
        aggregates: { active: number; paused: number; completed: number; replied: number; unsubscribed: number }
      }
    }>(result)
    expect(data.sequences.sequences).toHaveLength(1)
    expect(data.sequences.sequences[0]).toMatchObject({ id: 1, status: 'active', businessName: 'Acme', contactEmail: 'a@acme.test' })
    expect(data.sequences.aggregates).toEqual({ active: 7, paused: 2, completed: 1, replied: 0, unsubscribed: 0 })
  })

  it('Query.sequences rejects unauthenticated callers', async () => {
    const result = await exec({ query: '{ sequences { sequences { id } } }', user: null, db: mockDb({}) })
    expect(err(result)).toMatch(/Unauthenticated/)
  })
})
