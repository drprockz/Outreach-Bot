import { prisma } from 'shared'
import { builder } from '../builder.js'
import { requireSuperadmin } from '../guards.js'
import { signToken } from '../../lib/jwt.js'
import { redis } from '../../lib/redis.js'
import { revokeOrgTokens } from '../../lib/tokenRevocation.js'

async function writeAuditLog(
  actorId: number,
  action: string,
  targetOrgId?: number,
  meta?: Record<string, unknown>,
): Promise<void> {
  await prisma.auditLog.create({
    data: { action, actorId, targetOrgId, meta: meta as Parameters<typeof prisma.auditLog.create>[0]['data']['meta'] },
  })
}

// ─── Return Types ───────────────────────────────────────────────────────────

type AdminOrgShape = {
  id: number; name: string; slug: string; status: string; createdAt: string
  planName: string | null; planPriceInr: number | null; subscriptionStatus: string | null
}

type AdminUserShape = {
  id: number; email: string; isSuperadmin: boolean; lastLoginAt: string | null
  orgId: number | null; role: string | null
}

type AdminMetricsShape = {
  activeOrgs: number; trialOrgs: number; totalMrr: number; totalApiCostUsd: number
}

type ImpersonatePayload = { token: string }

const AdminOrg = builder.objectRef<AdminOrgShape>('AdminOrg')
builder.objectType(AdminOrg, {
  fields: (t) => ({
    id: t.exposeInt('id'),
    name: t.exposeString('name'),
    slug: t.exposeString('slug'),
    status: t.exposeString('status'),
    createdAt: t.exposeString('createdAt'),
    planName: t.string({ nullable: true, resolve: (o) => o.planName }),
    planPriceInr: t.int({ nullable: true, resolve: (o) => o.planPriceInr }),
    subscriptionStatus: t.string({ nullable: true, resolve: (o) => o.subscriptionStatus }),
  }),
})

const AdminUser = builder.objectRef<AdminUserShape>('AdminUser')
builder.objectType(AdminUser, {
  fields: (t) => ({
    id: t.exposeInt('id'),
    email: t.exposeString('email'),
    isSuperadmin: t.exposeBoolean('isSuperadmin'),
    lastLoginAt: t.string({ nullable: true, resolve: (u) => u.lastLoginAt }),
    orgId: t.int({ nullable: true, resolve: (u) => u.orgId }),
    role: t.string({ nullable: true, resolve: (u) => u.role }),
  }),
})

const AdminMetrics = builder.objectRef<AdminMetricsShape>('AdminMetrics')
builder.objectType(AdminMetrics, {
  fields: (t) => ({
    activeOrgs: t.exposeInt('activeOrgs'),
    trialOrgs: t.exposeInt('trialOrgs'),
    totalMrr: t.exposeInt('totalMrr'),
    totalApiCostUsd: t.field({ type: 'String', resolve: (m) => String(m.totalApiCostUsd) }),
  }),
})

const ImpersonateResult = builder.objectRef<ImpersonatePayload>('ImpersonateResult')
builder.objectType(ImpersonateResult, {
  fields: (t) => ({
    token: t.exposeString('token'),
  }),
})

// ─── Helpers ────────────────────────────────────────────────────────────────

function orgToAdminShape(org: {
  id: number; name: string; slug: string; status: string; createdAt: Date
  subscription?: { status: string; plan: { name: string; priceInr: number } } | null
}): AdminOrgShape {
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    status: org.status,
    createdAt: org.createdAt.toISOString(),
    planName: org.subscription?.plan.name ?? null,
    planPriceInr: org.subscription?.plan.priceInr ?? null,
    subscriptionStatus: org.subscription?.status ?? null,
  }
}

// ─── Queries ─────────────────────────────────────────────────────────────────

