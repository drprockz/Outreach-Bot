import { describe, it, expect } from 'vitest'
import { signToken, verifyToken, type JwtPayload } from './jwt.js'

describe('JWT', () => {
  const basePayload: Omit<JwtPayload, 'jti' | 'iat' | 'exp'> = {
    userId: 1, orgId: 1, role: 'owner', isSuperadmin: false,
  }

  it('signs and verifies a token round-trip', () => {
    const token = signToken(basePayload)
    const decoded = verifyToken(token)
    expect(decoded.userId).toBe(1)
    expect(decoded.orgId).toBe(1)
    expect(decoded.role).toBe('owner')
    expect(decoded.isSuperadmin).toBe(false)
    expect(decoded.jti).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(typeof decoded.iat).toBe('number')
    expect(typeof decoded.exp).toBe('number')
  })

  it('throws on tampered token', () => {
    expect(() => verifyToken('bad.token.here')).toThrow()
  })
})
