import { describe, it, expect, vi } from 'vitest'
import { exec, ok, err, mockDb } from './_executor.js'

const isoDate = () => new Date('2026-04-30T00:00:00Z')

describe('icpProfile resolvers', () => {
  it('Query.icpProfile returns sentinel when no row exists', async () => {
    const findFirst = vi.fn(async () => null)
    const db = mockDb({ icpProfile: { findFirst } })
    const result = await exec({ query: '{ icpProfile { id industries geography } }', db })
    const data = ok<{ icpProfile: { id: number | null; industries: string[]; geography: string[] } }>(result)
    expect(data.icpProfile).toEqual({ id: null, industries: [], geography: [] })
  })

  it('Query.icpProfile rejects unauthenticated callers', async () => {
    const result = await exec({ query: '{ icpProfile { id } }', user: null, db: mockDb({}) })
    expect(err(result)).toMatch(/Unauthenticated/)
  })

  it('Mutation.updateIcpProfile creates row when none exists', async () => {
    const findFirst = vi.fn(async () => null)
    const create = vi.fn(async (args) => ({ id: 1, ...args.data, updatedAt: isoDate() }))
    const db = mockDb({ icpProfile: { findFirst, create, update: vi.fn() } })
    await exec({
      query: 'mutation U { updateIcpProfile(industries: ["saas","fintech"], companySize: "10-50") { id companySize } }',
      db,
    })
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ industries: ['saas', 'fintech'], companySize: '10-50' }),
    }))
  })

  it('Mutation.updateIcpProfile updates existing row by id', async () => {
    const findFirst = vi.fn(async () => ({ id: 3 }))
    const update = vi.fn(async () => ({
      id: 3, industries: ['saas'], companySize: null, revenueRange: null,
      geography: [], stage: [], techStack: [], internalCapabilities: [],
      budgetRange: null, problemFrequency: null, problemCost: null,
      impactedKpis: [], initiatorRoles: [], decisionRoles: [], objections: [],
      buyingProcess: null, intentSignals: [], currentTools: [], workarounds: [],
      frustrations: [], switchingBarriers: [], hardDisqualifiers: [],
      updatedAt: isoDate(),
    }))
    const db = mockDb({ icpProfile: { findFirst, update, create: vi.fn() } })
    await exec({
      query: 'mutation U { updateIcpProfile(industries: ["saas"]) { id } }',
      db,
    })
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 3 } }))
  })
})
