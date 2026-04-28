import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import cookieParser from 'cookie-parser'
import request from 'supertest'

const mocks = vi.hoisted(() => {
  const prisma = {
    user: {
      findUnique: vi.fn(),
    },
  }
  const revokeToken = vi.fn().mockResolvedValue(undefined)
  const isTokenRevoked = vi.fn().mockResolvedValue(false)
  const isOrgRevoked = vi.fn().mockResolvedValue(false)
  return { prisma, revokeToken, isTokenRevoked, isOrgRevoked }
})

vi.mock('shared', () => ({ prisma: mocks.prisma }))
vi.mock('../lib/tokenRevocation.js', () => ({
  revokeToken: mocks.revokeToken,
  isTokenRevoked: mocks.isTokenRevoked,
  isOrgRevoked: mocks.isOrgRevoked,
}))

import jwt from 'jsonwebtoken'
import { authRouter, getMeHandler } from './auth.js'
import { requireAuth } from '../middleware/requireAuth.js'

// Test secret matches the one set in vitest.setup.ts so tokens we forge here
// can be verified by the same code path that loads JWT_SECRET from env.
const JWT_SECRET = process.env.JWT_SECRET!

function makeValidToken(overrides = {}) {
  const payload = {
    jti: 'test-jti', userId: 1, orgId: 1, role: 'owner', isSuperadmin: false,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 7 * 86400,
    ...overrides,
  }
  return jwt.sign(payload, JWT_SECRET)
}

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use(cookieParser())
  app.use('/api/auth', authRouter)
  app.get('/api/me', requireAuth, getMeHandler)
  return app
}

describe('POST /api/auth/logout', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns 401 without auth token', async () => {
    const res = await request(makeApp()).post('/api/auth/logout')
    expect(res.status).toBe(401)
  })

  it('revokes token, clears cookie, returns 200', async () => {
    const token = makeValidToken()
    const res = await request(makeApp())
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
    expect(mocks.revokeToken).toHaveBeenCalledWith('test-jti', expect.any(Number))
    expect(res.headers['set-cookie']).toBeDefined()
    expect(res.headers['set-cookie'][0]).toContain('token=;')
  })
})

describe('GET /api/me', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns 401 without auth token', async () => {
    const res = await request(makeApp()).get('/api/me')
    expect(res.status).toBe(401)
  })

  it('returns 404 when user not found', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(null)
    const token = makeValidToken()
    const res = await request(makeApp()).get('/api/me').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(404)
  })

  it('returns full user payload', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({
      id: 1,
      email: 'owner@example.com',
      isSuperadmin: false,
      lastLoginAt: null,
      memberships: [{
        role: 'owner',
        orgId: 1,
        userId: 1,
        org: {
          id: 1, name: 'Acme', slug: 'acme', status: 'active',
          subscription: {
            status: 'active',
            trialEndsAt: null,
            currentPeriodEnd: null,
            plan: { name: 'Starter', priceInr: 2999, limitsJson: { leadsPerDay: 34 } },
          },
        },
      }],
    })
    const token = makeValidToken()
    const res = await request(makeApp()).get('/api/me').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.email).toBe('owner@example.com')
    expect(res.body.org.name).toBe('Acme')
    expect(res.body.role).toBe('owner')
    expect(res.body.plan.name).toBe('Starter')
    expect(res.body.plan.priceInr).toBe(2999)
  })
})

describe('GET /api/auth/token', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns 401 when no cookie is set', async () => {
    const token = makeValidToken()
    const res = await request(makeApp())
      .get('/api/auth/token')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(401)
  })

  it('returns token JSON when cookie is present', async () => {
    const token = makeValidToken()
    const res = await request(makeApp())
      .get('/api/auth/token')
      .set('Cookie', `token=${token}`)
    expect(res.status).toBe(200)
    expect(res.body.token).toBe(token)
  })
})
