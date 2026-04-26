import SchemaBuilder from '@pothos/core'
import PrismaPlugin from '@pothos/plugin-prisma'
import ErrorsPlugin from '@pothos/plugin-errors'
import { EventEmitter } from 'eventemitter3'
import { Prisma } from '@prisma/client'
import { prisma, type ScopedPrisma } from 'shared'
import type { JwtPayload } from '../lib/jwt.js'
import type PrismaTypes from '@pothos/plugin-prisma/generated'

export interface Context {
  user: JwtPayload | null
  // Scoped client for tenant-bound resolvers; raw `prisma` for superadmin / unauthenticated
  db: ScopedPrisma | typeof prisma
  pubsub: EventEmitter
}

export const pubsub = new EventEmitter()

export const builder = new SchemaBuilder<{
  Context: Context
  PrismaTypes: PrismaTypes
}>({
  plugins: [PrismaPlugin, ErrorsPlugin],
  prisma: {
    client: prisma,
    dmmf: Prisma.dmmf,
  },
})

builder.queryType({})
builder.mutationType({})
builder.subscriptionType({})
