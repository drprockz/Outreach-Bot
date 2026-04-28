import { createScopedPrisma, prisma } from 'shared'
import { verifyToken } from '../lib/jwt.js'
import { isTokenRevoked, isOrgRevoked } from '../lib/tokenRevocation.js'
import { pubsub, type Context } from './builder.js'

/**
 * Build the GraphQL context for HTTP requests.
 *
 * graphql-yoga passes a Fetch API Request whose `headers` is a `Headers`
 * instance (not a plain object). Express's Request has `headers` as a plain
 * object. We support both shapes so this factory works whether yoga is
 * mounted on Express or run standalone.
 */
type AnyRequest = {
  headers: Headers | Record<string, string | string[] | undefined>
  // Express may also expose pre-parsed cookies from cookie-parser middleware
  cookies?: Record<string, string>
}

function readHeader(headers: AnyRequest['headers'], name: string): string | undefined {
  if (typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get(name) ?? undefined
  }
  const raw = (headers as Record<string, string | string[] | undefined>)[name.toLowerCase()]
  if (Array.isArray(raw)) return raw[0]
  return raw
}

function extractToken(req: AnyRequest): string | undefined {
  // 1) Pre-parsed cookies (Express + cookie-parser)
  const cookieToken = req.cookies?.token
  if (cookieToken) return cookieToken

  // 2) Authorization: Bearer <jwt>
  const auth = readHeader(req.headers, 'authorization')
  if (auth?.startsWith('Bearer ')) return auth.slice(7)

  // 3) Cookie header parsed manually (Fetch API path — no cookie-parser)
  const cookieHeader = readHeader(req.headers, 'cookie')
  if (cookieHeader) {
    const match = cookieHeader.match(/(?:^|;\s*)token=([^;]+)/)
    if (match) return decodeURIComponent(match[1])
  }

  return undefined
}

export async function createContext(req: AnyRequest): Promise<Context> {
  const token = extractToken(req)
  if (!token) return { user: null, db: prisma, pubsub }

  try {
    const payload = verifyToken(token)
    if (await isTokenRevoked(payload.jti)) return { user: null, db: prisma, pubsub }
    if (await isOrgRevoked(payload.orgId, payload.iat)) return { user: null, db: prisma, pubsub }
    const db = payload.isSuperadmin ? prisma : createScopedPrisma(payload.orgId)
    return { user: payload, db, pubsub }
  } catch {
    return { user: null, db: prisma, pubsub }
  }
}
