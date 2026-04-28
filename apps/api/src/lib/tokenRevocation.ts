import { redis } from './redis.js'

export async function revokeToken(jti: string, ttlSeconds: number): Promise<void> {
  await redis.set(`jwt:revoked:${jti}`, '1', 'EX', ttlSeconds)
}

export async function isTokenRevoked(jti: string): Promise<boolean> {
  return (await redis.get(`jwt:revoked:${jti}`)) !== null
}

export async function revokeOrgTokens(orgId: number): Promise<void> {
  await redis.set(`jwt:org:${orgId}:revokedBefore`, String(Date.now()), 'EX', 7 * 86400)
}

export async function isOrgRevoked(orgId: number, iat: number): Promise<boolean> {
  const revokedBefore = await redis.get(`jwt:org:${orgId}:revokedBefore`)
  if (!revokedBefore) return false
  return iat * 1000 < Number(revokedBefore)
}
