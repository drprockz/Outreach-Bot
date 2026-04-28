import rateLimit from 'express-rate-limit'
import type { Request } from 'express'
import type { JwtPayload } from '../lib/jwt.js'

const PLAN_RPM: Record<string, number> = {
  Trial: 30, Starter: 60, Growth: 120, Agency: 300,
}

/**
 * Per-org API rate limiting. Reads plan name from `req.planName` set by checkOrgStatus.
 * Falls back to 30 rpm if plan unknown (defensive default).
 */
export const orgRateLimit = rateLimit({
  windowMs: 60 * 1000,
  // express-rate-limit v7 max must be a sync function
  max: (req: Request) => {
    const planName = (req as Request & { planName?: string }).planName
    return PLAN_RPM[planName ?? ''] ?? 30
  },
  keyGenerator: (req: Request) => {
    const user = (req as Request & { user?: JwtPayload }).user
    return user ? `org:${user.orgId}` : (req.ip ?? 'unknown')
  },
  message: { error: 'Rate limit exceeded' },
  standardHeaders: true,
  legacyHeaders: false,
})

/**
 * IP-based rate limiting for OTP endpoints (no JWT yet).
 * 10 requests per 15 minutes per IP.
 */
export const otpRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: (req: Request) => req.ip ?? 'unknown',
  message: { error: 'Too many OTP requests. Try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
})

/**
 * IP-based rate limiting for Google OAuth start. Bots that hit /auth/google
 * harvest cookies + state params. 20 starts per 5 minutes per IP is plenty
 * for a real user retrying.
 */
export const googleRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 20,
  keyGenerator: (req: Request) => req.ip ?? 'unknown',
  message: { error: 'Too many login attempts. Try again in a few minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
})
