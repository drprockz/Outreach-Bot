import { describe, it, expect, vi, beforeEach } from 'vitest'

type Op = (args: Record<string, unknown>) => Promise<unknown>
type Ext = {
  query: Record<string, Record<string, (params: { args: unknown; query: (a: unknown) => unknown }) => unknown>>
}

const ops = {
  findMany: vi.fn().mockResolvedValue([]),
  count: vi.fn().mockResolvedValue(0),
  groupBy: vi.fn().mockResolvedValue([]),
  create: vi.fn().mockResolvedValue({}),
  createMany: vi.fn().mockResolvedValue({ count: 0 }),
  upsert: vi.fn().mockResolvedValue({}),
  update: vi.fn().mockResolvedValue({}),
}

function buildModel(ext: Ext, model: string) {
  const out: Record<string, Op> = {}
  for (const [op, mock] of Object.entries(ops)) {
    out[op] = async (args: Record<string, unknown>) => {
      const query = (a: unknown) => mock(a)
      return ext.query[model][op]({ args, query })
    }
  }
  return out
}

vi.mock('./prismaClient.js', () => ({
  prisma: {
    $extends: vi.fn().mockImplementation((ext: Ext) => ({
      lead: buildModel(ext, 'lead'),
      email: buildModel(ext, 'email'),
    })),
  },
}))

import { createScopedPrisma } from './scopedPrisma.js'

type Scoped = {
  lead: Record<keyof typeof ops, Op>
  email: Record<keyof typeof ops, Op>
}

beforeEach(() => {
  for (const m of Object.values(ops)) m.mockClear()
})

describe('createScopedPrisma — reads', () => {
  it('injects orgId into findMany where clause', async () => {
    const scoped = createScopedPrisma(42) as unknown as Scoped
    await scoped.lead.findMany({ where: { status: 'ready' } })
    expect(ops.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ orgId: 42, status: 'ready' }) })
    )
  })

  it('injects orgId when no where clause is provided', async () => {
    const scoped = createScopedPrisma(7) as unknown as Scoped
    await scoped.lead.findMany({})
    expect(ops.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { orgId: 7 } }))
  })

  it('injects orgId into count', async () => {
    const scoped = createScopedPrisma(9) as unknown as Scoped
    await scoped.lead.count({ where: { status: 'ready' } })
    expect(ops.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ orgId: 9, status: 'ready' }) })
    )
  })

  it('injects orgId into groupBy', async () => {
    const scoped = createScopedPrisma(3) as unknown as Scoped
    await scoped.lead.groupBy({ by: ['status'] })
    expect(ops.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: { orgId: 3 } }))
  })
})

describe('createScopedPrisma — writes', () => {
  it('injects orgId into create.data', async () => {
    const scoped = createScopedPrisma(11) as unknown as Scoped
    await scoped.lead.create({ data: { businessName: 'Acme' } })
    expect(ops.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ orgId: 11, businessName: 'Acme' }) })
    )
  })

  it('does not overwrite an explicit orgId on create', async () => {
    const scoped = createScopedPrisma(11) as unknown as Scoped
    await scoped.lead.create({ data: { orgId: 99, businessName: 'Acme' } })
    expect(ops.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ orgId: 99 }) })
    )
  })

  it('injects orgId into every row of createMany', async () => {
    const scoped = createScopedPrisma(5) as unknown as Scoped
    await scoped.lead.createMany({ data: [{ businessName: 'A' }, { businessName: 'B' }] })
    expect(ops.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: [
        expect.objectContaining({ orgId: 5, businessName: 'A' }),
        expect.objectContaining({ orgId: 5, businessName: 'B' }),
      ] })
    )
  })

  it('injects orgId into both where and create on upsert', async () => {
    const scoped = createScopedPrisma(13) as unknown as Scoped
    await scoped.lead.upsert({
      where: { id: 1 },
      create: { businessName: 'Acme' },
      update: { businessName: 'Acme 2' },
    })
    expect(ops.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ orgId: 13, id: 1 }),
        create: expect.objectContaining({ orgId: 13, businessName: 'Acme' }),
      })
    )
  })

  it('injects orgId into update where', async () => {
    const scoped = createScopedPrisma(2) as unknown as Scoped
    await scoped.lead.update({ where: { id: 5 }, data: { status: 'sent' } })
    expect(ops.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ orgId: 2, id: 5 }) })
    )
  })
})
