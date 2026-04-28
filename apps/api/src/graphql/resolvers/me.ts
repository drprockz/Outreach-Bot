import { prisma } from 'shared'
import { builder } from '../builder.js'

type MeOrgShape = { id: number; name: string; slug: string; status: string }
type MePlanShape = {
  name: string
  priceInr: number
  limitsJson: unknown
  status: string
  trialEndsAt: string | null
  currentPeriodEnd: string | null
}
type MeShape = {
  id: number
  email: string
  isSuperadmin: boolean
  lastLoginAt: string | null
  org: MeOrgShape | null
  role: string | null
  plan: MePlanShape | null
}

const MeOrgInfo = builder.objectRef<MeOrgShape>('MeOrgInfo')
builder.objectType(MeOrgInfo, {
  fields: (t) => ({
    id: t.exposeInt('id'),
    name: t.exposeString('name'),
    slug: t.exposeString('slug'),
    status: t.exposeString('status'),
  }),
})

const MePlanInfo = builder.objectRef<MePlanShape>('MePlanInfo')
builder.objectType(MePlanInfo, {
  fields: (t) => ({
    name: t.exposeString('name'),
    priceInr: t.exposeInt('priceInr'),
    limitsJson: t.field({ type: 'String', resolve: (p) => JSON.stringify(p.limitsJson) }),
    status: t.exposeString('status'),
    trialEndsAt: t.string({ nullable: true, resolve: (p) => p.trialEndsAt }),
    currentPeriodEnd: t.string({ nullable: true, resolve: (p) => p.currentPeriodEnd }),
  }),
})

const MePayload = builder.objectRef<MeShape>('MePayload')
builder.objectType(MePayload, {
  fields: (t) => ({
    id: t.exposeInt('id'),
    email: t.exposeString('email'),
    isSuperadmin: t.exposeBoolean('isSuperadmin'),
    lastLoginAt: t.string({ nullable: true, resolve: (m) => m.lastLoginAt }),
    org: t.field({ type: MeOrgInfo, nullable: true, resolve: (m) => m.org }),
    role: t.string({ nullable: true, resolve: (m) => m.role }),
    plan: t.field({ type: MePlanInfo, nullable: true, resolve: (m) => m.plan }),
  }),
})

builder.queryField('me', (t) =>
  t.field({
    type: MePayload,
    nullable: true,
    resolve: async (_root, _args, ctx) => {
      if (!ctx.user) return null
      const { userId, orgId } = ctx.user
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          memberships: {
            where: { orgId },
            include: {
              org: { include: { subscription: { include: { plan: true } } } },
            },
          },
        },
      })
      if (!user) return null
      const membership = user.memberships[0] ?? null
      const sub = membership?.org.subscription ?? null
      return {
        id: user.id,
        email: user.email,
        isSuperadmin: user.isSuperadmin,
        lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
        org: membership
          ? { id: membership.org.id, name: membership.org.name, slug: membership.org.slug, status: membership.org.status }
          : null,
        role: membership?.role ?? null,
        plan: sub
          ? {
              name: sub.plan.name,
              priceInr: sub.plan.priceInr,
              limitsJson: sub.plan.limitsJson,
              status: sub.status,
              trialEndsAt: sub.trialEndsAt?.toISOString() ?? null,
              currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
            }
          : null,
      }
    },
  }),
)
