import { prisma } from 'shared'
import { builder } from '../builder.js'
import { requireAuth, requireOwner } from '../guards.js'
import { sendInviteEmail } from '../../lib/mailer.js'

type OrgMemberShape = { userId: number; email: string; role: string }

builder.prismaObject('Org', {
  fields: (t) => ({
    id: t.exposeInt('id'),
    name: t.exposeString('name'),
    slug: t.exposeString('slug'),
    status: t.exposeString('status'),
    createdAt: t.string({ resolve: (o) => o.createdAt.toISOString() }),
  }),
})

const OrgMember = builder.objectRef<OrgMemberShape>('OrgMember')
builder.objectType(OrgMember, {
  fields: (t) => ({
    userId: t.exposeInt('userId'),
    email: t.exposeString('email'),
    role: t.exposeString('role'),
  }),
})

builder.queryField('org', (t) =>
  t.prismaField({
    type: 'Org',
    nullable: true,
    resolve: async (query, _root, _args, ctx) => {
      requireAuth(ctx)
      return prisma.org.findUnique({ ...query, where: { id: ctx.user.orgId } })
    },
  }),
)

builder.queryField('members', (t) =>
  t.field({
    type: [OrgMember],
    resolve: async (_root, _args, ctx) => {
      requireAuth(ctx)
      const memberships = await prisma.orgMembership.findMany({
        where: { orgId: ctx.user.orgId },
        include: { user: true },
      })
      return memberships.map((m) => ({ userId: m.userId, email: m.user.email, role: m.role }))
    },
  }),
)

builder.mutationField('inviteMember', (t) =>
  t.field({
    type: OrgMember,
    args: { email: t.arg.string({ required: true }) },
    resolve: async (_root, { email }, ctx) => {
      requireOwner(ctx)
      const invitee = await prisma.user.upsert({
        where: { email },
        update: {},
        create: { email },
      })
      const existing = await prisma.orgMembership.findUnique({
        where: { orgId_userId: { orgId: ctx.user.orgId, userId: invitee.id } },
      })
      if (existing) throw new Error('User is already a member')
      const org = await prisma.org.findUnique({
        where: { id: ctx.user.orgId },
        include: { subscription: { include: { plan: true } } },
      })
      const limits = org?.subscription?.plan.limitsJson as Record<string, number> | null
      if (limits && limits.seats !== -1) {
        const count = await prisma.orgMembership.count({ where: { orgId: ctx.user.orgId } })
        if (count >= limits.seats) throw new Error('Seat limit reached')
      }
      const membership = await prisma.orgMembership.create({
        data: { orgId: ctx.user.orgId, userId: invitee.id, role: 'admin' },
      })
      const inviter = await prisma.user.findUnique({ where: { id: ctx.user.userId } })
      await sendInviteEmail(email, org!.name, inviter!.email).catch(() => {})
      return { userId: invitee.id, email: invitee.email, role: membership.role }
    },
  }),
)

builder.mutationField('removeMember', (t) =>
  t.field({
    type: 'Boolean',
    args: { userId: t.arg.int({ required: true }) },
    resolve: async (_root, { userId }, ctx) => {
      requireOwner(ctx)
      if (userId === ctx.user.userId) throw new Error('Cannot remove yourself')
      const membership = await prisma.orgMembership.findUnique({
        where: { orgId_userId: { orgId: ctx.user.orgId, userId } },
      })
      if (!membership) throw new Error('Member not found')
      if (membership.role === 'owner') throw new Error('Cannot remove the owner')
      await prisma.orgMembership.delete({ where: { id: membership.id } })
      return true
    },
  }),
)

builder.mutationField('changeRole', (t) =>
  t.field({
    type: OrgMember,
    args: {
      userId: t.arg.int({ required: true }),
      role: t.arg.string({ required: true }),
    },
    resolve: async (_root, { userId, role }, ctx) => {
      requireOwner(ctx)
      if (!['owner', 'admin'].includes(role)) throw new Error('Invalid role: must be owner or admin')
      const membership = await prisma.orgMembership.update({
        where: { orgId_userId: { orgId: ctx.user.orgId, userId } },
        data: { role: role as 'owner' | 'admin' },
        include: { user: true },
      })
      return { userId: membership.userId, email: membership.user.email, role: membership.role }
    },
  }),
)

builder.mutationField('updateOrg', (t) =>
  t.prismaField({
    type: 'Org',
    args: {
      name: t.arg.string({ required: false }),
      slug: t.arg.string({ required: false }),
    },
    resolve: async (query, _root, { name, slug }, ctx) => {
      requireOwner(ctx)
      const data: { name?: string; slug?: string } = {}
      if (name !== null && name !== undefined) {
        const trimmed = name.trim()
        if (trimmed.length < 2) throw new Error('Name must be at least 2 characters')
        if (trimmed.length > 80) throw new Error('Name must be at most 80 characters')
        data.name = trimmed
      }
      if (slug !== null && slug !== undefined) {
        const trimmed = slug.trim().toLowerCase()
        if (!/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(trimmed)) {
          throw new Error('Slug must be 1–40 chars, lowercase a–z, 0–9, or "-" (no leading/trailing dash)')
        }
        const taken = await prisma.org.findFirst({
          where: { slug: trimmed, NOT: { id: ctx.user.orgId } },
          select: { id: true },
        })
        if (taken) throw new Error('Slug is already in use')
        data.slug = trimmed
      }
      if (Object.keys(data).length === 0) throw new Error('Nothing to update')
      return prisma.org.update({ ...query, where: { id: ctx.user.orgId }, data })
    },
  }),
)
