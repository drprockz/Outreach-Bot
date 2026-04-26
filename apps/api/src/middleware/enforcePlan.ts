import type { Request, Response, NextFunction } from 'express'
import { prisma } from 'shared'
import type { JwtPayload } from '../lib/jwt.js'

export interface PlanLimits {
  leadsPerDay: number
  seats: number
  claudeDailySpendCapUsd: number
  geminiQueriesPerDay: number
  bulkRetryEnabled: boolean
  exportEnabled: boolean
  apiAccess: boolean
}

export interface PlanScopedRequest extends Request {
  planLimits: PlanLimits
  planName: string
}

export async function checkOrgStatus(req: Request, res: Response, next: NextFunction) {
  const user = (req as Request & { user?: JwtPayload }).user
  if (!user) return res.status(401).json({ error: 'Authentication required' })

  const sub = await prisma.orgSubscription.findUnique({
    where: { orgId: user.orgId },
    include: { plan: true },
  })
  if (!sub) return res.status(402).json({ error: 'No active subscription', code: 'NO_SUBSCRIPTION' })

  if (sub.status === 'locked') {
    return res.status(402).json({ error: 'Subscription required', code: 'PAYMENT_REQUIRED' })
  }
  if (sub.status === 'suspended' || (await prisma.org.findUnique({ where: { id: user.orgId } }))?.status === 'suspended') {
    return res.status(403).json({ error: 'Account suspended', code: 'SUSPENDED' })
  }

  // Auto-lock expired trial
  if (sub.status === 'trial' && sub.trialEndsAt && sub.trialEndsAt < new Date()) {
    await prisma.orgSubscription.update({
      where: { orgId: user.orgId }, data: { status: 'locked' },
    })
    await prisma.org.update({ where: { id: user.orgId }, data: { status: 'locked' } })
    return res.status(402).json({ error: 'Trial expired', code: 'PAYMENT_REQUIRED' })
  }

  // Auto-lock expired grace period
  if (sub.status === 'grace' && sub.graceEndsAt && sub.graceEndsAt < new Date()) {
    await prisma.orgSubscription.update({
      where: { orgId: user.orgId }, data: { status: 'locked' },
    })
    await prisma.org.update({ where: { id: user.orgId }, data: { status: 'locked' } })
    return res.status(402).json({ error: 'Payment failed and grace period expired', code: 'PAYMENT_REQUIRED' })
  }

  ;(req as PlanScopedRequest).planLimits = sub.plan.limitsJson as unknown as PlanLimits
  ;(req as PlanScopedRequest).planName = sub.plan.name
  return next()
}

/**
 * Guard for feature flags on the plan, e.g. `requirePlanFeature('bulkRetryEnabled')`.
 * Must run AFTER checkOrgStatus.
 */
export function requirePlanFeature(feature: keyof PlanLimits) {
  return (req: Request, res: Response, next: NextFunction) => {
    const limits = (req as PlanScopedRequest).planLimits
    if (!limits) return res.status(500).json({ error: 'Plan context missing — checkOrgStatus must run first' })
    if (!limits[feature]) {
      return res.status(403).json({ error: `Feature '${String(feature)}' not available on your plan`, code: 'PLAN_FEATURE_LOCKED' })
    }
    return next()
  }
}
