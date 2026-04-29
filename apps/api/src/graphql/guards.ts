import type { JwtPayload } from '../lib/jwt.js'
import type { Context } from './builder.js'

type AuthedContext = Context & { user: JwtPayload }

export function requireAuth(ctx: Context): asserts ctx is AuthedContext {
  if (!ctx.user) throw new Error('Unauthenticated')
}

export function requireOwner(ctx: Context): asserts ctx is AuthedContext {
  if (!ctx.user) throw new Error('Unauthenticated')
  if (ctx.user.role !== 'owner') throw new Error('Owner only')
}

export function requireSuperadmin(ctx: Context): asserts ctx is AuthedContext {
  if (!ctx.user?.isSuperadmin) throw new Error('Superadmin required')
}
