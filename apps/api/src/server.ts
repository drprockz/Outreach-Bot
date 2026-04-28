import express, { type NextFunction, type Request, type Response } from 'express'
import cookieParser from 'cookie-parser'
import passport from 'passport'
import { createYoga } from 'graphql-yoga'
import { WebSocketServer } from 'ws'
import { useServer } from 'graphql-ws/lib/use/ws'
import { createServer } from 'node:http'
import pino from 'pino'

import { schema } from './graphql/schema.js'
import { createContext } from './graphql/context.js'
import { pubsub } from './graphql/builder.js'
import { verifyToken } from './lib/jwt.js'
import { isTokenRevoked, isOrgRevoked } from './lib/tokenRevocation.js'
import { redis } from './lib/redis.js'
import { createScopedPrisma, prisma } from 'shared'

import { googleRouter } from './webhooks/google.js'
import { razorpayWebhookRouter } from './webhooks/razorpay.js'
import { otpRouter } from './routes/otp.js'
import { billingRouter } from './routes/billing.js'
import { authRouter, getMeHandler } from './routes/auth.js'

import { requireAuth } from './middleware/requireAuth.js'
import { requireSuperadmin } from './middleware/requireSuperadmin.js'
import { checkOrgStatus } from './middleware/enforcePlan.js'
import { orgRateLimit, otpRateLimit } from './middleware/rateLimits.js'

import { Queue } from 'bullmq'
import { createBullBoard } from '@bull-board/api'
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter'
import { ExpressAdapter } from '@bull-board/express'

const logger = pino({
  transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
})

const app = express()
const httpServer = createServer(app)

// Cookie parsing FIRST so all downstream middleware can read req.cookies
app.use(cookieParser())

// JSON body parser with raw-body capture for the Razorpay webhook only.
// Without this, HMAC signature verification fails because the parsed JSON
// can differ from the literal bytes Razorpay signed (whitespace, key order).
app.use(express.json({
  verify: (req: Request, _res, buf) => {
    if (req.originalUrl?.startsWith('/api/billing/webhook')) {
      ;(req as Request & { rawBody?: Buffer }).rawBody = Buffer.from(buf)
    }
  },
  limit: '1mb',
}))

app.use(passport.initialize())

// Health check (no auth)
app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }))

// === AUTH ROUTES (public) ===
app.use('/auth/google', googleRouter)
app.use('/api/otp', otpRateLimit, otpRouter)

// === AUTH ROUTES (auth-required) ===
app.use('/api/auth', authRouter)
app.get('/api/me', requireAuth, getMeHandler)

// === RAZORPAY WEBHOOK — MUST come BEFORE /api/billing ===
// No auth; HMAC verified inside the handler using req.rawBody.
app.use('/api/billing/webhook', razorpayWebhookRouter)

// === BILLING ROUTES (auth required, runs checkOrgStatus to load plan) ===
app.use('/api/billing', billingRouter)

// === GRAPHQL HTTP ===
const yoga = createYoga({
  schema,
  context: ({ request }) => createContext(request as unknown as Request),
  graphqlEndpoint: '/graphql',
  // GraphiQL UI in dev only
  graphiql: process.env.NODE_ENV === 'development',
  // Disable masked errors in dev for easier debugging
  maskedErrors: process.env.NODE_ENV === 'production',
})
app.use('/graphql', requireAuth, checkOrgStatus, orgRateLimit, yoga)

// === BULL BOARD (superadmin only) ===
// Workers come in Task 15. For now, scaffold the queues so the route exists
// but the dashboard shows empty queues.
const queueNames = ['findLeads', 'sendEmails', 'sendFollowups', 'checkReplies', 'dailyReport', 'healthCheck', 'trialExpiry'] as const
const bullQueues = queueNames.map((name) => new Queue(name, { connection: redis }))
const serverAdapter = new ExpressAdapter()
serverAdapter.setBasePath('/admin/queues')
createBullBoard({ queues: bullQueues.map((q) => new BullMQAdapter(q)), serverAdapter })
app.use('/admin/queues', requireAuth, requireSuperadmin, serverAdapter.getRouter())

// === GRAPHQL WS (subscriptions) ===
const wss = new WebSocketServer({ server: httpServer, path: '/graphql' })
useServer({
  schema,
  onConnect: async (ctx) => {
    const params = ctx.connectionParams as Record<string, string> | undefined
    const token = params?.authToken
    if (!token) {
      logger.warn('[ws] connection without authToken')
      return false  // graphql-ws closes with 4401
    }
    try {
      const payload = verifyToken(token)
      if (await isTokenRevoked(payload.jti)) return false
      if (await isOrgRevoked(payload.orgId, payload.iat)) return false
      ;(ctx.extra as unknown as { user?: typeof payload }).user = payload
      return true
    } catch {
      return false
    }
  },
  context: (ctx) => {
    const user = (ctx.extra as unknown as { user: ReturnType<typeof verifyToken> }).user
    const db = user.isSuperadmin ? prisma : createScopedPrisma(user.orgId)
    return { user, db, pubsub }
  },
}, wss as unknown as Parameters<typeof useServer>[1])

// === ERROR HANDLER ===
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err }, 'unhandled')
  res.status(500).json({ error: 'Internal server error' })
})

// === BOOT ===
const PORT = Number(process.env.DASHBOARD_PORT ?? 3001)
httpServer.listen(PORT, () => {
  logger.info({ port: PORT, env: process.env.NODE_ENV ?? 'development' }, 'Radar API started')
})

// Graceful shutdown
function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down')
  httpServer.close(() => {
    Promise.all(bullQueues.map((q) => q.close())).then(() => {
      redis.disconnect()
      process.exit(0)
    })
  })
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
