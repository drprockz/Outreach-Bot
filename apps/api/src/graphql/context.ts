import type { Request } from 'express'
import { createScopedPrisma, prisma } from 'shared'
import { verifyToken } from '../lib/jwt.js'
import { isTokenRevoked, isOrgRevoked } from '../lib/tokenRevocation.js'
import { pubsub, type Context } from './builder.js'

export async function createContext(req: Request): Promise<Context> {
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies
  const token = cookies?.token ?? req.headers.authorization?.replace('Bearer ', '')
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
