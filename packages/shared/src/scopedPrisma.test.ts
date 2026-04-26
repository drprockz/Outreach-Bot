import { describe, it, expect, vi } from 'vitest'

const mockFindMany = vi.fn().mockResolvedValue([])

vi.mock('./prismaClient.js', () => ({
  prisma: {
    $extends: vi.fn().mockImplementation((ext: { query: Record<string, Record<string, (params: { args: unknown; query: (a: unknown) => unknown }) => unknown>> }) => ({
      lead: {
        findMany: async (args: Record<string, unknown>) => {
          const query = (a: unknown) => mockFindMany(a)
          return ext.query.lead.findMany({ args, query })
        },
      },
    })),
  },
}))

import { createScopedPrisma } from './scopedPrisma.js'

describe('createScopedPrisma', () => {
  it('injects orgId into findMany where clause', async () => {
    const scoped = createScopedPrisma(42)
    await (scoped as unknown as { lead: { findMany: (args: Record<string, unknown>) => Promise<unknown> } })
      .lead.findMany({ where: { status: 'ready' } })
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ orgId: 42, status: 'ready' }) })
    )
  })

  it('injects orgId when no where clause is provided', async () => {
    mockFindMany.mockClear()
    const scoped = createScopedPrisma(7)
    await (scoped as unknown as { lead: { findMany: (args: Record<string, unknown>) => Promise<unknown> } })
      .lead.findMany({})
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orgId: 7 } })
    )
  })
})
