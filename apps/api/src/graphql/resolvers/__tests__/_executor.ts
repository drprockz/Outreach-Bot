// Test executor for GraphQL resolvers. Runs operations against the real
// schema with a fake context — same path the dashboard takes, minus auth
// and the scoped Prisma wrapper.
//
// Mirrors the trialExpiry.worker.test.ts style: hoist mocks for every
// module the schema's transitive imports touch, then call the resolvers.

import { vi, expect } from 'vitest'

// All the mocks must be defined inside vi.hoisted() so they exist before
// the schema's resolvers (`import './resolvers/...'`) are evaluated.
const sharedMocks = vi.hoisted(() => {
  const fakePrisma = new Proxy(
    {},
    {
      get() {
        // The resolvers all read `ctx.db.<model>.<op>(...)` — they never use
        // the imported `prisma` at runtime (only `typeof prisma` for typing).
        // If anything does reach for it we want the test to fail loudly.
        throw new Error('Resolver reached for top-level prisma instead of ctx.db')
      },
    },
  )
  return { fakePrisma }
})

vi.mock('shared', () => ({
  prisma: sharedMocks.fakePrisma,
  createScopedPrisma: vi.fn(() => sharedMocks.fakePrisma),
}))

// scheduler.ts (imported by runEngine.ts) instantiates BullMQ Queues at module
// load. Stub them so importing the schema doesn't try to dial Redis.
vi.mock('bullmq', () => {
  class FakeQueue {
    add = vi.fn(async () => ({ id: 'fake-job-id' }))
  }
  class FakeWorker {
    on = vi.fn()
    close = vi.fn()
  }
  class FakeQueueEvents {
    on = vi.fn()
    close = vi.fn()
  }
  return { Queue: FakeQueue, Worker: FakeWorker, QueueEvents: FakeQueueEvents }
})

vi.mock('../../../lib/redis.js', () => ({
  redis: { disconnect: vi.fn(), publish: vi.fn(), subscribe: vi.fn() },
}))

// Now safe to import the schema — all transitive deps are mocked.
//
// We drive the schema via graphql-yoga (a single fetch-shaped server) rather
// than the standalone `graphql()` executor from the `graphql` package. Yoga
// links to its own bundled `graphql` instance which is the same one pothos
// uses internally — going through the standalone import path triggers
// "Cannot use GraphQLSchema from another realm" because vitest can resolve
// two distinct module copies through different dependency chains.
import { createYoga, createPubSub } from 'graphql-yoga'
import { schema } from '../../schema.js'
import type { Context } from '../../builder.js'
import type { JwtPayload } from '../../../lib/jwt.js'
import { EventEmitter } from 'eventemitter3'

type ExecutionResult = {
  data?: unknown
  errors?: { message: string }[]
}

export function fakeUser(overrides: Partial<JwtPayload> = {}): JwtPayload {
  return {
    jti: overrides.jti ?? 'jti-1',
    userId: overrides.userId ?? 1,
    orgId: overrides.orgId ?? 1,
    role: overrides.role ?? 'owner',
    isSuperadmin: overrides.isSuperadmin ?? false,
    iat: overrides.iat ?? Math.floor(Date.now() / 1000),
    exp: overrides.exp ?? Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  }
}

export function fakeContext(opts: {
  user?: JwtPayload | null
  db: unknown
  pubsub?: EventEmitter
}): Context {
  return {
    user: opts.user === undefined ? fakeUser() : opts.user,
    db: opts.db as Context['db'],
    pubsub: opts.pubsub ?? new EventEmitter(),
  }
}

// One yoga server per test process — schema is built once at module load
// and reused. Context is injected per-request via the per-call options object.
let _yoga: ReturnType<typeof createYoga<Record<string, unknown>, Context>> | null = null
let _ctxForNextRequest: Context | null = null

function yoga() {
  if (_yoga) return _yoga
  _yoga = createYoga<Record<string, unknown>, Context>({
    schema,
    context: (): Context => {
      if (!_ctxForNextRequest) throw new Error('exec/execSubscription: context not set')
      const ctx = _ctxForNextRequest
      _ctxForNextRequest = null
      return ctx
    },
    // Disable yoga's built-in landing/graphiql etc. We just want the executor.
    landingPage: false,
    graphiql: false,
    maskedErrors: false,
    plugins: [],
  })
  return _yoga
}

// Run a query/mutation. Returns the raw ExecutionResult so callers can assert
// on either `data` or `errors`.
export async function exec(opts: {
  query: string
  variables?: Record<string, unknown>
  user?: JwtPayload | null
  db: unknown
  pubsub?: EventEmitter
}): Promise<ExecutionResult> {
  _ctxForNextRequest = fakeContext({ user: opts.user, db: opts.db, pubsub: opts.pubsub })
  const res = await yoga().fetch('http://test/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ query: opts.query, variables: opts.variables }),
  })
  return (await res.json()) as ExecutionResult
}

// Drain a subscription into an array of events. Yoga handles SSE via accept
// negotiation — we read the SSE stream and parse each `data:` line as JSON.
export async function execSubscription(opts: {
  query: string
  variables?: Record<string, unknown>
  user?: JwtPayload | null
  db: unknown
  pubsub?: EventEmitter
}): Promise<ExecutionResult[]> {
  _ctxForNextRequest = fakeContext({ user: opts.user, db: opts.db, pubsub: opts.pubsub })
  const res = await yoga().fetch('http://test/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify({ query: opts.query, variables: opts.variables }),
  })
  const text = await res.text()
  const events: ExecutionResult[] = []
  for (const block of text.split('\n\n')) {
    const dataLine = block.split('\n').find((l) => l.startsWith('data: '))
    if (!dataLine) continue
    try {
      events.push(JSON.parse(dataLine.slice(6)) as ExecutionResult)
    } catch {
      /* ignore malformed lines */
    }
  }
  return events
}

// Convenience matcher: assert there's no `errors` field and return `data`.
export function ok<T>(result: ExecutionResult): T {
  if (result.errors?.length) {
    throw new Error(`GraphQL errors: ${result.errors.map((e) => e.message).join('; ')}`)
  }
  return result.data as T
}

// Convenience matcher: assert there IS an error and return its message.
export function err(result: ExecutionResult): string {
  expect(result.errors?.length, 'expected GraphQL errors').toBeGreaterThan(0)
  return result.errors![0].message
}

// Build a partial mock of a Prisma model — every accessed method returns
// the per-method override, falling back to a vi.fn that throws.
type MockFn = ReturnType<typeof vi.fn>
type MockModel = Record<string, MockFn>
export function mockModel(overrides: Record<string, unknown> = {}): MockModel {
  return new Proxy(overrides as MockModel, {
    get(target, prop) {
      if (typeof prop === 'symbol') return (target as unknown as Record<symbol, unknown>)[prop]
      const key = prop as string
      if (!(key in target)) {
        const fn: MockFn = vi.fn().mockImplementation(async () => {
          throw new Error(`mockModel: unhandled call to ${key}`)
        })
        target[key] = fn
      }
      return target[key]
    },
  })
}

// Build a partial mock of the entire Prisma client — { config: mockModel(), lead: mockModel(), ... }.
export function mockDb(models: Record<string, Record<string, unknown>> = {}): unknown {
  const out: Record<string, unknown> = {}
  for (const [name, methods] of Object.entries(models)) {
    out[name] = mockModel(methods)
  }
  // $transaction: run the callback with the same db as `tx`.
  out.$transaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(out))
  return out
}
