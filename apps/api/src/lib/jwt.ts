import jwt from 'jsonwebtoken'
import { v4 as uuidv4 } from 'uuid'
import type { Role } from '@prisma/client'

const JWT_SECRET = process.env.JWT_SECRET ?? 'change-me-in-production'
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? '7d'

export interface JwtPayload {
  jti: string
  userId: number
  orgId: number
  role: Role
  isSuperadmin: boolean
  iat: number
  exp: number
}

export function signToken(payload: Omit<JwtPayload, 'jti' | 'iat' | 'exp'>): string {
  return jwt.sign({ ...payload, jti: uuidv4() }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions)
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload
}
