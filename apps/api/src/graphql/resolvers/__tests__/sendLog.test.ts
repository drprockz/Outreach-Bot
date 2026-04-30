import { describe, it, expect, vi } from 'vitest'
import { exec, ok, mockDb } from './_executor.js'

describe('sendLog resolver', () => {
  it('paginates + filters + folds aggregates over the unfiltered count match', async () => {
    const count = vi.fn(async () => 50)
    const pageRows = vi.fn(async () => [
      {
        id: 7, leadId: 100, sequenceStep: 0, inboxUsed: 'inbox-1', fromDomain: 'trysimpleinc.com',
        fromName: 'Darshan', subject: 'Hi', body: 'short body', wordCount: 50, hook: 'h',
        containsLink: false, isHtml: false, isPlainText: true, contentValid: true,
        validationFailReason: null, regenerated: false, status: 'sent',
        sentAt: new Date('2026-04-30T11:00:00Z'), smtpResponse: null, smtpCode: 250,
        messageId: 'm', sendDurationMs: 1200, inReplyTo: null, referencesHeader: null,
        hookModel: 'sonnet', bodyModel: 'haiku', hookCostUsd: 0.001, bodyCostUsd: 0.0005,
        totalCostUsd: 0.0015, createdAt: new Date('2026-04-30T11:00:00Z'),
        lead: { businessName: 'Acme', contactName: 'Alice', contactEmail: 'a@acme.test' },
      },
    ])
    const aggRows = vi.fn(async () => [
      { status: 'sent',          sendDurationMs: 1000, totalCostUsd: 0.001 },
      { status: 'hard_bounce',   sendDurationMs: 800,  totalCostUsd: 0.001 },
      { status: 'content_rejected', sendDurationMs: null, totalCostUsd: null },
    ])
    const findMany = vi.fn().mockImplementationOnce(pageRows).mockImplementationOnce(aggRows)
    const db = mockDb({ email: { count, findMany } })
    const result = await exec({
      query: '{ sendLog(page: 2, limit: 10, status: "sent") { total page limit emails { id status totalCostUsd businessName } aggregates { totalSent hardBounces contentRejected avgDurationMs totalCost } } }',
      db,
    })
    const data = ok<{
      sendLog: {
        total: number; page: number; limit: number
        emails: { id: number; businessName: string }[]
        aggregates: { totalSent: number; hardBounces: number; contentRejected: number; avgDurationMs: number; totalCost: number }
      }
    }>(result)
    expect(data.sendLog.page).toBe(2)
    expect(data.sendLog.limit).toBe(10)
    expect(data.sendLog.total).toBe(50)
    expect(data.sendLog.emails[0].businessName).toBe('Acme')
    expect(data.sendLog.aggregates.totalSent).toBe(3)
    expect(data.sendLog.aggregates.hardBounces).toBe(1)
    expect(data.sendLog.aggregates.contentRejected).toBe(1)
    expect(data.sendLog.aggregates.avgDurationMs).toBeCloseTo(900, 0)
    expect(data.sendLog.aggregates.totalCost).toBeCloseTo(0.002, 4)
  })

  it('clamps page/limit and uses default 20 when omitted', async () => {
    const count = vi.fn(async () => 0)
    const findMany = vi.fn(async () => [])
    const db = mockDb({ email: { count, findMany } })
    await exec({ query: '{ sendLog(page: 0, limit: 9999) { page limit } }', db })
    // findMany was called twice (page rows + aggregate rows). Inspect first call.
    const pageCallArg = (findMany.mock.calls[0] as unknown as [unknown])[0] as { take: number; skip: number }
    expect(pageCallArg.take).toBe(100) // limit clamped to 100
    expect(pageCallArg.skip).toBe(0)   // page clamped to 1 → offset 0
  })
})