builder.queryField('adminOrgs', (t) =>
  t.field({
    type: [AdminOrg],
    args: {
      page: t.arg.int({ defaultValue: 1 }),
      filter: t.arg.string({ required: false }),
    },
    resolve: async (_root, { page, filter }, ctx) => {
      requireSuperadmin(ctx)
      const take = 50
      const skip = ((page ?? 1) - 1) * take
      const where = filter ? { OR: [{ name: { contains: filter } }, { slug: { contains: filter } }] } : {}
      const orgs = await prisma.org.findMany({
        where,
        include: { subscription: { include: { plan: true } } },
        take,
        skip,
        orderBy: { createdAt: 'desc' },
      })
      return orgs.map(orgToAdminShape)
    },
  }),
)

builder.queryField('adminOrg', (t) =>
  t.field({
    type: AdminOrg,
    nullable: true,
    args: { id: t.arg.int({ required: true }) },
    resolve: async (_root, { id }, ctx) => {
      requireSuperadmin(ctx)
      const org = await prisma.org.findUnique({
        where: { id },
        include: { subscription: { include: { plan: true } } },
      })
      return org ? orgToAdminShape(org) : null
    },
  }),
)

builder.queryField('adminUsers', (t) =>
  t.field({
    type: [AdminUser],
    args: { filter: t.arg.string({ required: false }) },
    resolve: async (_root, { filter }, ctx) => {
      requireSuperadmin(ctx)
      const where = filter ? { email: { contains: filter } } : {}
      const users = await prisma.user.findMany({
        where,
        include: { memberships: true },
        orderBy: { createdAt: 'desc' },
        take: 200,
      })
      return users.map((u) => ({
        id: u.id,
        email: u.email,
        isSuperadmin: u.isSuperadmin,
        lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
        orgId: u.memberships[0]?.orgId ?? null,
        role: u.memberships[0]?.role ?? null,
      }))
    },
  }),
)

builder.queryField('adminMetrics', (t) =>
  t.field({
    type: AdminMetrics,
    resolve: async (_root, _args, ctx) => {
      requireSuperadmin(ctx)
      const [activeOrgs, trialOrgs, subs] = await Promise.all([
        prisma.org.count({ where: { status: 'active' } }),
        prisma.org.count({ where: { status: 'trial' } }),
        prisma.orgSubscription.findMany({
          where: { status: 'active' },
          include: { plan: true },
        }),
      ])
      const totalMrr = subs.reduce((sum, s) => sum + s.plan.priceInr, 0)
      return { activeOrgs, trialOrgs, totalMrr, totalApiCostUsd: 0 }
    },
  }),
)

// ─── Mutations ───────────────────────────────────────────────────────────────

builder.mutationField('adminCreateOrg', (t) =>
  t.field({
    type: AdminOrg,
    args: {
      name: t.arg.string({ required: true }),
      slug: t.arg.string({ required: true }),
      ownerEmail: t.arg.string({ required: true }),
      planId: t.arg.int({ required: true }),
    },
    resolve: async (_root, { name, slug, ownerEmail, planId }, ctx) => {
      requireSuperadmin(ctx)
      const org = await prisma.$transaction(async (tx) => {
        const newOrg = await tx.org.create({ data: { name, slug, status: 'active' } })
        const owner = await tx.user.upsert({
          where: { email: ownerEmail },
          update: {},
          create: { email: ownerEmail },
        })
        await tx.orgMembership.create({
          data: { orgId: newOrg.id, userId: owner.id, role: 'owner' },
        })
        const trialEndsAt = new Date(Date.now() + 14 * 86400_000)
        await tx.orgSubscription.create({
          data: { orgId: newOrg.id, planId, status: 'trial', trialEndsAt },
        })
        return newOrg
      })
      await writeAuditLog(ctx.user!.userId, 'create_org', org.id, { name, slug, ownerEmail, planId })
      const full = await prisma.org.findUnique({
        where: { id: org.id },
        include: { subscription: { include: { plan: true } } },
      })
      return orgToAdminShape(full!)
    },
  }),
)

