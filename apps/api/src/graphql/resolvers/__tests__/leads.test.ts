import { describe, it, expect, vi } from 'vitest'
import { exec, ok, err, mockDb } from './_executor.js'

describe('leads resolvers — leadFacets only', () => {
  it('Query.leadFacets returns distinct categories/cities/countries', async () => {
    const findMany = vi.fn()
      .mockResolvedValueOnce([{ category: 'D2C' }, { category: 'Real estate' }])
      .mockResolvedValueOnce([{ city: 'Mumbai' }, { city: 'Pune' }])
      .mockResolvedValueOnce([{ country: 'India' }])
    const db = mockDb({ lead: { findMany } })
    const result = await exec({ query: '{ leadFacets { categories cities countries } }', db })
    const data = ok<{ leadFacets: { categories: string[]; cities: string[]; countries: string[] } }>(result)
    expect(data.leadFacets).toEqual({
      categories: ['D2C', 'Real estate'],
      cities: ['Mumbai', 'Pune'],
      countries: ['India'],
    })
    expect(findMany).toHaveBeenCalledTimes(3)
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ distinct: ['category'] }))
  })

  it('Query.leadFacets rejects unauthenticated callers', async () => {
    const result = await exec({ query: '{ leadFacets { categories } }', user: null, db: mockDb({}) })
    expect(err(result)).toMatch(/Unauthenticated/)
  })
})
