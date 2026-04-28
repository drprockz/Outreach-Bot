import type { Request, Response, NextFunction } from 'express'
import type { Role } from '@prisma/client'
import type { JwtPayload } from '../lib/jwt.js'

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as Request & { user?: JwtPayload }).user
    if (!user) return res.status(401).json({ error: 'Authentication required' })
    if (!user.isSuperadmin && !roles.includes(user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' })
    }
    return next()
  }
}
