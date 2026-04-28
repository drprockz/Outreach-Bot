import jwt from 'jsonwebtoken'
import { v4 as uuidv4 } from 'uuid'
import type { Role } from '@prisma/client'

const INSECURE_DEFAULTS = new Set([
  'change-me-in-production',
  'default-secret-change-me',
  '',
])

function loadJwtSecret(): string {
  const secret = process.env.JWT_SECRET
  if (!secret || INSECURE_DEFAULTS.has(secret)) {
    throw new Error(
      'JWT_SECRET is missing or set to a known-insecure default. ' +
      'Generate a strong secret (e.g. `openssl rand -hex 32`) and set JWT_SECRET in .env.',
    )
  }
  if (secret.length < 32) {
    throw new Error(
      `JWT_SECRET is only ${secret.length} characters; require at least 32. ` +
      'Generate a stronger one with `openssl rand -hex 32`.',
    )
  }
  return secret
}

const JWT_SECRET = loadJwtSecret()
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? '7d'

export interface JwtPayload {
  jti: string
  userId: number
  orgId: number
  role: Role
  isSuperadmin: boolean
  iat: number
  exp: number
  // Impersonation-only (set when adminImpersonate issues a scoped token)
  impersonating?: true
  originalAdminId?: number
}

export function signToken(payload: Omit<JwtPayload, 'jti' | 'iat' | 'exp'>, expiresIn?: string): string {
  return jwt.sign({ ...payload, jti: uuidv4() }, JWT_SECRET, { expiresIn: expiresIn ?? JWT_EXPIRES_IN } as jwt.SignOptions)
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload
}
