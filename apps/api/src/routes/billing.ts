import { Router, type Request, type Response } from 'express'
import Razorpay from 'razorpay'
import { z } from 'zod'
import { prisma } from 'shared'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireRole } from '../middleware/requireRole.js'
import type { JwtPayload } from '../lib/jwt.js'

const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID ?? ''
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET ?? ''

let razorpay: Razorpay | null = null
if (RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET) {
  razorpay = new Razorpay({ key_id: RAZORPAY_KEY_ID, key_secret: RAZORPAY_KEY_SECRET })
}

export const billingRouter = Router()
billingRouter.use(requireAuth)

// GET current subscription + plan + key usage
billingRouter.get('/portal', async (req: Request, res: Response) => {
  const user = (req as Request & { user: JwtPayload }).user
  const sub = await prisma.orgSubscription.findUnique({
    where: { orgId: user.orgId },
    include: { plan: true },
  })
  if (!sub) return res.status(404).json({ error: 'No subscription' })

  // Today's usage from daily_metrics (single-org scope; for the JS legacy code this writes globally — expected to be tightened in Task 15)
  const todayMetric = await prisma.dailyMetrics.findFirst({
    where: { orgId: user.orgId, date: new Date().toISOString().slice(0, 10) },
  })

  return res.json({
    plan: sub.plan.name,
    priceInr: sub.plan.priceInr,
    status: sub.status,
    trialEndsAt: sub.trialEndsAt,
    currentPeriodEnd: sub.currentPeriodEnd,
    graceEndsAt: sub.graceEndsAt,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    limitsJson: sub.plan.limitsJson,
    usage: {
      leadsToday: todayMetric?.leadsReady ?? 0,
      claudeSpendUsd: Number(todayMetric?.sonnetCostUsd ?? 0) + Number(todayMetric?.haikuCostUsd ?? 0),
      geminiQueriesUsed: Number(todayMetric?.geminiCostUsd ?? 0),
    },
  })
})

const createSubSchema = z.object({ planId: z.number().int().positive() })

billingRouter.post('/create-subscription', requireRole('owner'), async (req: Request, res: Response) => {
  if (!razorpay) return res.status(503).json({ error: 'Billing not configured' })

  const parsed = createSubSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'planId required' })

  const user = (req as Request & { user: JwtPayload }).user
  const plan = await prisma.plan.findUnique({ where: { id: parsed.data.planId } })
  if (!plan) return res.status(404).json({ error: 'Plan not found' })
  if (plan.priceInr === 0) return res.status(400).json({ error: 'Cannot subscribe to free plan' })

  // Razorpay plan IDs must be pre-created in the Razorpay dashboard with naming convention plan_<lowercase>
  const rzpPlanId = `plan_${plan.name.toLowerCase()}`

  try {
    const rSub = await razorpay.subscriptions.create({
      plan_id: rzpPlanId,
      total_count: 12,
      quantity: 1,
      notes: { orgId: String(user.orgId), planId: String(plan.id) },
    } as never)

    await prisma.orgSubscription.update({
      where: { orgId: user.orgId },
      data: { razorpaySubId: rSub.id, planId: plan.id },
    })

    return res.json({
      subscriptionId: rSub.id,
      checkoutUrl: `https://rzp.io/i/${rSub.id}`,
    })
  } catch (err) {
    console.error('[razorpay] create subscription failed:', err)
    return res.status(500).json({ error: 'Failed to create subscription' })
  }
})

billingRouter.post('/cancel', requireRole('owner'), async (req: Request, res: Response) => {
  const user = (req as Request & { user: JwtPayload }).user
  await prisma.orgSubscription.update({
    where: { orgId: user.orgId },
    data: { cancelAtPeriodEnd: true },
  })
  return res.json({ cancelAtPeriodEnd: true, message: 'Subscription will end at current period close' })
})

const changePlanSchema = z.object({ planId: z.number().int().positive() })

billingRouter.post('/change-plan', requireRole('owner'), async (req: Request, res: Response) => {
  const parsed = changePlanSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'planId required' })

  const user = (req as Request & { user: JwtPayload }).user
  const plan = await prisma.plan.findUnique({ where: { id: parsed.data.planId } })
  if (!plan) return res.status(404).json({ error: 'Plan not found' })

  // Mid-cycle plan changes via Razorpay's update_subscription API would happen here.
  // For now, just record the planId locally; the next billing cycle will use the new plan.
  await prisma.orgSubscription.update({
    where: { orgId: user.orgId },
    data: { planId: plan.id },
  })

  return res.json({ planId: plan.id, planName: plan.name, effective: 'next_cycle' })
})
