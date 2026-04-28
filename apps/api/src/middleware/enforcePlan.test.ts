import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Request, Response, NextFunction } from 'express'

const mocks = vi.hoisted(() => ({
  prisma: {
    orgSubscription: { findUnique: vi.fn(), update: vi.fn() },
    org: { findUnique: vi.fn(), update: vi.fn() },
  },
}))

vi.mock('shared', () => ({ prisma: mocks.prisma }))

import { checkOrgStatus, requirePlanFeature } from './enforcePlan.js'

function makeReq(user?: object): Request {
  return { user } as unknown as Request
}

describe('checkOrgStatus', () => {
  let res: Response
  let next: NextFunction
  beforeEach(() => {
    res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response
    next = vi.fn() as unknown as NextFunction
    Object.values(mocks.prisma).forEach(m => Object.values(m).forEach(fn => fn.mockReset()))
    mocks.prisma.org.findUnique.mockResolvedValue({ status: 'active' })
  })

  it('rejects unauthenticated request', async () => {
    await checkOrgStatus(makeReq(), res, next)
    expect(res.status).toHaveBeenCalledWith(401)
  })

  it('returns 402 when no subscription exists', async () => {
    mocks.prisma.orgSubscription.findUnique.mockResolvedValueOnce(null)
    await checkOrgStatus(makeReq({ orgId: 1 }), res, next)
    expect(res.status).toHaveBeenCalledWith(402)
  })

  it('passes for active trial within window', async () => {
    mocks.prisma.orgSubscription.findUnique.mockResolvedValueOnce({
      status: 'trial',
      trialEndsAt: new Date(Date.now() + 86400_000),
      plan: { limitsJson: { seats: 1 }, name: 'Trial' },
    })
    const req = makeReq({ orgId: 1 })
    await checkOrgStatus(req, res, next)
    expect(next).toHaveBeenCalled()
    expect((req as Request & { planName?: string }).planName).toBe('Trial')
  })

  it('locks expired trial and returns 402', async () => {
    mocks.prisma.orgSubscription.findUnique.mockResolvedValueOnce({
      status: 'trial',
      trialEndsAt: new Date(Date.now() - 86400_000),
      plan: { limitsJson: {}, name: 'Trial' },
    })
    await checkOrgStatus(makeReq({ orgId: 1 }), res, next)
    expect(mocks.prisma.orgSubscription.update).toHaveBeenCalledWith({
      where: { orgId: 1 }, data: { status: 'locked' },
    })
    expect(res.status).toHaveBeenCalledWith(402)
  })

  it('returns 402 for already-locked subscription', async () => {
    mocks.prisma.orgSubscription.findUnique.mockResolvedValueOnce({
      status: 'locked', plan: { limitsJson: {}, name: 'Starter' },
    })
    await checkOrgStatus(makeReq({ orgId: 1 }), res, next)
    expect(res.status).toHaveBeenCalledWith(402)
  })

  it('locks expired grace period', async () => {
    mocks.prisma.orgSubscription.findUnique.mockResolvedValueOnce({
      status: 'grace',
      graceEndsAt: new Date(Date.now() - 86400_000),
      plan: { limitsJson: {}, name: 'Starter' },
    })
    await checkOrgStatus(makeReq({ orgId: 1 }), res, next)
    expect(mocks.prisma.orgSubscription.update).toHaveBeenCalledWith({
      where: { orgId: 1 }, data: { status: 'locked' },
    })
    expect(res.status).toHaveBeenCalledWith(402)
  })

  it('passes active subscription', async () => {
    mocks.prisma.orgSubscription.findUnique.mockResolvedValueOnce({
      status: 'active',
      plan: { limitsJson: { bulkRetryEnabled: true }, name: 'Growth' },
    })
    const req = makeReq({ orgId: 1 })
    await checkOrgStatus(req, res, next)
    expect(next).toHaveBeenCalled()
  })
})

describe('requirePlanFeature', () => {
  let res: Response
  let next: NextFunction
  beforeEach(() => {
    res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response
    next = vi.fn() as unknown as NextFunction
  })

  it('rejects when plan context missing', () => {
    requirePlanFeature('bulkRetryEnabled')(makeReq(), res, next)
    expect(res.status).toHaveBeenCalledWith(500)
  })

  it('rejects when feature flag is false', () => {
    const req = makeReq() as Request & { planLimits: object }
    req.planLimits = { bulkRetryEnabled: false } as unknown as object
    requirePlanFeature('bulkRetryEnabled')(req, res, next)
    expect(res.status).toHaveBeenCalledWith(403)
  })

  it('passes when feature flag is true', () => {
    const req = makeReq() as Request & { planLimits: object }
    req.planLimits = { bulkRetryEnabled: true } as unknown as object
    requirePlanFeature('bulkRetryEnabled')(req, res, next)
    expect(next).toHaveBeenCalled()
  })
})
