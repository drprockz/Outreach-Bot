import { Router, type Request, type Response } from 'express'
import crypto from 'node:crypto'
import { prisma } from 'shared'
import { revokeOrgTokens } from '../lib/tokenRevocation.js'

interface RazorpayWebhookPayload {
  event: string
  payload?: {
    subscription?: { entity?: { id?: string; notes?: Record<string, string> } }
    payment?: { entity?: { id?: string; subscription_id?: string } }
  }
}

interface RawBodyRequest extends Request {
  rawBody?: Buffer
}

export const razorpayWebhookRouter = Router()

razorpayWebhookRouter.post('/', async (req: Request, res: Response) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET
  if (!secret) {
    console.error('[razorpay] RAZORPAY_WEBHOOK_SECRET not configured')
    return res.status(503).json({ error: 'Webhook not configured' })
  }

  const signature = req.headers['x-razorpay-signature']
  if (typeof signature !== 'string') {
    return res.status(400).json({ error: 'Missing signature' })
  }

  const rawBody = (req as RawBodyRequest).rawBody ?? Buffer.from(JSON.stringify(req.body))
  if (!(req as RawBodyRequest).rawBody) {
    console.warn('[razorpay] req.rawBody not set — falling back to JSON.stringify (signature may not match if body has whitespace differences)')
  }

  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  const sigBuf = Buffer.from(signature, 'utf8')
  const expBuf = Buffer.from(expected, 'utf8')
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return res.status(400).json({ error: 'Invalid signature' })
  }

  const body = req.body as RazorpayWebhookPayload
  const eventId =
    body.payload?.subscription?.entity?.id ??
    body.payload?.payment?.entity?.id ??
    `${body.event}-${Date.now()}`

  // Find target subscription
  const rzpSubId =
    body.payload?.subscription?.entity?.id ??
    body.payload?.payment?.entity?.subscription_id
  if (!rzpSubId) {
    return res.json({ ok: true, ignored: 'no subscription id' })
  }

  const orgSub = await prisma.orgSubscription.findFirst({ where: { razorpaySubId: rzpSubId } })
  if (!orgSub) {
    return res.json({ ok: true, ignored: 'unknown subscription' })
  }

  // Idempotency
  const existing = await prisma.razorpayWebhookEvent.findUnique({ where: { razorpayEventId: eventId } })
  if (existing) {
    return res.json({ ok: true, deduped: true })
  }

  await prisma.razorpayWebhookEvent.create({
    data: { razorpayEventId: eventId, eventType: body.event, orgSubId: orgSub.id },
  })

  switch (body.event) {
    case 'subscription.activated':
      await prisma.orgSubscription.update({ where: { id: orgSub.id }, data: { status: 'active' } })
      await prisma.org.update({ where: { id: orgSub.orgId }, data: { status: 'active' } })
      break
    case 'subscription.charged':
      await prisma.orgSubscription.update({
        where: { id: orgSub.id },
        data: { status: 'active', currentPeriodEnd: new Date(Date.now() + 30 * 86400_000), graceEndsAt: null },
      })
      await prisma.org.update({ where: { id: orgSub.orgId }, data: { status: 'active' } })
      break
    case 'subscription.cancelled':
      await prisma.orgSubscription.update({
        where: { id: orgSub.id }, data: { cancelAtPeriodEnd: true },
      })
      break
    case 'subscription.completed':
      await prisma.orgSubscription.update({ where: { id: orgSub.id }, data: { status: 'locked' } })
      await prisma.org.update({ where: { id: orgSub.orgId }, data: { status: 'locked' } })
      await revokeOrgTokens(orgSub.orgId)
      break
    case 'payment.failed':
      await prisma.orgSubscription.update({
        where: { id: orgSub.id },
        data: { status: 'grace', graceEndsAt: new Date(Date.now() + 3 * 86400_000) },
      })
      // Telegram + email alert is handled by a separate notification service later
      break
    default:
      // Unknown event — we logged it via RazorpayWebhookEvent for audit
      break
  }

  return res.json({ ok: true })
})
