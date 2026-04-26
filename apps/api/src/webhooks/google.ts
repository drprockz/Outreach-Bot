import { Router, type Request, type Response, type NextFunction } from 'express'
import passport from 'passport'
import { Strategy as GoogleStrategy, type Profile } from 'passport-google-oauth20'
import { prisma } from 'shared'
import { signToken } from '../lib/jwt.js'
import { requireAuth } from '../middleware/requireAuth.js'

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? ''
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? ''
const GOOGLE_CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL ?? 'http://localhost:3001/auth/google/callback'
const DASHBOARD_URL = process.env.DASHBOARD_URL ?? 'http://localhost:5173'

if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
        callbackURL: GOOGLE_CALLBACK_URL,
      },
      async (
        _accessToken: string,
        _refreshToken: string,
        profile: Profile,
        done: (err: Error | null, user?: { token: string }) => void,
      ) => {
        try {
          const email = profile.emails?.[0]?.value
          if (!email) return done(new Error('No email from Google'))

          let user = await prisma.user.findFirst({
            where: { OR: [{ googleId: profile.id }, { email }] },
          })
          if (!user) {
            user = await prisma.user.create({ data: { email, googleId: profile.id } })
          } else if (!user.googleId) {
            user = await prisma.user.update({
              where: { id: user.id },
              data: { googleId: profile.id },
            })
          }
          await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })

          let membership = await prisma.orgMembership.findFirst({ where: { userId: user.id } })
          if (!membership) {
            const slugBase = email.split('@')[0].replace(/[^a-z0-9]/gi, '').toLowerCase() || 'org'
            const org = await prisma.org.create({
              data: { name: slugBase, slug: `${slugBase}-${Date.now()}` },
            })
            const trialPlan = await prisma.plan.findFirst({ where: { name: 'Trial' } })
            if (!trialPlan) return done(new Error('Trial plan not configured'))
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

          const token = signToken({
            userId: user.id,
            orgId: membership.orgId,
            role: membership.role,
            isSuperadmin: user.isSuperadmin,
          })
          return done(null, { token })
        } catch (err) {
          return done(err as Error)
        }
      },
    ),
  )
}

export const googleRouter = Router()

googleRouter.get('/', (req, res, next) => {
  if (!GOOGLE_CLIENT_ID) return res.status(503).json({ error: 'Google OAuth not configured' })
  return passport.authenticate('google', { scope: ['email', 'profile'], session: false })(req, res, next)
})

googleRouter.get(
  '/callback',
  (req: Request, res: Response, next: NextFunction) => {
    if (!GOOGLE_CLIENT_ID) return res.status(503).json({ error: 'Google OAuth not configured' })
    return passport.authenticate('google', {
      session: false,
      failureRedirect: `${DASHBOARD_URL}/login?error=oauth`,
    })(req, res, next)
  },
  (req: Request, res: Response) => {
    const { token } = (req.user as { token: string }) ?? {}
    if (!token) return res.redirect(`${DASHBOARD_URL}/login?error=oauth`)
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 86400 * 1000,
    })
    return res.redirect(`${DASHBOARD_URL}/dashboard`)
  },
)

// Echo cookie token back as JSON — for WebSocket connectionParams (HttpOnly cookie can't be read by JS)
googleRouter.get('/token', requireAuth, (req: Request, res: Response) => {
  const token = (req as Request & { cookies?: Record<string, string> }).cookies?.token
  if (!token) return res.status(401).json({ error: 'No token' })
  return res.json({ token })
})
