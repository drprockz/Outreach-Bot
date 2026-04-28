import type { Request, Response, NextFunction } from 'express'
import type { JwtPayload } from '../lib/jwt.js'

export function requireSuperadmin(req: Request, res: Response, next: NextFunction) {
  const user = (req as Request & { user?: JwtPayload }).user
  if (!user?.isSuperadmin) return res.status(403).json({ error: 'Superadmin required' })
  return next()
}
