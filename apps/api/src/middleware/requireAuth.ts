import type { Request, Response, NextFunction } from 'express'
import { verifyToken, type JwtPayload } from '../lib/jwt.js'
import { isTokenRevoked, isOrgRevoked } from '../lib/tokenRevocation.js'

export interface AuthedRequest extends Request {
  user: JwtPayload
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies
  const token = cookies?.token ?? req.headers.authorization?.replace('Bearer ', '')
  if (!token) return res.status(401).json({ error: 'Authentication required' })

  try {
    const payload = verifyToken(token)
    if (await isTokenRevoked(payload.jti)) return res.status(401).json({ error: 'Token revoked' })
    if (await isOrgRevoked(payload.orgId, payload.iat)) return res.status(401).json({ error: 'Session expired' })
    ;(req as AuthedRequest).user = payload
    return next()
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
}
