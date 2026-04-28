import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Request, Response, NextFunction } from 'express'

const { mockVerify, mockIsRevoked, mockIsOrgRevoked } = vi.hoisted(() => ({
  mockVerify: vi.fn(),
  mockIsRevoked: vi.fn().mockResolvedValue(false),
  mockIsOrgRevoked: vi.fn().mockResolvedValue(false),
}))

vi.mock('../lib/jwt.js', () => ({ verifyToken: mockVerify }))
vi.mock('../lib/tokenRevocation.js', () => ({
  isTokenRevoked: mockIsRevoked,
  isOrgRevoked: mockIsOrgRevoked,
}))

import { requireAuth } from './requireAuth.js'

function makeReq(opts: { cookie?: string; bearer?: string } = {}): Request {
  return {
    cookies: opts.cookie ? { token: opts.cookie } : {},
    headers: opts.bearer ? { authorization: `Bearer ${opts.bearer}` } : {},
  } as unknown as Request
}

describe('requireAuth', () => {
  let res: Response
  let next: NextFunction

  beforeEach(() => {
    res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response
    next = vi.fn() as unknown as NextFunction
    mockVerify.mockReset()
    mockIsRevoked.mockResolvedValue(false)
    mockIsOrgRevoked.mockResolvedValue(false)
  })

  it('rejects when no token provided', async () => {
    await requireAuth(makeReq(), res, next)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('calls next() with valid cookie token', async () => {
    mockVerify.mockReturnValue({ jti: 'j1', userId: 1, orgId: 1, role: 'owner', isSuperadmin: false, iat: 0, exp: 9999999999 })
    await requireAuth(makeReq({ cookie: 'valid.token' }), res, next)
    expect(next).toHaveBeenCalled()
    expect(res.status).not.toHaveBeenCalled()
  })

  it('calls next() with valid Bearer token', async () => {
    mockVerify.mockReturnValue({ jti: 'j1', userId: 1, orgId: 1, role: 'owner', isSuperadmin: false, iat: 0, exp: 9999999999 })
    await requireAuth(makeReq({ bearer: 'valid.token' }), res, next)
    expect(next).toHaveBeenCalled()
  })

  it('rejects revoked jti', async () => {
    mockVerify.mockReturnValue({ jti: 'revoked', userId: 1, orgId: 1, role: 'owner', isSuperadmin: false, iat: 0, exp: 9999999999 })
    mockIsRevoked.mockResolvedValueOnce(true)
    await requireAuth(makeReq({ cookie: 'tok' }), res, next)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('rejects when org tokens were revoked before this token was issued', async () => {
    mockVerify.mockReturnValue({ jti: 'j1', userId: 1, orgId: 1, role: 'owner', isSuperadmin: false, iat: 0, exp: 9999999999 })
    mockIsOrgRevoked.mockResolvedValueOnce(true)
    await requireAuth(makeReq({ cookie: 'tok' }), res, next)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('rejects on JWT verify error', async () => {
    mockVerify.mockImplementation(() => { throw new Error('bad sig') })
    await requireAuth(makeReq({ cookie: 'bad.token' }), res, next)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
  })
})
