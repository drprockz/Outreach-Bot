import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import cookieParser from 'cookie-parser'
import request from 'supertest'

const mocks = vi.hoisted(() => {
  const prisma = {
    user: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    otpToken: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
    orgMembership: { findFirst: vi.fn(), create: vi.fn() },
    org: { create: vi.fn() },
    plan: { findFirst: vi.fn() },
    orgSubscription: { create: vi.fn() },
  }
  const sendOtpEmail = vi.fn().mockResolvedValue(undefined)
  const signToken = vi.fn().mockReturnValue('mock-jwt')
  return { prisma, sendOtpEmail, signToken }
})

vi.mock('shared', () => ({ prisma: mocks.prisma }))
vi.mock('../lib/mailer.js', () => ({ sendOtpEmail: mocks.sendOtpEmail }))
vi.mock('../lib/jwt.js', () => ({ signToken: mocks.signToken }))

import { otpRouter } from './otp.js'

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use(cookieParser())
  app.use('/api/otp', otpRouter)
  return app
}

describe('POST /api/otp/send', () => {
  beforeEach(() => {
    Object.values(mocks.prisma).forEach((model) => Object.values(model).forEach((fn) => fn.mockReset()))
    mocks.sendOtpEmail.mockReset().mockResolvedValue(undefined)
    mocks.prisma.user.upsert.mockResolvedValue({ id: 1, email: 'test@example.com', isSuperadmin: false })
    mocks.prisma.otpToken.create.mockResolvedValue({ id: 1 })
  })

  it('returns 200 on valid email', async () => {
    const res = await request(makeApp()).post('/api/otp/send').send({ email: 'test@example.com' })
    expect(res.status).toBe(200)
    expect(res.body.message).toBe('OTP sent')
    expect(mocks.sendOtpEmail).toHaveBeenCalled()
  })

  it('returns 400 on missing email', async () => {
    const res = await request(makeApp()).post('/api/otp/send').send({})
    expect(res.status).toBe(400)
  })

  it('returns 400 on invalid email format', async () => {
    const res = await request(makeApp()).post('/api/otp/send').send({ email: 'not-email' })
    expect(res.status).toBe(400)
  })
})

describe('POST /api/otp/verify', () => {
  const baseUser = { id: 1, email: 'test@example.com', isSuperadmin: false }
  const validToken = {
    id: 99,
    userId: 1,
    codeHash: '$2b$10$mockhashedcode',
    used: false,
    attempts: 0,
    expiresAt: new Date(Date.now() + 60_000),
  }

  beforeEach(() => {
    Object.values(mocks.prisma).forEach((model) => Object.values(model).forEach((fn) => fn.mockReset()))
    mocks.signToken.mockReset().mockReturnValue('mock-jwt')
    mocks.prisma.user.findUnique.mockResolvedValue(baseUser)
    mocks.prisma.user.update.mockResolvedValue(baseUser)
    mocks.prisma.otpToken.findFirst.mockResolvedValue(validToken)
    mocks.prisma.otpToken.update.mockResolvedValue(validToken)
    mocks.prisma.otpToken.deleteMany.mockResolvedValue({ count: 0 })
    mocks.prisma.orgMembership.findFirst.mockResolvedValue({ id: 1, orgId: 1, userId: 1, role: 'owner' })
  })

  it('returns 401 for unknown email', async () => {
    mocks.prisma.user.findUnique.mockResolvedValueOnce(null)
    const res = await request(makeApp()).post('/api/otp/verify').send({ email: 'x@x.com', code: '123456' })
    expect(res.status).toBe(401)
  })

  it('returns 401 when no valid OtpToken found', async () => {
    mocks.prisma.otpToken.findFirst.mockResolvedValueOnce(null)
    const res = await request(makeApp()).post('/api/otp/verify').send({ email: 'test@example.com', code: '123456' })
    expect(res.status).toBe(401)
  })

  it('returns 401 on wrong code and increments attempts', async () => {
    const bcrypt = await import('bcrypt')
    const realHash = await bcrypt.hash('999999', 10)
    mocks.prisma.otpToken.findFirst.mockResolvedValueOnce({ ...validToken, codeHash: realHash })
    const res = await request(makeApp()).post('/api/otp/verify').send({ email: 'test@example.com', code: '111111' })
    expect(res.status).toBe(401)
    expect(mocks.prisma.otpToken.update).toHaveBeenCalledWith({
      where: { id: validToken.id },
      data: { attempts: 1 },
    })
  })

  it('locks token at 5 attempts', async () => {
    const bcrypt = await import('bcrypt')
    const realHash = await bcrypt.hash('999999', 10)
    mocks.prisma.otpToken.findFirst.mockResolvedValueOnce({ ...validToken, codeHash: realHash, attempts: 4 })
    const res = await request(makeApp()).post('/api/otp/verify').send({ email: 'test@example.com', code: '111111' })
    expect(res.status).toBe(429)
    expect(mocks.prisma.otpToken.update).toHaveBeenCalledWith({
      where: { id: validToken.id },
      data: { used: true, attempts: 5 },
    })
  })

  it('issues JWT cookie + JSON token on correct code', async () => {
    const bcrypt = await import('bcrypt')
    const realHash = await bcrypt.hash('123456', 10)
    mocks.prisma.otpToken.findFirst.mockResolvedValueOnce({ ...validToken, codeHash: realHash })
    const res = await request(makeApp()).post('/api/otp/verify').send({ email: 'test@example.com', code: '123456' })
    expect(res.status).toBe(200)
    expect(res.body.token).toBe('mock-jwt')
    expect(res.headers['set-cookie'][0]).toMatch(/token=mock-jwt/)
    expect(res.headers['set-cookie'][0]).toMatch(/HttpOnly/)
  })

  it('creates Org + membership + trial subscription on first login', async () => {
    const bcrypt = await import('bcrypt')
    const realHash = await bcrypt.hash('123456', 10)
    mocks.prisma.otpToken.findFirst.mockResolvedValueOnce({ ...validToken, codeHash: realHash })
    mocks.prisma.orgMembership.findFirst.mockResolvedValueOnce(null)
    mocks.prisma.org.create.mockResolvedValueOnce({ id: 7, name: 'test', slug: 'test-1' })
    mocks.prisma.plan.findFirst.mockResolvedValueOnce({ id: 1, name: 'Trial' })
    mocks.prisma.orgSubscription.create.mockResolvedValueOnce({ id: 1 })
    mocks.prisma.orgMembership.create.mockResolvedValueOnce({ id: 7, orgId: 7, userId: 1, role: 'owner' })

    const res = await request(makeApp()).post('/api/otp/verify').send({ email: 'test@example.com', code: '123456' })
    expect(res.status).toBe(200)
    expect(mocks.prisma.org.create).toHaveBeenCalled()
    expect(mocks.prisma.orgSubscription.create).toHaveBeenCalled()
    expect(mocks.prisma.orgMembership.create).toHaveBeenCalled()
  })
})
