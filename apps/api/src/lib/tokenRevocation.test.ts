import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockSet, mockGet } = vi.hoisted(() => ({
  mockSet: vi.fn().mockResolvedValue('OK'),
  mockGet: vi.fn().mockResolvedValue(null),
}))
vi.mock('./redis.js', () => ({ redis: { set: mockSet, get: mockGet } }))

import { revokeToken, isTokenRevoked, revokeOrgTokens, isOrgRevoked } from './tokenRevocation.js'

describe('tokenRevocation', () => {
  beforeEach(() => {
    mockSet.mockClear()
    mockGet.mockClear()
    mockGet.mockResolvedValue(null)
  })

  it('revokeToken sets Redis key with TTL', async () => {
    await revokeToken('test-jti', 3600)
    expect(mockSet).toHaveBeenCalledWith('jwt:revoked:test-jti', '1', 'EX', 3600)
  })

  it('isTokenRevoked returns false when key not set', async () => {
    expect(await isTokenRevoked('test-jti')).toBe(false)
  })

  it('isTokenRevoked returns true when key set', async () => {
    mockGet.mockResolvedValueOnce('1')
    expect(await isTokenRevoked('test-jti')).toBe(true)
  })

  it('revokeOrgTokens sets per-org revocation timestamp', async () => {
    await revokeOrgTokens(42)
    expect(mockSet).toHaveBeenCalledWith(
      'jwt:org:42:revokedBefore', expect.any(String), 'EX', 7 * 86400
    )
  })

  it('isOrgRevoked returns false when no revokedBefore set', async () => {
    expect(await isOrgRevoked(42, 1000)).toBe(false)
  })

  it('isOrgRevoked returns true when iat is before revokedBefore', async () => {
    const now = Date.now()
    mockGet.mockResolvedValueOnce(String(now))
    // iat is in seconds; iat*1000 < now means token issued before revocation
    expect(await isOrgRevoked(42, Math.floor((now - 1000) / 1000))).toBe(true)
  })

  it('isOrgRevoked returns false when iat is after revokedBefore', async () => {
    const now = Date.now()
    mockGet.mockResolvedValueOnce(String(now - 10000))
    expect(await isOrgRevoked(42, Math.floor(now / 1000))).toBe(false)
  })
})
