import { Router, type Request, type Response } from 'express'
import bcrypt from 'bcrypt'
import { z } from 'zod'
import { prisma } from 'shared'
import { signToken } from '../lib/jwt.js'
import { sendOtpEmail } from '../lib/mailer.js'

export const otpRouter = Router()

function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000))
}

const sendSchema = z.object({ email: z.string().email().max(254) })
const verifySchema = z.object({ email: z.string().email().max(254), code: z.string().regex(/^\d{6}$/) })

otpRouter.post('/send', async (req: Request, res: Response) => {
  const parsed = sendSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Valid email required' })
  const { email } = parsed.data

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email },
  })

  const code = generateOtp()
  const codeHash = await bcrypt.hash(code, 10)
  await prisma.otpToken.create({
    data: { userId: user.id, codeHash, expiresAt: new Date(Date.now() + 5 * 60 * 1000) },
  })

  try {
    await sendOtpEmail(email, code)
  } catch (err) {
    // Log but don't reveal failures to caller (avoid enumeration)
    console.error('Failed to send OTP email:', err)
  }

  return res.json({ message: 'OTP sent' })
})

otpRouter.post('/verify', async (req: Request, res: Response) => {
  const parsed = verifySchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Email and 6-digit code required' })
  const { email, code } = parsed.data

  const user = await prisma.user.findUnique({ where: { email } })
  if (!user) return res.status(401).json({ error: 'Invalid code' })

  const token = await prisma.otpToken.findFirst({
    where: { userId: user.id, used: false, expiresAt: { gt: new Date() } },
    orderBy: { id: 'desc' },
  })
  if (!token) return res.status(401).json({ error: 'Invalid or expired code' })

  const match = await bcrypt.compare(code, token.codeHash)
  if (!match) {
    const newAttempts = token.attempts + 1
    if (newAttempts >= 5) {
      await prisma.otpToken.update({
        where: { id: token.id },
        data: { used: true, attempts: newAttempts },
      })
      return res.status(429).json({ error: 'Too many attempts. Request a new code.' })
    }
    await prisma.otpToken.update({ where: { id: token.id }, data: { attempts: newAttempts } })
    return res.status(401).json({ error: 'Invalid code' })
  }

  // Success: mark token used and clean up old tokens for this user
  await prisma.otpToken.update({ where: { id: token.id }, data: { used: true } })
  await prisma.otpToken.deleteMany({
    where: {
      userId: user.id,
      OR: [{ used: true }, { expiresAt: { lt: new Date() } }],
      NOT: { id: token.id },
    },
  })

  // Get or create membership/org/subscription
  let membership = await prisma.orgMembership.findFirst({ where: { userId: user.id } })
  if (!membership) {
    const slugBase = email.split('@')[0].replace(/[^a-z0-9]/gi, '').toLowerCase() || 'org'
    const org = await prisma.org.create({
      data: { name: slugBase, slug: `${slugBase}-${Date.now()}` },
    })
    const trialPlan = await prisma.plan.findFirst({ where: { name: 'Trial' } })
    if (!trialPlan) {
      console.error('Trial plan missing in DB')
      return res.status(500).json({ error: 'Server misconfigured' })
    }
    await prisma.orgSubscription.create({
      data: {
        orgId: org.id,
        planId: trialPlan.id,
        status: 'trial',
        trialEndsAt: new Date(Date.now() + 14 * 86400 * 1000),
      },
    })
    membership = await prisma.orgMembership.create({
      data: { orgId: org.id, userId: user.id, role: 'owner' },
    })
  }

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })

  const jwt = signToken({
    userId: user.id,
    orgId: membership.orgId,
    role: membership.role,
    isSuperadmin: user.isSuperadmin,
  })

  res.cookie('token', jwt, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 86400 * 1000,
  })

  return res.json({ token: jwt, message: 'Authenticated' })
})
