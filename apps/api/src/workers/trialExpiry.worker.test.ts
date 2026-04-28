import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => {
  const prisma = {
    orgSubscription: {
      updateMany: vi.fn(),
      findMany: vi.fn(),
    },
    org: {
      updateMany: vi.fn(),
    },
  }
  return { prisma }
})

vi.mock('shared', () => ({ prisma: mocks.prisma }))
vi.mock('../lib/redis.js', () => ({ redis: { disconnect: vi.fn() } }))
vi.mock('bullmq', () => ({
  Worker: vi.fn().mockImplementation(() => ({ close: vi.fn(), on: vi.fn() })),
}))

import { lockExpiredSubscriptions } from './trialExpiry.worker.js'

describe('lockExpiredSubscriptions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.prisma.orgSubscription.updateMany.mockResolvedValue({ count: 0 })
    mocks.prisma.orgSubscription.findMany.mockResolvedValue([])
    mocks.prisma.org.updateMany.mockResolvedValue({ count: 0 })
  })

  it('locks expired trial subscriptions', async () => {
    mocks.prisma.orgSubscription.updateMany.mockResolvedValue({ count: 2 })
    await lockExpiredSubscriptions()
    expect(mocks.prisma.orgSubscription.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'trial', trialEndsAt: { lt: expect.any(Date) } },
        data: { status: 'locked' },
      }),
    )
  })

  it('locks expired grace subscriptions', async () => {
    await lockExpiredSubscriptions()
    expect(mocks.prisma.orgSubscription.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'grace', graceEndsAt: { lt: expect.any(Date) } },
        data: { status: 'locked' },
      }),
    )
  })

  it('syncs org.status to locked for affected orgs', async () => {
    mocks.prisma.orgSubscription.findMany.mockResolvedValue([{ orgId: 5 }, { orgId: 6 }])
    await lockExpiredSubscriptions()
    expect(mocks.prisma.org.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: [5, 6] } }),
        data: { status: 'locked' },
      }),
    )
  })

  it('skips org update when no subscriptions are locked', async () => {
    mocks.prisma.orgSubscription.findMany.mockResolvedValue([])
    await lockExpiredSubscriptions()
    expect(mocks.prisma.org.updateMany).not.toHaveBeenCalled()
  })
})