builder.mutationField('adminSuspendOrg', (t) =>
  t.field({
    type: 'Boolean',
    args: { orgId: t.arg.int({ required: true }) },
    resolve: async (_root, { orgId }, ctx) => {
      requireSuperadmin(ctx)
      await prisma.org.update({ where: { id: orgId }, data: { status: 'suspended' } })
      await prisma.orgSubscription.updateMany({ where: { orgId }, data: { status: 'locked' } })
      await revokeOrgTokens(orgId)
      await writeAuditLog(ctx.user!.userId, 'suspend_org', orgId)
      return true
    },
  }),
)

builder.mutationField('adminOverridePlan', (t) =>
  t.field({
    type: AdminOrg,
    args: {
      orgId: t.arg.int({ required: true }),
      planId: t.arg.int({ required: true }),
    },
    resolve: async (_root, { orgId, planId }, ctx) => {
      requireSuperadmin(ctx)
      await prisma.orgSubscription.upsert({
        where: { orgId },
        update: { planId, status: 'active' },
        create: { orgId, planId, status: 'active' },
      })
      await writeAuditLog(ctx.user!.userId, 'override_plan', orgId, { planId })
      const org = await prisma.org.findUnique({
        where: { id: orgId },
        include: { subscription: { include: { plan: true } } },
      })
      return orgToAdminShape(org!)
    },
  }),
)

builder.mutationField('adminResetTrial', (t) =>
  t.field({
    type: AdminOrg,
    args: {
      orgId: t.arg.int({ required: true }),
      days: t.arg.int({ defaultValue: 14 }),
    },
    resolve: async (_root, { orgId, days }, ctx) => {
      requireSuperadmin(ctx)
      const trialEndsAt = new Date(Date.now() + (days ?? 14) * 86400_000)
      await prisma.orgSubscription.update({
        where: { orgId },
        data: { status: 'trial', trialEndsAt },
      })
      await prisma.org.update({ where: { id: orgId }, data: { status: 'trial' } })
      await writeAuditLog(ctx.user!.userId, 'reset_trial', orgId, { days, trialEndsAt })
      const org = await prisma.org.findUnique({
        where: { id: orgId },
        include: { subscription: { include: { plan: true } } },
      })
      return orgToAdminShape(org!)
    },
  }),
)

builder.mutationField('adminDeleteOrg', (t) =>
  t.field({
    type: 'Boolean',
    args: {
      orgId: t.arg.int({ required: true }),
      confirmationToken: t.arg.string({ required: true }),
    },
    resolve: async (_root, { orgId, confirmationToken }, ctx) => {
      requireSuperadmin(ctx)
      // Confirmation token must be the string "DELETE-{orgId}"
      if (confirmationToken !== `DELETE-${orgId}`) throw new Error('Invalid confirmation token')
      await revokeOrgTokens(orgId)
      await writeAuditLog(ctx.user!.userId, 'delete_org', orgId)
      // Cascade delete is handled by Prisma relations — delete org last
      await prisma.orgSubscription.deleteMany({ where: { orgId } })
      await prisma.orgMembership.deleteMany({ where: { orgId } })
      await prisma.org.delete({ where: { id: orgId } })
      return true
    },
  }),
)

builder.mutationField('adminImpersonate', (t) =>
  t.field({
    type: ImpersonateResult,
    args: { orgId: t.arg.int({ required: true }) },
    resolve: async (_root, { orgId }, ctx) => {
      requireSuperadmin(ctx)
      const membership = await prisma.orgMembership.findFirst({
        where: { orgId },
        include: { user: true },
      })
      if (!membership) throw new Error('Org has no members')
      if (membership.user.isSuperadmin) throw new Error('Cannot impersonate a superadmin')
      const token = signToken(
        {
          userId: membership.userId,
          orgId,
          role: membership.role,
          isSuperadmin: false,
          impersonating: true,
          originalAdminId: ctx.user!.userId,
        },
        '1h',
      )
      // Decode to get jti for Redis storage
      const { jti } = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
      await redis.set(`jwt:impersonation:${jti}`, '1', 'EX', 3600)
      await writeAuditLog(ctx.user!.userId, 'impersonate', orgId, {
        targetUserId: membership.userId,
        jti,
      })
      return { token }
    },
  }),
)
