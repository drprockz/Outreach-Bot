import { Router, type Request, type Response } from 'express'
import { requireAuth, type AuthedRequest } from '../middleware/requireAuth.js'
import { revokeToken } from '../lib/tokenRevocation.js'
import { prisma } from 'shared'

export const authRouter = Router()

// POST /api/auth/logout
authRouter.post('/logout', requireAuth, async (req: Request, res: Response) => {
  const { jti, exp } = (req as AuthedRequest).user
  const ttl = Math.max(1, exp - Math.floor(Date.now() / 1000))
  await revokeToken(jti, ttl)
  res.clearCookie('token', { httpOnly: true, secure: true, sameSite: 'lax', path: '/' })
  return res.status(200).json({ ok: true })
})

// GET /api/auth/token — return cookie JWT as JSON body (for WebSocket connectionParams)
authRouter.get('/token', requireAuth, (req: Request, res: Response) => {
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies
  const token = cookies?.token
  if (!token) return res.status(401).json({ error: 'No token cookie' })
  return res.json({ token })
})

// Handler exported separately because it mounts at /api/me, not /api/auth/me
export async function getMeHandler(req: Request, res: Response): Promise<void> {
  const { userId, orgId } = (req as AuthedRequest).user
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      memberships: {
        where: { orgId },
        include: {
          org: { include: { subscription: { include: { plan: true } } } },
        },
      },
    },
  })
  if (!user) {
    res.status(404).json({ error: 'User not found' })
    return
  }
  const membership = user.memberships[0] ?? null
  const sub = membership?.org.subscription ?? null
  res.json({
    id: user.id,
    email: user.email,
    isSuperadmin: user.isSuperadmin,
    lastLoginAt: user.lastLoginAt,
    org: membership
      ? { id: membership.org.id, name: membership.org.name, slug: membership.org.slug, status: membership.org.status }
      : null,
    role: membership?.role ?? null,
    plan: sub
      ? {
          name: sub.plan.name,
          priceInr: sub.plan.priceInr,
          limitsJson: sub.plan.limitsJson,
          status: sub.status,
          trialEndsAt: sub.trialEndsAt,
          currentPeriodEnd: sub.currentPeriodEnd,
        }
      : null,
  })
}
