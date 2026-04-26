# Radar SaaS Productization — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform Radar from a single-tenant personal tool into a production-grade multi-tenant SaaS with organizations, RBAC, Google OAuth + OTP auth, Razorpay billing, GraphQL API with real-time subscriptions, and a BullMQ job queue.

**Architecture:** Row-level multi-tenancy via Prisma `$extends` scoped client; GraphQL (Pothos + graphql-yoga) for the API with `graphql-ws` subscriptions; BullMQ + Redis for durable job queuing replacing node-cron direct invocation. pnpm monorepo with `apps/api`, `apps/web`, and `packages/shared`.

**Tech Stack:** TypeScript (strict), Prisma + PostgreSQL, GraphQL (Pothos + graphql-yoga + graphql-ws), BullMQ + ioredis, passport + passport-google-oauth20, Razorpay SDK, React 18 + Vite + shadcn/ui + Tailwind, urql, TanStack Query, pnpm workspaces, Docker Compose (local dev), Vitest.

**Spec:** `docs/superpowers/specs/2026-04-26-productization-design.md`

---

## File Map

### New files created
```
pnpm-workspace.yaml
apps/api/package.json
apps/api/tsconfig.json
apps/api/src/server.ts
apps/api/src/graphql/schema.ts
apps/api/src/graphql/context.ts
apps/api/src/graphql/builder.ts
apps/api/src/graphql/resolvers/leads.ts
apps/api/src/graphql/resolvers/emails.ts
apps/api/src/graphql/resolvers/replies.ts
apps/api/src/graphql/resolvers/billing.ts
apps/api/src/graphql/resolvers/orgs.ts
apps/api/src/graphql/resolvers/admin.ts
apps/api/src/graphql/subscriptions/engine.ts
apps/api/src/graphql/subscriptions/leads.ts
apps/api/src/graphql/subscriptions/replies.ts
apps/api/src/graphql/subscriptions/billing.ts
apps/api/src/middleware/requireAuth.ts
apps/api/src/middleware/requireRole.ts
apps/api/src/middleware/requireSuperadmin.ts
apps/api/src/middleware/enforcePlan.ts
apps/api/src/middleware/rateLimits.ts
apps/api/src/webhooks/razorpay.ts
apps/api/src/webhooks/google.ts
apps/api/src/workers/findLeads.worker.ts
apps/api/src/workers/sendEmails.worker.ts
apps/api/src/workers/sendFollowups.worker.ts
apps/api/src/workers/checkReplies.worker.ts
apps/api/src/workers/dailyReport.worker.ts
apps/api/src/workers/healthCheck.worker.ts
apps/api/src/workers/scheduler.ts
packages/shared/package.json
packages/shared/tsconfig.json
packages/shared/src/prismaClient.ts
packages/shared/src/scopedPrisma.ts
apps/web/src/lib/urqlClient.ts
apps/web/src/lib/wsClient.ts
apps/web/src/lib/auth.ts
apps/web/src/pages/Login.tsx
apps/web/src/pages/Otp.tsx
apps/web/src/pages/Onboarding.tsx
apps/web/src/pages/settings/Profile.tsx
apps/web/src/pages/settings/Team.tsx
apps/web/src/pages/settings/Billing.tsx
apps/web/src/pages/settings/Org.tsx
apps/web/src/pages/superadmin/Orgs.tsx
apps/web/src/pages/superadmin/OrgDetail.tsx
apps/web/src/pages/superadmin/Users.tsx
apps/web/src/pages/superadmin/Metrics.tsx
apps/web/src/components/TrialBanner.tsx
apps/web/src/components/GraceBanner.tsx
apps/web/src/components/PaywallPage.tsx
infra/docker-compose.yml
prisma/migrations/YYYYMMDD_add_org_id_nullable/migration.sql
prisma/migrations/YYYYMMDD_seed_org1_and_enforce_not_null/migration.sql
scripts/seed-org1.ts
```

### Modified files
```
prisma/schema.prisma          — add 6 new models + enums + orgId on 14 existing models
package.json                  — root workspace config
apps/web/package.json         — add TypeScript, shadcn/ui, Tailwind, urql, TanStack Query
apps/web/vite.config.ts       — TypeScript, path aliases
apps/web/src/App.tsx          — add new routes, auth guard, TrialBanner
.env.example                  — add REDIS_URL, GOOGLE_*, RAZORPAY_*
infra/ecosystem.config.js     — add Redis worker process
```

---

## Chunk 1: Monorepo + TypeScript + Docker

### Task 1: pnpm monorepo setup

**Files:**
- Create: `pnpm-workspace.yaml`
- Modify: `package.json` (root)
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`

- [ ] **Step 1: Install pnpm globally if not present**
```bash
npm install -g pnpm
pnpm --version  # should be 8+
```

- [ ] **Step 2: Create workspace config**
```yaml
# pnpm-workspace.yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

- [ ] **Step 3: Update root package.json**
```json
{
  "name": "radar",
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev:api": "pnpm --filter api dev",
    "dev:web": "pnpm --filter web dev",
    "test": "pnpm --filter api test",
    "build": "pnpm --filter api build && pnpm --filter web build"
  }
}
```

- [ ] **Step 4: Create apps/api/package.json**
```json
{
  "name": "api",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js",
    "test": "vitest run"
  },
  "dependencies": {
    "@pothos/core": "^4.0.0",
    "@pothos/plugin-prisma": "^4.0.0",
    "@pothos/plugin-errors": "^4.0.0",
    "graphql-yoga": "^5.0.0",
    "graphql-ws": "^5.0.0",
    "ws": "^8.0.0",
    "bullmq": "^5.0.0",
    "ioredis": "^5.0.0",
    "passport": "^0.7.0",
    "passport-google-oauth20": "^2.0.0",
    "express": "^4.18.0",
    "express-rate-limit": "^7.0.0",
    "cookie-parser": "^1.4.0",
    "razorpay": "^2.9.0",
    "pino": "^9.0.0",
    "pino-pretty": "^11.0.0",
    "jsonwebtoken": "^9.0.0",
    "bcrypt": "^5.1.0",
    "uuid": "^10.0.0",
    "nodemailer": "^6.9.0",
    "zod": "^3.23.0",
    "shared": "workspace:*"
  },
  "devDependencies": {
    "@types/express": "^4.17.0",
    "@types/passport": "^1.0.0",
    "@types/passport-google-oauth20": "^2.0.0",
    "@types/jsonwebtoken": "^9.0.0",
    "@types/bcrypt": "^5.0.0",
    "@types/uuid": "^10.0.0",
    "@types/nodemailer": "^6.4.0",
    "@types/ws": "^8.5.0",
    "@types/node": "^20.0.0",
    "typescript": "^5.4.0",
    "tsx": "^4.0.0",
    "vitest": "^1.0.0"
  }
}
```

- [ ] **Step 5: Create apps/api/tsconfig.json**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "paths": { "shared": ["../../packages/shared/src/index.ts"] }
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 6: Create packages/shared/package.json**
```json
{
  "name": "shared",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./src/index.ts",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": { "build": "tsc" },
  "dependencies": {
    "@prisma/client": "^5.0.0"
  },
  "devDependencies": {
    "prisma": "^5.0.0",
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 7: Create packages/shared/tsconfig.json**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 8: Install all deps and build shared package**
```bash
pnpm install
pnpm --filter shared build
```
Expected: workspace installed, `packages/shared/dist/` created with compiled JS

- [ ] **Step 9: Commit**
```bash
git add pnpm-workspace.yaml package.json apps/api/package.json apps/api/tsconfig.json packages/shared/package.json packages/shared/tsconfig.json
git commit -m "chore: set up pnpm monorepo with apps/api and packages/shared"
```

---

### Task 2: Docker Compose for local dev

**Files:**
- Create: `infra/docker-compose.yml`
- Modify: `.env.example`

- [ ] **Step 1: Create docker-compose.yml**
```yaml
# infra/docker-compose.yml
version: '3.9'
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: radar
      POSTGRES_USER: radar
      POSTGRES_PASSWORD: radar
    ports:
      - '5432:5432'
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - '6379:6379'
    volumes:
      - redis_data:/data

volumes:
  postgres_data:
  redis_data:
```

- [ ] **Step 2: Add new env vars to .env.example**

Append to `.env.example`:
```env
# ── REDIS ──────────────────────────────────────────────────
REDIS_URL=redis://localhost:6379

# ── GOOGLE OAUTH ───────────────────────────────────────────
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=https://radar.simpleinc.cloud/auth/google/callback

# ── RAZORPAY ───────────────────────────────────────────────
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
```

- [ ] **Step 3: Start services**
```bash
docker compose -f infra/docker-compose.yml up -d
docker compose -f infra/docker-compose.yml ps
```
Expected: postgres and redis containers running

- [ ] **Step 4: Commit**
```bash
git add infra/docker-compose.yml .env.example
git commit -m "chore: add docker-compose for local postgres + redis"
```

---

## Chunk 2: Sub-project A — Prisma Schema + Multi-tenancy Migration

### Task 3: Update Prisma schema — new models + enums + orgId

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add enums at the top of schema.prisma (after datasource block)**
```prisma
enum Role {
  owner
  admin
}

enum OrgStatus {
  trial
  active
  locked
  suspended
}

enum SubscriptionStatus {
  trial
  active
  grace
  locked
  cancelled
}
```

- [ ] **Step 2: Add Org model**
```prisma
model Org {
  id          Int       @id @default(autoincrement())
  name        String
  slug        String    @unique
  status      OrgStatus @default(trial)
  createdAt   DateTime  @default(now()) @db.Timestamptz(6) @map("created_at")

  memberships  OrgMembership[]
  subscription OrgSubscription?

  @@map("orgs")
}
```

- [ ] **Step 3: Add User model**
```prisma
model User {
  id            Int       @id @default(autoincrement())
  email         String    @unique
  googleId      String?   @unique @map("google_id")
  isSuperadmin  Boolean   @default(false) @map("is_superadmin")
  lastLoginAt   DateTime? @db.Timestamptz(6) @map("last_login_at")
  createdAt     DateTime  @default(now()) @db.Timestamptz(6) @map("created_at")

  memberships OrgMembership[]
  otpTokens   OtpToken[]

  @@map("users")
}
```

- [ ] **Step 4: Add OrgMembership model**
```prisma
model OrgMembership {
  id     Int    @id @default(autoincrement())
  orgId  Int    @map("org_id")
  userId Int    @map("user_id")
  role   Role

  org  Org  @relation(fields: [orgId], references: [id])
  user User @relation(fields: [userId], references: [id])

  @@unique([orgId, userId])
  @@map("org_memberships")
}
```

- [ ] **Step 5: Add OtpToken model**
```prisma
model OtpToken {
  id        Int      @id @default(autoincrement())
  userId    Int      @map("user_id")
  codeHash  String   @map("code_hash")
  expiresAt DateTime @map("expires_at")
  used      Boolean  @default(false)
  attempts  Int      @default(0)

  user User @relation(fields: [userId], references: [id])

  @@index([userId, used, expiresAt])
  @@map("otp_tokens")
}
```

- [ ] **Step 6: Add Plan model**
```prisma
model Plan {
  id         Int    @id @default(autoincrement())
  name       String
  priceInr   Int    @map("price_inr")
  limitsJson Json   @map("limits_json")

  subscriptions OrgSubscription[]

  @@map("plans")
}
```

- [ ] **Step 7: Add OrgSubscription model**
```prisma
model OrgSubscription {
  id                 Int                @id @default(autoincrement())
  orgId              Int                @unique @map("org_id")
  planId             Int                @map("plan_id")
  status             SubscriptionStatus @default(trial)
  razorpaySubId      String?            @map("razorpay_sub_id")
  razorpayCustomerId String?            @map("razorpay_customer_id")
  trialEndsAt        DateTime?          @db.Timestamptz(6) @map("trial_ends_at")
  currentPeriodEnd   DateTime?          @db.Timestamptz(6) @map("current_period_end")
  graceEndsAt        DateTime?          @db.Timestamptz(6) @map("grace_ends_at")
  cancelAtPeriodEnd  Boolean            @default(false) @map("cancel_at_period_end")

  org           Org                    @relation(fields: [orgId], references: [id])
  plan          Plan                   @relation(fields: [planId], references: [id])
  webhookEvents RazorpayWebhookEvent[]

  @@map("org_subscriptions")
}
```

- [ ] **Step 8: Add RazorpayWebhookEvent model**
```prisma
model RazorpayWebhookEvent {
  id              Int      @id @default(autoincrement())
  razorpayEventId String   @unique @map("razorpay_event_id")
  eventType       String   @map("event_type")
  orgSubId        Int      @map("org_sub_id")
  processedAt     DateTime @default(now()) @db.Timestamptz(6) @map("processed_at")

  orgSub OrgSubscription @relation(fields: [orgSubId], references: [id])

  @@map("razorpay_webhook_events")
}
```

- [ ] **Step 9: Add AuditLog model**
```prisma
model AuditLog {
  id          Int      @id @default(autoincrement())
  action      String
  actorId     Int      @map("actor_id")
  targetOrgId Int?     @map("target_org_id")
  meta        Json?
  createdAt   DateTime @default(now()) @db.Timestamptz(6) @map("created_at")

  @@index([actorId])
  @@index([targetOrgId])
  @@map("audit_log")
}
```

- [ ] **Step 10: Add `orgId Int @map("org_id")` (nullable) to all 14 tenant models**

Add to each model in schema.prisma:
- `Lead` — add `orgId Int? @map("org_id")` + `org Org? @relation(...)` + `@@index([orgId])`
- `Email` — same pattern
- `Reply`, `Bounce`, `CronLog`, `DailyMetrics`, `ErrorLog`, `SequenceState`, `Config`, `Niche`, `Offer`, `IcpProfile`, `SavedView`, `LeadSignal`, `RejectList`

Note: Make `orgId` nullable (`Int?`) for this migration. It becomes NOT NULL in the next migration.

- [ ] **Step 11: Generate and apply migration (Step 1 of 2)**
```bash
cd /Users/drprockz/Projects/Outreach
npx prisma migrate dev --name add_org_id_nullable
```
Expected: migration file created + applied, no errors

- [ ] **Step 12: Verify migration**
```bash
npx prisma studio
# Check that orgs, users, org_memberships etc. tables exist
# Check that leads.org_id column exists (nullable)
```

- [ ] **Step 13: Commit**
```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(schema): add multi-tenancy models (Org, User, Plan, OrgSubscription) and nullable orgId"
```

---

### Task 4: Seed Org 1 + make orgId NOT NULL (atomic migration)

**Files:**
- Create: `prisma/migrations/YYYYMMDD_seed_org1_enforce_not_null/migration.sql` (via --create-only)

- [ ] **Step 1: Create migration skeleton**
```bash
npx prisma migrate dev --create-only --name seed_org1_enforce_not_null
```
This creates an empty migration file. Open it.

- [ ] **Step 2: Write the migration SQL**

Replace the generated migration content with:
```sql
-- WARNING: Pass OWNER_EMAIL via psql -v flag. Do NOT hardcode outreach address.
-- This migration seeds Org 1 and atomically backfills + enforces NOT NULL.

BEGIN;

-- Seed plans
INSERT INTO plans (id, name, price_inr, limits_json) VALUES
  (1, 'Trial',   0,     '{"leadsPerDay":34,"seats":1,"claudeDailySpendCapUsd":1,"geminiQueriesPerDay":150,"bulkRetryEnabled":false,"exportEnabled":false,"apiAccess":false}'),
  (2, 'Starter', 2999,  '{"leadsPerDay":34,"seats":2,"claudeDailySpendCapUsd":3,"geminiQueriesPerDay":150,"bulkRetryEnabled":true,"exportEnabled":true,"apiAccess":false}'),
  (3, 'Growth',  6999,  '{"leadsPerDay":68,"seats":5,"claudeDailySpendCapUsd":6,"geminiQueriesPerDay":300,"bulkRetryEnabled":true,"exportEnabled":true,"apiAccess":false}'),
  (4, 'Agency',  14999, '{"leadsPerDay":-1,"seats":10,"claudeDailySpendCapUsd":12,"geminiQueriesPerDay":600,"bulkRetryEnabled":true,"exportEnabled":true,"apiAccess":true}')
ON CONFLICT DO NOTHING;

-- Seed Org 1
INSERT INTO orgs (id, name, slug, status, created_at)
  VALUES (1, 'Simple Inc', 'simpleinc', 'active', NOW())
  ON CONFLICT DO NOTHING;

-- Seed owner user — set email to the Google/OTP login email, NOT the outreach inbox
-- Run: psql $DATABASE_URL -v OWNER_EMAIL="your@login.email" -f this_file.sql
INSERT INTO users (id, email, is_superadmin, created_at)
  VALUES (1, current_setting('app.owner_email', true), true, NOW())
  ON CONFLICT DO NOTHING;

INSERT INTO org_memberships (org_id, user_id, role)
  VALUES (1, 1, 'owner')
  ON CONFLICT DO NOTHING;

INSERT INTO org_subscriptions (org_id, plan_id, status)
  VALUES (1, 4, 'active')
  ON CONFLICT DO NOTHING;

-- Backfill all tenant tables
UPDATE leads          SET org_id = 1 WHERE org_id IS NULL;
UPDATE emails         SET org_id = 1 WHERE org_id IS NULL;
UPDATE replies        SET org_id = 1 WHERE org_id IS NULL;
UPDATE bounces        SET org_id = 1 WHERE org_id IS NULL;
UPDATE cron_log       SET org_id = 1 WHERE org_id IS NULL;
UPDATE daily_metrics  SET org_id = 1 WHERE org_id IS NULL;
UPDATE error_log      SET org_id = 1 WHERE org_id IS NULL;
UPDATE sequence_state SET org_id = 1 WHERE org_id IS NULL;
UPDATE config         SET org_id = 1 WHERE org_id IS NULL;
UPDATE niches         SET org_id = 1 WHERE org_id IS NULL;
UPDATE offer          SET org_id = 1 WHERE org_id IS NULL;
UPDATE icp_profile    SET org_id = 1 WHERE org_id IS NULL;
UPDATE saved_views    SET org_id = 1 WHERE org_id IS NULL;
UPDATE lead_signals   SET org_id = 1 WHERE org_id IS NULL;
UPDATE reject_list    SET org_id = 1 WHERE org_id IS NULL;

-- Enforce NOT NULL
ALTER TABLE leads          ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE emails         ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE replies        ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE bounces        ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE cron_log       ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE daily_metrics  ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE error_log      ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE sequence_state ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE config          ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE niches          ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE offer           ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE icp_profile     ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE saved_views     ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE lead_signals    ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE reject_list     ALTER COLUMN org_id SET NOT NULL;

COMMIT;
```

- [ ] **Step 3: Update Prisma schema to make orgId NOT NULL on all 14 models**

Change all `orgId Int?` to `orgId Int` in schema.prisma (remove the `?`)

- [ ] **Step 4: Set owner email as permanent DB config, then apply migration**
```bash
# Set as permanent DB-level config so it persists into the migration session
# Use YOUR Google/OTP login email — NOT the outreach inbox (darshan@trysimpleinc.com)
psql $DATABASE_URL -c "ALTER DATABASE radar SET app.owner_email = 'your@login.email'"
# In development, apply with migrate dev (keeps shadow DB in sync)
npx prisma migrate dev
# On production server only, use migrate deploy
```

- [ ] **Step 5: Verify**
```bash
npx prisma db execute --stdin <<< "SELECT count(*) FROM leads WHERE org_id IS NULL;"
# Expected: 0
npx prisma db execute --stdin <<< "SELECT * FROM orgs;"
# Expected: 1 row — Simple Inc
```

- [ ] **Step 6: Commit**
```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(schema): enforce orgId NOT NULL, seed Org 1 + plans in atomic transaction"
```

---

### Task 5: Prisma scoped client (packages/shared)

**Files:**
- Create: `packages/shared/src/prismaClient.ts`
- Create: `packages/shared/src/scopedPrisma.ts`
- Create: `packages/shared/src/index.ts`

- [ ] **Step 1: Write failing test for scopedPrisma**
```typescript
// packages/shared/src/scopedPrisma.test.ts
import { describe, it, expect, vi } from 'vitest'

// Mock the raw prisma client
const mockFindMany = vi.fn().mockResolvedValue([])
vi.mock('./prismaClient.js', () => ({
  prisma: {
    $extends: vi.fn().mockImplementation((ext) => ({
      lead: {
        findMany: async (args: Record<string, unknown>) => {
          // Simulate what the extension does — call the real query function
          const query = (a: unknown) => mockFindMany(a)
          return ext.query.lead.findMany({ args, query })
        },
      },
    })),
  },
}))

import { createScopedPrisma } from './scopedPrisma.js'

describe('createScopedPrisma', () => {
  it('injects orgId into findMany where clause', async () => {
    const scoped = createScopedPrisma(42)
    await scoped.lead.findMany({ where: { status: 'ready' } } as Parameters<typeof scoped.lead.findMany>[0])
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ orgId: 42, status: 'ready' }) })
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**
```bash
cd packages/shared && npx vitest run src/scopedPrisma.test.ts
```
Expected: FAIL — `createScopedPrisma` not found

- [ ] **Step 3: Create prismaClient.ts**
```typescript
// packages/shared/src/prismaClient.ts
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
```

- [ ] **Step 4: Create scopedPrisma.ts**
```typescript
// packages/shared/src/scopedPrisma.ts
import { prisma } from './prismaClient.js'

const TENANT_MODELS = [
  'lead', 'email', 'reply', 'bounce', 'cronLog', 'dailyMetrics',
  'errorLog', 'sequenceState', 'config', 'niche', 'offer',
  'icpProfile', 'savedView', 'leadSignal', 'rejectList',
] as const

function addOrgFilter(orgId: number) {
  return async ({ args, query }: { args: Record<string, unknown>; query: (args: unknown) => unknown }) => {
    args.where = { ...((args.where as Record<string, unknown>) ?? {}), orgId }
    return query(args)
  }
}

export function createScopedPrisma(orgId: number) {
  const queryExtensions = Object.fromEntries(
    TENANT_MODELS.map((model) => [
      model,
      {
        findMany:   addOrgFilter(orgId),
        findFirst:  addOrgFilter(orgId),
        findUnique: addOrgFilter(orgId),  // must be included — unique lookups can cross tenants
        update:     addOrgFilter(orgId),
        updateMany: addOrgFilter(orgId),
        delete:     addOrgFilter(orgId),
        deleteMany: addOrgFilter(orgId),
      },
    ])
  )
  return prisma.$extends({ query: queryExtensions as Parameters<typeof prisma.$extends>[0]['query'] })
}

export type ScopedPrisma = ReturnType<typeof createScopedPrisma>
```

- [ ] **Step 5: Create index.ts**
```typescript
// packages/shared/src/index.ts
export { prisma } from './prismaClient.js'
export { createScopedPrisma, type ScopedPrisma } from './scopedPrisma.js'
```

- [ ] **Step 6: Run test to verify it passes**
```bash
cd packages/shared && npx vitest run src/scopedPrisma.test.ts
```
Expected: PASS

- [ ] **Step 7: Commit**
```bash
git add packages/shared/src/
git commit -m "feat(shared): add createScopedPrisma — auto-injects orgId into all tenant queries"
```

---

## Chunk 3: Sub-project B — Auth (Google OAuth + Email OTP)

### Task 6: JWT utilities

**Files:**
- Create: `apps/api/src/lib/jwt.ts`
- Create: `apps/api/src/lib/jwt.test.ts`

- [ ] **Step 1: Write failing tests**
```typescript
// apps/api/src/lib/jwt.test.ts
import { describe, it, expect } from 'vitest'
import { signToken, verifyToken, type JwtPayload } from './jwt.js'

describe('JWT', () => {
  const payload: Omit<JwtPayload, 'jti' | 'iat' | 'exp'> = {
    userId: 1, orgId: 1, role: 'owner', isSuperadmin: false,
  }

  it('signs and verifies a token', () => {
    const token = signToken(payload)
    const decoded = verifyToken(token)
    expect(decoded.userId).toBe(1)
    expect(decoded.orgId).toBe(1)
    expect(decoded.jti).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('throws on invalid token', () => {
    expect(() => verifyToken('bad.token.here')).toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**
```bash
cd apps/api && npx vitest run src/lib/jwt.test.ts
```

- [ ] **Step 3: Implement jwt.ts**
```typescript
// apps/api/src/lib/jwt.ts
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
  return jwt.sign({ ...payload, jti: uuidv4() }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN })
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload
}
```

- [ ] **Step 4: Run test to verify it passes**
```bash
cd apps/api && npx vitest run src/lib/jwt.test.ts
```

- [ ] **Step 5: Commit**
```bash
git add apps/api/src/lib/jwt.ts apps/api/src/lib/jwt.test.ts
git commit -m "feat(auth): add JWT sign/verify with jti + typed payload"
```

---

### Task 7: Redis client + JWT revocation

**Files:**
- Create: `apps/api/src/lib/redis.ts`
- Create: `apps/api/src/lib/tokenRevocation.ts`
- Create: `apps/api/src/lib/tokenRevocation.test.ts`

- [ ] **Step 1: Create redis.ts**
```typescript
// apps/api/src/lib/redis.ts
import { Redis } from 'ioredis'

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379'

export const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null })
```

- [ ] **Step 2: Write failing tests for revocation**
```typescript
// apps/api/src/lib/tokenRevocation.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock redis
const mockRedis = { set: vi.fn(), get: vi.fn().mockResolvedValue(null) }
vi.mock('./redis.js', () => ({ redis: mockRedis }))

import { revokeToken, isTokenRevoked, revokeOrgTokens, isOrgRevoked } from './tokenRevocation.js'

describe('tokenRevocation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('revokeToken sets Redis key with TTL', async () => {
    await revokeToken('test-jti', 3600)
    expect(mockRedis.set).toHaveBeenCalledWith('jwt:revoked:test-jti', '1', 'EX', 3600)
  })

  it('isTokenRevoked returns false when key not set', async () => {
    mockRedis.get.mockResolvedValueOnce(null)
    expect(await isTokenRevoked('test-jti')).toBe(false)
  })

  it('isTokenRevoked returns true when key set', async () => {
    mockRedis.get.mockResolvedValueOnce('1')
    expect(await isTokenRevoked('test-jti')).toBe(true)
  })

  it('revokeOrgTokens sets per-org revocation timestamp', async () => {
    await revokeOrgTokens(42)
    expect(mockRedis.set).toHaveBeenCalledWith(
      'jwt:org:42:revokedBefore', expect.any(String), 'EX', 7 * 86400
    )
  })
})
```

- [ ] **Step 3: Run test to verify it fails**
```bash
cd apps/api && npx vitest run src/lib/tokenRevocation.test.ts
```

- [ ] **Step 4: Implement tokenRevocation.ts**
```typescript
// apps/api/src/lib/tokenRevocation.ts
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
```

- [ ] **Step 5: Run test to verify it passes**
```bash
cd apps/api && npx vitest run src/lib/tokenRevocation.test.ts
```

- [ ] **Step 6: Commit**
```bash
git add apps/api/src/lib/redis.ts apps/api/src/lib/tokenRevocation.ts apps/api/src/lib/tokenRevocation.test.ts
git commit -m "feat(auth): add Redis JWT revocation — per-jti and per-org"
```

---

### Task 8: requireAuth middleware

**Files:**
- Create: `apps/api/src/middleware/requireAuth.ts`
- Create: `apps/api/src/middleware/requireAuth.test.ts`

- [ ] **Step 1: Write failing tests**
```typescript
// apps/api/src/middleware/requireAuth.test.ts
import { describe, it, expect, vi } from 'vitest'
import type { Request, Response, NextFunction } from 'express'

const mockVerify = vi.fn()
const mockIsRevoked = vi.fn().mockResolvedValue(false)
const mockIsOrgRevoked = vi.fn().mockResolvedValue(false)

vi.mock('../lib/jwt.js', () => ({ verifyToken: mockVerify }))
vi.mock('../lib/tokenRevocation.js', () => ({
  isTokenRevoked: mockIsRevoked,
  isOrgRevoked: mockIsOrgRevoked,
}))

import { requireAuth } from './requireAuth.js'

function makeReq(cookie?: string, bearer?: string): Partial<Request> {
  return { cookies: cookie ? { token: cookie } : {}, headers: bearer ? { authorization: `Bearer ${bearer}` } : {} }
}
const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response
const next = vi.fn() as NextFunction

describe('requireAuth', () => {
  it('rejects when no token provided', async () => {
    await requireAuth(makeReq() as Request, res, next)
    expect(res.status).toHaveBeenCalledWith(401)
  })

  it('calls next() with valid cookie token', async () => {
    mockVerify.mockReturnValue({ jti: 'j1', userId: 1, orgId: 1, role: 'owner', isSuperadmin: false, iat: 0, exp: 9999999999 })
    await requireAuth(makeReq('valid.token') as Request, res, next)
    expect(next).toHaveBeenCalled()
  })

  it('rejects revoked jti', async () => {
    mockVerify.mockReturnValue({ jti: 'revoked', userId: 1, orgId: 1, role: 'owner', isSuperadmin: false, iat: 0, exp: 9999999999 })
    mockIsRevoked.mockResolvedValueOnce(true)
    await requireAuth(makeReq('revoked.token') as Request, res, next)
    expect(res.status).toHaveBeenCalledWith(401)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**
```bash
cd apps/api && npx vitest run src/middleware/requireAuth.test.ts
```

- [ ] **Step 3: Implement requireAuth.ts**
```typescript
// apps/api/src/middleware/requireAuth.ts
import type { Request, Response, NextFunction } from 'express'
import { verifyToken } from '../lib/jwt.js'
import { isTokenRevoked, isOrgRevoked } from '../lib/tokenRevocation.js'

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.token ?? req.headers.authorization?.replace('Bearer ', '')
  if (!token) return res.status(401).json({ error: 'Authentication required' })

  try {
    const payload = verifyToken(token)
    if (await isTokenRevoked(payload.jti)) return res.status(401).json({ error: 'Token revoked' })
    if (await isOrgRevoked(payload.orgId, payload.iat)) return res.status(401).json({ error: 'Session expired' })
    ;(req as Request & { user: typeof payload }).user = payload
    next()
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**
```bash
cd apps/api && npx vitest run src/middleware/requireAuth.test.ts
```

- [ ] **Step 5: Create requireRole.ts and requireSuperadmin.ts**
```typescript
// apps/api/src/middleware/requireRole.ts
import type { Request, Response, NextFunction } from 'express'
import type { Role } from '@prisma/client'
import type { JwtPayload } from '../lib/jwt.js'

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as Request & { user: JwtPayload }).user
    if (!user || (!user.isSuperadmin && !roles.includes(user.role))) {
      return res.status(403).json({ error: 'Insufficient permissions' })
    }
    next()
  }
}
```

```typescript
// apps/api/src/middleware/requireSuperadmin.ts
import type { Request, Response, NextFunction } from 'express'
import type { JwtPayload } from '../lib/jwt.js'

export function requireSuperadmin(req: Request, res: Response, next: NextFunction) {
  const user = (req as Request & { user: JwtPayload }).user
  if (!user?.isSuperadmin) return res.status(403).json({ error: 'Superadmin required' })
  next()
}
```

- [ ] **Step 6: Commit**
```bash
git add apps/api/src/middleware/
git commit -m "feat(auth): requireAuth + requireRole + requireSuperadmin middleware"
```

---

### Task 9: Email OTP endpoints

**Files:**
- Create: `apps/api/src/routes/otp.ts`
- Create: `apps/api/src/routes/otp.test.ts`

- [ ] **Step 0: Add supertest to devDependencies**
```bash
pnpm --filter api add -D supertest @types/supertest
```

- [ ] **Step 1: Write failing tests**
```typescript
// apps/api/src/routes/otp.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

// Mock prisma, nodemailer
vi.mock('shared', () => ({
  prisma: {
    user: { upsert: vi.fn().mockResolvedValue({ id: 1, email: 'test@example.com' }) },
    otpToken: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
    org: { create: vi.fn().mockResolvedValue({ id: 2 }) },
    orgMembership: { create: vi.fn() },
    orgSubscription: { create: vi.fn() },
  },
  createScopedPrisma: vi.fn(),
}))
vi.mock('../lib/mailer.js', () => ({ sendOtpEmail: vi.fn() }))
vi.mock('../lib/jwt.js', () => ({ signToken: vi.fn().mockReturnValue('mock-jwt') }))

import { otpRouter } from './otp.js'

const app = express()
app.use(express.json())
app.use('/api/otp', otpRouter)

describe('POST /api/otp/send', () => {
  it('returns 200 on valid email', async () => {
    const res = await request(app).post('/api/otp/send').send({ email: 'test@example.com' })
    expect(res.status).toBe(200)
    expect(res.body.message).toBe('OTP sent')
  })

  it('returns 400 on missing email', async () => {
    const res = await request(app).post('/api/otp/send').send({})
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**
```bash
cd apps/api && npx vitest run src/routes/otp.test.ts
```

- [ ] **Step 3: Implement otp.ts**
```typescript
// apps/api/src/routes/otp.ts
import { Router } from 'express'
import bcrypt from 'bcrypt'
import { z } from 'zod'
import { prisma, createScopedPrisma } from 'shared'
import { signToken } from '../lib/jwt.js'
import { sendOtpEmail } from '../lib/mailer.js'

export const otpRouter = Router()

function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000))
}

otpRouter.post('/send', async (req, res) => {
  const parsed = z.object({ email: z.string().email() }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Valid email required' })

  const { email } = parsed.data
  const user = await prisma.user.upsert({
    where: { email }, update: {}, create: { email },
  })

  const code = generateOtp()
  const codeHash = await bcrypt.hash(code, 10)
  await prisma.otpToken.create({
    data: { userId: user.id, codeHash, expiresAt: new Date(Date.now() + 5 * 60 * 1000) },
  })

  await sendOtpEmail(email, code)
  return res.json({ message: 'OTP sent' })
})

otpRouter.post('/verify', async (req, res) => {
  const parsed = z.object({ email: z.string().email(), code: z.string().length(6) }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Email and 6-digit code required' })

  const { email, code } = parsed.data
  const user = await prisma.user.findUnique({ where: { email } })
  if (!user) return res.status(401).json({ error: 'Invalid code' })

  const token = await prisma.otpToken.findFirst({
    where: { userId: user.id, used: false, expiresAt: { gt: new Date() } },
    orderBy: { id: 'desc' },
  })
  if (!token) return res.status(401).json({ error: 'Invalid or expired code' })

  const match = await bcrypt.compare(code, token.codeHash)
  if (!match) {
    const newAttempts = token.attempts + 1
    if (newAttempts >= 5) {
      await prisma.otpToken.update({ where: { id: token.id }, data: { used: true, attempts: newAttempts } })
      return res.status(429).json({ error: 'Too many attempts. Request a new code.' })
    }
    await prisma.otpToken.update({ where: { id: token.id }, data: { attempts: newAttempts } })
    return res.status(401).json({ error: 'Invalid code' })
  }

  await prisma.otpToken.update({ where: { id: token.id }, data: { used: true } })
  await prisma.otpToken.deleteMany({ where: { userId: user.id, OR: [{ used: true }, { expiresAt: { lt: new Date() } }] } })

  let membership = await prisma.orgMembership.findFirst({ where: { userId: user.id } })
  if (!membership) {
    const org = await prisma.org.create({ data: { name: email.split('@')[0], slug: `${email.split('@')[0]}-${Date.now()}` } })
    const plan = await prisma.plan.findFirst({ where: { name: 'Trial' } })
    await prisma.orgSubscription.create({
      data: { orgId: org.id, planId: plan!.id, status: 'trial', trialEndsAt: new Date(Date.now() + 14 * 86400 * 1000) },
    })
    membership = await prisma.orgMembership.create({ data: { orgId: org.id, userId: user.id, role: 'owner' } })
  }

  const jwt = signToken({ userId: user.id, orgId: membership.orgId, role: membership.role, isSuperadmin: user.isSuperadmin })
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })

  res.cookie('token', jwt, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' })
  return res.json({ token: jwt, message: 'Authenticated' })
})
```

- [ ] **Step 4: Run tests to verify pass**
```bash
cd apps/api && npx vitest run src/routes/otp.test.ts
```

- [ ] **Step 5: Commit**
```bash
git add apps/api/src/routes/otp.ts apps/api/src/routes/otp.test.ts
git commit -m "feat(auth): OTP send + verify endpoints with brute-force protection"
```

---

### Task 10: Google OAuth routes

**Files:**
- Create: `apps/api/src/webhooks/google.ts`

- [ ] **Step 1: Install passport deps**
```bash
pnpm --filter api add passport passport-google-oauth20
pnpm --filter api add -D @types/passport @types/passport-google-oauth20
```

- [ ] **Step 2: Implement Google OAuth routes**
```typescript
// apps/api/src/webhooks/google.ts
import { Router } from 'express'
import passport from 'passport'
import { Strategy as GoogleStrategy } from 'passport-google-oauth20'
import { prisma } from 'shared'
import { signToken } from '../lib/jwt.js'

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!
const GOOGLE_CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL!
const DASHBOARD_URL = process.env.DASHBOARD_URL ?? 'http://localhost:5173'

passport.use(new GoogleStrategy(
  { clientID: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET, callbackURL: GOOGLE_CALLBACK_URL },
  async (_accessToken, _refreshToken, profile, done) => {
    const email = profile.emails?.[0].value
    if (!email) return done(new Error('No email from Google'))

    let user = await prisma.user.findFirst({ where: { OR: [{ googleId: profile.id }, { email }] } })
    if (!user) {
      user = await prisma.user.create({ data: { email, googleId: profile.id } })
    } else if (!user.googleId) {
      user = await prisma.user.update({ where: { id: user.id }, data: { googleId: profile.id } })
    }
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })

    let membership = await prisma.orgMembership.findFirst({ where: { userId: user.id } })
    if (!membership) {
      const org = await prisma.org.create({ data: { name: email.split('@')[0], slug: `${email.split('@')[0]}-${Date.now()}` } })
      const plan = await prisma.plan.findFirst({ where: { name: 'Trial' } })
      await prisma.orgSubscription.create({
        data: { orgId: org.id, planId: plan!.id, status: 'trial', trialEndsAt: new Date(Date.now() + 14 * 86400 * 1000) },
      })
      membership = await prisma.orgMembership.create({ data: { orgId: org.id, userId: user.id, role: 'owner' } })
    }

    const token = signToken({ userId: user.id, orgId: membership.orgId, role: membership.role, isSuperadmin: user.isSuperadmin })
    done(null, { token })
  }
))

export const googleRouter = Router()

googleRouter.get('/', passport.authenticate('google', { scope: ['email', 'profile'], session: false }))

googleRouter.get('/callback',
  passport.authenticate('google', { session: false, failureRedirect: '/login?error=oauth' }),
  (req, res) => {
    const { token } = req.user as { token: string }
    res.cookie('token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' })
    res.redirect(`${DASHBOARD_URL}/dashboard`)
  }
)
```

- [ ] **Step 3: Add GET /auth/google/token endpoint for WebSocket connectionParams**

Add `requireAuth` import to the **top** of `google.ts` (with other imports), then append the route:
```typescript
// At top of file with other imports:
import { requireAuth } from '../middleware/requireAuth.js'

// After the callback route:
googleRouter.get('/token', requireAuth, (req, res) => {
  // Reads HttpOnly cookie (validated by requireAuth), returns token for in-memory WS use
  const token = (req as typeof req & { cookies: Record<string, string> }).cookies?.token
  return res.json({ token })
})
```

- [ ] **Step 4: Commit**
```bash
git add apps/api/src/webhooks/google.ts
git commit -m "feat(auth): Google OAuth strategy + callback + /auth/token for WS auth"
```

---

## Chunk 4: Sub-project C — Plans + Rate Limiting + Trial Enforcement

### Task 11: Plan enforcement middleware

**Files:**
- Create: `apps/api/src/middleware/enforcePlan.ts`
- Create: `apps/api/src/middleware/rateLimits.ts`
- Create: `apps/api/src/middleware/enforcePlan.test.ts`

- [ ] **Step 1: Write failing tests**
```typescript
// apps/api/src/middleware/enforcePlan.test.ts
import { describe, it, expect, vi } from 'vitest'
import type { Request, Response, NextFunction } from 'express'

vi.mock('shared', () => ({
  prisma: {
    orgSubscription: {
      findUnique: vi.fn().mockResolvedValue({
        status: 'trial',
        trialEndsAt: new Date(Date.now() + 86400 * 1000),
        plan: { limitsJson: { seats: 2 } },
      }),
    },
  },
}))

import { checkOrgStatus } from './enforcePlan.js'

const next = vi.fn() as NextFunction
const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response

describe('checkOrgStatus', () => {
  it('calls next() for active trial', async () => {
    const req = { user: { orgId: 1 } } as unknown as Request
    await checkOrgStatus(req, res, next)
    expect(next).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**
```bash
cd apps/api && npx vitest run src/middleware/enforcePlan.test.ts
```

- [ ] **Step 3: Implement enforcePlan.ts**
```typescript
// apps/api/src/middleware/enforcePlan.ts
import type { Request, Response, NextFunction } from 'express'
import { prisma } from 'shared'
import type { JwtPayload } from '../lib/jwt.js'

export async function checkOrgStatus(req: Request, res: Response, next: NextFunction) {
  const user = (req as Request & { user: JwtPayload }).user
  const sub = await prisma.orgSubscription.findUnique({
    where: { orgId: user.orgId },
    include: { plan: true },
  })
  if (!sub) return res.status(402).json({ error: 'No active subscription' })

  if (sub.status === 'locked') return res.status(402).json({ error: 'Subscription required', code: 'PAYMENT_REQUIRED' })
  if (sub.status === 'suspended') return res.status(403).json({ error: 'Account suspended' })

  if (sub.status === 'trial' && sub.trialEndsAt && sub.trialEndsAt < new Date()) {
    await prisma.orgSubscription.update({ where: { orgId: user.orgId }, data: { status: 'locked' } })
    return res.status(402).json({ error: 'Trial expired', code: 'PAYMENT_REQUIRED' })
  }

  ;(req as Request & { planLimits: Record<string, unknown> }).planLimits = sub.plan.limitsJson as Record<string, unknown>
  next()
}
```

- [ ] **Step 4: Implement rateLimits.ts**
```typescript
// apps/api/src/middleware/rateLimits.ts
import rateLimit from 'express-rate-limit'
import type { Request } from 'express'
import { prisma } from 'shared'
import type { JwtPayload } from '../lib/jwt.js'

const PLAN_LIMITS: Record<string, number> = {
  Trial: 30, Starter: 60, Growth: 120, Agency: 300,
}

// Note: express-rate-limit v7 max must be synchronous. Plan name is read from
// the JWT payload (added at sign time) to avoid async DB lookup here.
export const orgRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: (req: Request) => {
    const user = (req as Request & { user: JwtPayload & { planName?: string } }).user
    if (!user) return 10
    return PLAN_LIMITS[user.planName ?? 'Trial'] ?? 30
  },
  keyGenerator: (req: Request) => {
    const user = (req as Request & { user: JwtPayload }).user
    return user ? `org:${user.orgId}` : req.ip ?? 'unknown'
  },
  message: { error: 'Rate limit exceeded' },
})

export const otpRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.ip ?? 'unknown',
  message: { error: 'Too many OTP requests. Try again in 15 minutes.' },
})
```

- [ ] **Step 5: Run test to verify it passes**
```bash
cd apps/api && npx vitest run src/middleware/enforcePlan.test.ts
```

- [ ] **Step 6: Commit**
```bash
git add apps/api/src/middleware/enforcePlan.ts apps/api/src/middleware/rateLimits.ts apps/api/src/middleware/enforcePlan.test.ts
git commit -m "feat(plans): plan enforcement middleware + org/OTP rate limiting"
```

---

## Chunk 5: Sub-project D — Razorpay Billing + Webhooks

### Task 12: Razorpay billing routes

**Files:**
- Create: `apps/api/src/webhooks/razorpay.ts`
- Create: `apps/api/src/routes/billing.ts`

- [ ] **Step 1: Install Razorpay SDK**
```bash
pnpm --filter api add razorpay
```

- [ ] **Step 2: Implement Razorpay webhook handler**
```typescript
// apps/api/src/webhooks/razorpay.ts
import { Router } from 'express'
import crypto from 'crypto'
import { prisma } from 'shared'
import { revokeOrgTokens } from '../lib/tokenRevocation.js'

export const razorpayWebhookRouter = Router()

razorpayWebhookRouter.post('/', async (req, res) => {
  const signature = req.headers['x-razorpay-signature'] as string
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET!

  const expectedSig = crypto.createHmac('sha256', secret).update(JSON.stringify(req.body)).digest('hex')
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
    return res.status(400).json({ error: 'Invalid signature' })
  }

  const event = req.body as { event: string; payload: { subscription: { entity: { id: string; notes: { orgId?: string } } } }, entity: { id: string } }
  const razorpayEventId = event.entity?.id ?? `${event.event}-${Date.now()}`

  const sub = event.payload?.subscription?.entity
  if (!sub) return res.json({ ok: true })

  const orgSub = await prisma.orgSubscription.findFirst({ where: { razorpaySubId: sub.id } })
  if (!orgSub) return res.json({ ok: true })

  // Idempotency — skip if already processed
  const existing = await prisma.razorpayWebhookEvent.findUnique({ where: { razorpayEventId } })
  if (existing) return res.json({ ok: true })

  await prisma.razorpayWebhookEvent.create({ data: { razorpayEventId, eventType: event.event, orgSubId: orgSub.id } })

  switch (event.event) {
    case 'subscription.activated':
      await prisma.orgSubscription.update({ where: { id: orgSub.id }, data: { status: 'active' } })
      await prisma.org.update({ where: { id: orgSub.orgId }, data: { status: 'active' } })
      break
    case 'subscription.charged':
      await prisma.orgSubscription.update({
        where: { id: orgSub.id },
        data: { status: 'active', currentPeriodEnd: new Date(Date.now() + 30 * 86400 * 1000) },
      })
      break
    case 'subscription.cancelled':
      await prisma.orgSubscription.update({ where: { id: orgSub.id }, data: { cancelAtPeriodEnd: true } })
      break
    case 'subscription.completed':
      await prisma.orgSubscription.update({ where: { id: orgSub.id }, data: { status: 'locked' } })
      await prisma.org.update({ where: { id: orgSub.orgId }, data: { status: 'locked' } })
      await revokeOrgTokens(orgSub.orgId)
      break
    case 'payment.failed':
      await prisma.orgSubscription.update({
        where: { id: orgSub.id },
        data: { status: 'grace', graceEndsAt: new Date(Date.now() + 3 * 86400 * 1000) },
      })
      break
  }

  return res.json({ ok: true })
})
```

- [ ] **Step 3: Implement billing routes**
```typescript
// apps/api/src/routes/billing.ts
import { Router } from 'express'
import Razorpay from 'razorpay'
import { prisma } from 'shared'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireRole } from '../middleware/requireRole.js'
import type { JwtPayload } from '../lib/jwt.js'
import type { Request } from 'express'

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID!,
  key_secret: process.env.RAZORPAY_KEY_SECRET!,
})

export const billingRouter = Router()
billingRouter.use(requireAuth)

billingRouter.post('/create-subscription', requireRole('owner'), async (req, res) => {
  const { planId } = req.body as { planId: number }
  const user = (req as Request & { user: JwtPayload }).user
  const plan = await prisma.plan.findUnique({ where: { id: planId } })
  if (!plan) return res.status(404).json({ error: 'Plan not found' })

  // Create Razorpay subscription (plan must be pre-created in Razorpay dashboard)
  const rSub = await razorpay.subscriptions.create({
    plan_id: `plan_${plan.name.toLowerCase()}`,
    total_count: 12,
    quantity: 1,
  })

  await prisma.orgSubscription.update({
    where: { orgId: user.orgId },
    data: { razorpaySubId: rSub.id, planId },
  })

  return res.json({ checkoutUrl: `https://rzp.io/i/${rSub.id}` })
})

billingRouter.post('/cancel', requireRole('owner'), async (req, res) => {
  const user = (req as Request & { user: JwtPayload }).user
  await prisma.orgSubscription.update({
    where: { orgId: user.orgId },
    data: { cancelAtPeriodEnd: true },
  })
  return res.json({ cancelAtPeriodEnd: true })
})

billingRouter.get('/portal', async (req, res) => {
  const user = (req as Request & { user: JwtPayload }).user
  const sub = await prisma.orgSubscription.findUnique({
    where: { orgId: user.orgId }, include: { plan: true },
  })
  return res.json(sub)
})
```

- [ ] **Step 4: Commit**
```bash
git add apps/api/src/webhooks/razorpay.ts apps/api/src/routes/billing.ts
git commit -m "feat(billing): Razorpay webhook handler (idempotent) + billing routes"
```

---

## Chunk 6: Sub-project E — GraphQL API + Superadmin

### Task 13: GraphQL server setup (Pothos + graphql-yoga)

**Files:**
- Create: `apps/api/src/graphql/builder.ts`
- Create: `apps/api/src/graphql/context.ts`
- Create: `apps/api/src/graphql/schema.ts`

- [ ] **Step 1: Install GraphQL deps**
```bash
pnpm --filter api add graphql graphql-yoga @pothos/core @pothos/plugin-prisma @pothos/plugin-errors ws graphql-ws
pnpm --filter api add -D @types/ws
```

- [ ] **Step 2: Create Pothos builder**
```typescript
// apps/api/src/graphql/builder.ts
import SchemaBuilder from '@pothos/core'
import PrismaPlugin from '@pothos/plugin-prisma'
import ErrorsPlugin from '@pothos/plugin-errors'
import type { ScopedPrisma } from 'shared'
import type { JwtPayload } from '../lib/jwt.js'
import { prisma } from 'shared'

export interface Context {
  user: JwtPayload | null
  db: ScopedPrisma | typeof prisma  // scoped for users, raw for superadmin
  pubsub: EventEmitter
}

import EventEmitter from 'eventemitter3'
export const pubsub = new EventEmitter()

export const builder = new SchemaBuilder<{ Context: Context }>({
  plugins: [PrismaPlugin, ErrorsPlugin],
  prisma: { client: prisma },
})

builder.queryType({})
builder.mutationType({})
builder.subscriptionType({})
```

- [ ] **Step 3: Create context factory**
```typescript
// apps/api/src/graphql/context.ts
import type { Request } from 'express'
import { createScopedPrisma, prisma } from 'shared'
import { verifyToken } from '../lib/jwt.js'
import { isTokenRevoked, isOrgRevoked } from '../lib/tokenRevocation.js'
import { pubsub } from './builder.js'
import type { Context } from './builder.js'

export async function createContext(req: Request): Promise<Context> {
  const token = req.cookies?.token ?? req.headers.authorization?.replace('Bearer ', '')
  if (!token) return { user: null, db: prisma, pubsub }

  try {
    const payload = verifyToken(token)
    if (await isTokenRevoked(payload.jti)) return { user: null, db: prisma, pubsub }
    if (await isOrgRevoked(payload.orgId, payload.iat)) return { user: null, db: prisma, pubsub }
    const db = payload.isSuperadmin ? prisma : createScopedPrisma(payload.orgId)
    return { user: payload, db, pubsub }
  } catch {
    return { user: null, db: prisma, pubsub }
  }
}
```

- [ ] **Step 4: Add leads resolver (example, follow pattern for others)**
```typescript
// apps/api/src/graphql/resolvers/leads.ts
import { builder } from '../builder.js'

const LeadObject = builder.prismaObject('Lead', {
  fields: (t) => ({
    id: t.exposeInt('id'),
    businessName: t.exposeString('businessName', { nullable: true }),
    status: t.exposeString('status'),
    icpScore: t.exposeInt('icpScore', { nullable: true }),
    contactEmail: t.exposeString('contactEmail', { nullable: true }),
    discoveredAt: t.expose('discoveredAt', { type: 'String' }),
  }),
})

builder.queryField('leads', (t) =>
  t.prismaConnection({
    type: 'Lead',
    cursor: 'id',
    resolve: (query, _root, _args, ctx) => {
      if (!ctx.user) throw new Error('Unauthenticated')
      return ctx.db.lead.findMany({ ...query, orderBy: { icpScore: 'desc' } })
    },
  })
)
```

- [ ] **Step 5: Create schema.ts (imports all resolvers)**
```typescript
// apps/api/src/graphql/schema.ts
import { builder } from './builder.js'
import './resolvers/leads.js'
import './resolvers/emails.js'
import './resolvers/replies.js'
import './resolvers/billing.js'
import './resolvers/orgs.js'
import './resolvers/admin.js'
import './subscriptions/engine.js'
import './subscriptions/leads.js'
import './subscriptions/replies.js'
import './subscriptions/billing.js'

export const schema = builder.toSchema()
```

- [ ] **Step 6: Commit**
```bash
git add apps/api/src/graphql/
git commit -m "feat(graphql): Pothos builder + context + leads resolver skeleton"
```

---

### Task 14: Express server with all routes mounted

**Files:**
- Create: `apps/api/src/server.ts`

- [ ] **Step 1: Create server.ts**
```typescript
// apps/api/src/server.ts
import express from 'express'
import cookieParser from 'cookie-parser'
import passport from 'passport'
import { createYoga } from 'graphql-yoga'
import { WebSocketServer } from 'ws'
import { useServer } from 'graphql-ws/lib/use/ws'
import { createServer } from 'http'
import { schema } from './graphql/schema.js'
import { createContext } from './graphql/context.js'
import { verifyToken } from './lib/jwt.js'
import { isTokenRevoked, isOrgRevoked } from './lib/tokenRevocation.js'
import { createScopedPrisma, prisma } from 'shared'
import { pubsub } from './graphql/builder.js'
import { googleRouter } from './webhooks/google.js'
import { razorpayWebhookRouter } from './webhooks/razorpay.js'
import { otpRouter } from './routes/otp.js'
import { billingRouter } from './routes/billing.js'
import { requireAuth } from './middleware/requireAuth.js'
import { requireSuperadmin } from './middleware/requireSuperadmin.js'
import { orgRateLimit, otpRateLimit } from './middleware/rateLimits.js'
import { createBullBoard } from '@bull-board/api'
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter.js'
import { ExpressAdapter } from '@bull-board/express'
import { Queue } from 'bullmq'
import { redis } from './lib/redis.js'
import pino from 'pino'

const logger = pino()
const app = express()
const httpServer = createServer(app)

app.use(cookieParser())
app.use(express.json({ verify: (req, _res, buf) => { (req as express.Request & { rawBody: Buffer }).rawBody = buf } }))
app.use(passport.initialize())

// Auth routes
app.use('/auth/google', googleRouter)
app.use('/api/otp', otpRateLimit, otpRouter)

// Razorpay webhook — MUST be before /api/billing (no auth, HMAC-only)
app.use('/api/billing/webhook', razorpayWebhookRouter)

// Billing routes (JWT-protected)
app.use('/api/billing', billingRouter)

// GraphQL
const yoga = createYoga({ schema, context: ({ request }) => createContext(request as unknown as express.Request) })
app.use('/graphql', requireAuth, orgRateLimit, yoga)

// Bull Board (superadmin only)
const serverAdapter = new ExpressAdapter()
const jobQueues = ['findLeads', 'sendEmails', 'sendFollowups', 'checkReplies', 'dailyReport', 'healthCheck']
  .map(name => new BullMQAdapter(new Queue(name, { connection: redis })))
createBullBoard({ queues: jobQueues, serverAdapter })
app.use('/admin/queues', requireAuth, requireSuperadmin, serverAdapter.getRouter())

// WebSocket server for GraphQL subscriptions
const wss = new WebSocketServer({ server: httpServer, path: '/graphql' })
useServer({
  schema,
  onConnect: async (ctx) => {
    const token = (ctx.connectionParams as Record<string, string>)?.authToken
    if (!token) throw new Error('Unauthorized')
    try {
      const payload = verifyToken(token)
      if (await isTokenRevoked(payload.jti)) throw new Error('Token revoked')
      if (await isOrgRevoked(payload.orgId, payload.iat)) throw new Error('Session expired')
      return { user: payload }
    } catch {
      throw new Error('Unauthorized')
    }
  },
  context: (ctx) => {
    const user = (ctx.extra as { user: ReturnType<typeof verifyToken> }).user
    const db = user.isSuperadmin ? prisma : createScopedPrisma(user.orgId)
    return { user, db, pubsub }
  },
}, wss)

const PORT = Number(process.env.DASHBOARD_PORT ?? 3001)
httpServer.listen(PORT, () => logger.info({ port: PORT }, 'Radar API started'))
```

- [ ] **Step 2: Install bull-board**
```bash
pnpm --filter api add @bull-board/express @bull-board/api eventemitter3
```

- [ ] **Step 3: Start server and verify it boots**
```bash
cd apps/api && npx tsx src/server.ts
```
Expected: "Radar API started" log, no crashes

- [ ] **Step 4: Commit**
```bash
git add apps/api/src/server.ts
git commit -m "feat(api): wire Express server with GraphQL, WS, auth, billing, bull-board"
```

---

## Chunk 7: Sub-project G — Engine Migration to BullMQ Workers

### Task 15: BullMQ worker scaffolding

**Files:**
- Create: `apps/api/src/workers/scheduler.ts`
- Create: `apps/api/src/workers/findLeads.worker.ts` (example — repeat for other 5)

- [ ] **Step 1: Create scheduler.ts (replaces src/scheduler/cron.js)**
```typescript
// apps/api/src/workers/scheduler.ts
import cron from 'node-cron'
import { Queue } from 'bullmq'
import { redis } from '../lib/redis.js'
import { prisma } from 'shared'

const makeQueue = (name: string) => new Queue(name, { connection: redis, defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 60000 } } })

const queues = {
  findLeads:      makeQueue('findLeads'),
  sendEmails:     makeQueue('sendEmails'),
  sendFollowups:  makeQueue('sendFollowups'),
  checkReplies:   makeQueue('checkReplies'),
  dailyReport:    makeQueue('dailyReport'),
  healthCheck:    makeQueue('healthCheck'),
}

async function enqueueForAllOrgs(queueName: keyof typeof queues) {
  const orgs = await prisma.org.findMany({ where: { status: { in: ['trial', 'active'] } } })
  for (const org of orgs) await queues[queueName].add(queueName, { orgId: org.id })
}

// IST offset: UTC+5:30 = UTC-05:30 for cron. Use TZ env var in production.
cron.schedule('30 3 * * 1-6', () => enqueueForAllOrgs('findLeads'))    // 09:00 IST Mon-Sat
cron.schedule('0 4 * * 1-6',  () => enqueueForAllOrgs('sendEmails'))   // 09:30 IST Mon-Sat
cron.schedule('30 12 * * *',  () => enqueueForAllOrgs('sendFollowups'))// 18:00 IST daily
cron.schedule('30 8 * * *',   () => enqueueForAllOrgs('checkReplies')) // 14:00 IST
cron.schedule('30 10 * * *',  () => enqueueForAllOrgs('checkReplies')) // 16:00 IST
cron.schedule('30 14 * * *',  () => enqueueForAllOrgs('checkReplies')) // 20:00 IST
cron.schedule('0 15 * * *',   () => enqueueForAllOrgs('dailyReport'))  // 20:30 IST
cron.schedule('30 20 * * 0',  () => enqueueForAllOrgs('healthCheck'))  // 02:00 IST Sun

export { queues }
```

- [ ] **Step 2: Create findLeads.worker.ts (shell — logic migrated from src/engines/findLeads.js)**
```typescript
// apps/api/src/workers/findLeads.worker.ts
import { Worker } from 'bullmq'
import { redis } from '../lib/redis.js'
import { prisma, createScopedPrisma } from 'shared'
import { pubsub } from '../graphql/builder.js'
import pino from 'pino'

const logger = pino()

export const findLeadsWorker = new Worker('findLeads', async (job) => {
  const { orgId } = job.data as { orgId: number }
  const db = createScopedPrisma(orgId)

  // Load plan limits for this org
  const sub = await prisma.orgSubscription.findUnique({ where: { orgId }, include: { plan: true } })
  if (!sub || sub.status === 'locked' || sub.status === 'suspended') return
  const limits = sub.plan.limitsJson as Record<string, number>

  logger.info({ orgId, jobId: job.id }, 'findLeads worker started')

  const startCronLog = await prisma.cronLog.create({
    data: { jobName: 'findLeads', orgId, startedAt: new Date(), status: 'running' },
  })

  try {
    // Emit progress via pubsub for GraphQL subscription
    const emitProgress = (stage: string, count: number, total: number) => {
      pubsub.emit(`engineProgress:${orgId}`, { jobName: 'findLeads', stage, count, total })
    }

    // TODO: migrate pipeline logic from src/engines/findLeads.js to TypeScript here
    // Pass limits.leadsPerDay as the daily cap
    // Pass limits.geminiQueriesPerDay as the Gemini quota
    // Pass limits.claudeDailySpendCapUsd to checkSpendCap(orgId)
    emitProgress('discovery', 0, 150)
    // ... pipeline stages ...

    await prisma.cronLog.update({
      where: { id: startCronLog.id },
      data: { status: 'success', completedAt: new Date() },
    })
  } catch (err) {
    await prisma.cronLog.update({ where: { id: startCronLog.id }, data: { status: 'failed', errorMessage: String(err) } })
    await prisma.errorLog.create({ data: { orgId, source: 'findLeads', errorMessage: String(err) } })
    throw err  // BullMQ will retry per job options
  }
}, { connection: redis, concurrency: 2 })
```

- [ ] **Step 3: Repeat worker shell for remaining 5 engines**

Create `sendEmails.worker.ts`, `sendFollowups.worker.ts`, `checkReplies.worker.ts`, `dailyReport.worker.ts`, `healthCheck.worker.ts` — same pattern.

- [ ] **Step 4: Test that a job can be enqueued and picked up**
```typescript
// apps/api/src/workers/workers.test.ts
import { describe, it, expect } from 'vitest'
import { Queue } from 'bullmq'
import { redis } from '../lib/redis.js'

describe('BullMQ queue', () => {
  it('can add a job and retrieve it', async () => {
    const queue = new Queue('test-queue', { connection: redis })
    const job = await queue.add('test', { orgId: 1 })
    expect(job.id).toBeDefined()
    await queue.close()
  }, 10000)
})
```

- [ ] **Step 5: Run test**
```bash
cd apps/api && npx vitest run src/workers/workers.test.ts
```
Expected: PASS (requires Redis running)

- [ ] **Step 6: Commit**
```bash
git add apps/api/src/workers/
git commit -m "feat(workers): BullMQ scheduler + worker shells for all 6 engines"
```

---

## Chunk 8: Sub-project F — Frontend (Auth + Settings + Billing)

### Task 16: Frontend TypeScript + Tailwind + shadcn/ui setup

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/web/vite.config.ts`
- Create: `apps/web/tailwind.config.ts`
- Create: `apps/web/src/lib/urqlClient.ts`

- [ ] **Step 1: Add frontend deps**
```bash
pnpm --filter web add @urql/core @urql/react graphql graphql-ws @tanstack/react-query
pnpm --filter web add -D tailwindcss postcss autoprefixer @types/react @types/react-dom typescript
npx --prefix apps/web shadcn-ui@latest init
```
Follow shadcn prompts: TypeScript=yes, Tailwind=yes, CSS variables=yes

- [ ] **Step 2: Create urql client with WebSocket support**
```typescript
// apps/web/src/lib/urqlClient.ts
import { createClient, fetchExchange, subscriptionExchange } from '@urql/core'
import { createClient as createWSClient } from 'graphql-ws'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'
const WS_URL  = API_URL.replace('http', 'ws')

const wsClient = createWSClient({
  url: `${WS_URL}/graphql`,
  connectionParams: async () => {
    const res = await fetch(`${API_URL}/auth/google/token`, { credentials: 'include' })
    const { token } = await res.json() as { token: string }
    return { authToken: token }
  },
})

export const urqlClient = createClient({
  url: `${API_URL}/graphql`,
  fetchOptions: { credentials: 'include' },
  exchanges: [
    fetchExchange,
    subscriptionExchange({ forwardSubscription: (request) => ({ subscribe: (sink) => ({ unsubscribe: wsClient.subscribe(request, sink) }) }) }),
  ],
})
```

- [ ] **Step 3: Add auth utility**
```typescript
// apps/web/src/lib/auth.ts
const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

export async function sendOtp(email: string) {
  const res = await fetch(`${API_URL}/api/otp/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }), credentials: 'include' })
  if (!res.ok) throw new Error((await res.json() as { error: string }).error)
}

export async function verifyOtp(email: string, code: string) {
  const res = await fetch(`${API_URL}/api/otp/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, code }), credentials: 'include' })
  if (!res.ok) throw new Error((await res.json() as { error: string }).error)
}

export function googleLoginUrl() {
  return `${API_URL}/auth/google`
}
```

- [ ] **Step 4: Commit**
```bash
git add apps/web/
git commit -m "feat(web): TypeScript + Tailwind + shadcn/ui + urql + WS client setup"
```

---

### Task 17: Login + OTP pages

**Files:**
- Create: `apps/web/src/pages/Login.tsx`
- Create: `apps/web/src/pages/Otp.tsx`

- [ ] **Step 1: Create Login.tsx**
```tsx
// apps/web/src/pages/Login.tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { sendOtp, googleLoginUrl } from '@/lib/auth'

export default function Login() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  const handleOtp = async () => {
    setLoading(true)
    setError('')
    try {
      await sendOtp(email)
      navigate('/otp', { state: { email } })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm space-y-6 p-8 bg-white rounded-xl shadow">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Sign in to Radar</h1>
          <p className="text-sm text-gray-500 mt-1">Your outreach intelligence engine</p>
        </div>
        <Button className="w-full" variant="outline" onClick={() => window.location.href = googleLoginUrl()}>
          Continue with Google
        </Button>
        <div className="relative"><div className="absolute inset-0 flex items-center"><div className="w-full border-t" /></div><div className="relative flex justify-center text-xs uppercase"><span className="bg-white px-2 text-gray-500">Or</span></div></div>
        <div className="space-y-3">
          <Input type="email" placeholder="your@email.com" value={email} onChange={e => setEmail(e.target.value)} />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button className="w-full" onClick={handleOtp} disabled={!email || loading}>
            {loading ? 'Sending...' : 'Send OTP'}
          </Button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create Otp.tsx**
```tsx
// apps/web/src/pages/Otp.tsx
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { verifyOtp } from '@/lib/auth'

export default function Otp() {
  const { state } = useLocation() as { state: { email: string } }
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const handleVerify = async () => {
    setLoading(true)
    setError('')
    try {
      await verifyOtp(state.email, code)
      navigate('/dashboard')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm space-y-6 p-8 bg-white rounded-xl shadow">
        <h1 className="text-2xl font-bold">Check your email</h1>
        <p className="text-sm text-gray-500">We sent a 6-digit code to <strong>{state?.email}</strong></p>
        <Input placeholder="000000" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button className="w-full" onClick={handleVerify} disabled={code.length !== 6 || loading}>
          {loading ? 'Verifying...' : 'Verify'}
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Add routes to App.tsx**

Add to existing App.tsx:
```tsx
import Login from './pages/Login'
import Otp from './pages/Otp'
// In router: <Route path="/login" element={<Login />} />
//            <Route path="/otp"   element={<Otp />} />
```

- [ ] **Step 4: Start frontend dev server and test login flow manually**
```bash
cd apps/web && npm run dev
# Navigate to /login
# Test Google OAuth button (requires .env GOOGLE_CLIENT_ID set)
# Test OTP email flow
```

- [ ] **Step 5: Commit**
```bash
git add apps/web/src/pages/Login.tsx apps/web/src/pages/Otp.tsx apps/web/src/App.tsx
git commit -m "feat(web): Login + OTP pages with Google OAuth + email OTP flows"
```

---

### Task 18: Trial banner + Paywall

**Files:**
- Create: `apps/web/src/components/TrialBanner.tsx`
- Create: `apps/web/src/components/GraceBanner.tsx`
- Create: `apps/web/src/components/PaywallPage.tsx`

- [ ] **Step 1: Create TrialBanner.tsx**
```tsx
// apps/web/src/components/TrialBanner.tsx
interface Props { daysLeft: number; onUpgrade: () => void }

export function TrialBanner({ daysLeft, onUpgrade }: Props) {
  if (daysLeft > 8) return null
  return (
    <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center justify-between text-sm">
      <span className="text-amber-800">⚡ {daysLeft} day{daysLeft !== 1 ? 's' : ''} left on your trial — upgrade to keep your leads flowing</span>
      <button onClick={onUpgrade} className="text-amber-900 font-medium underline ml-4">Upgrade now →</button>
    </div>
  )
}
```

- [ ] **Step 2: Create GraceBanner.tsx**
```tsx
// apps/web/src/components/GraceBanner.tsx
interface Props { graceEndsAt: string; onUpdate: () => void }

export function GraceBanner({ graceEndsAt, onUpdate }: Props) {
  const days = Math.max(0, Math.ceil((new Date(graceEndsAt).getTime() - Date.now()) / 86400000))
  return (
    <div className="bg-red-50 border-b border-red-200 px-4 py-2 flex items-center justify-between text-sm">
      <span className="text-red-800">⚠️ Payment failed — {days} day{days !== 1 ? 's' : ''} to update billing before access is suspended</span>
      <button onClick={onUpdate} className="text-red-900 font-medium underline ml-4">Update payment →</button>
    </div>
  )
}
```

- [ ] **Step 3: Create PaywallPage.tsx**
```tsx
// apps/web/src/components/PaywallPage.tsx
import { Button } from '@/components/ui/button'

const PLANS = [
  { id: 2, name: 'Starter', price: '₹2,999', features: ['34 leads/day', '2 seats', 'CSV export'] },
  { id: 3, name: 'Growth',  price: '₹6,999', features: ['68 leads/day', '5 seats', 'Bulk retry'] },
  { id: 4, name: 'Agency',  price: '₹14,999', features: ['Unlimited leads', '10 seats', 'API access'] },
]

interface Props { onSelectPlan: (planId: number) => void }

export function PaywallPage({ onSelectPlan }: Props) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-2">Your trial has ended</h1>
      <p className="text-gray-500 mb-10">Choose a plan to keep your outreach running</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-4xl">
        {PLANS.map(plan => (
          <div key={plan.id} className="bg-white rounded-xl shadow p-6 space-y-4">
            <div><h2 className="text-xl font-bold">{plan.name}</h2><p className="text-2xl font-bold text-gray-900 mt-1">{plan.price}<span className="text-sm font-normal text-gray-500">/mo</span></p></div>
            <ul className="space-y-2">{plan.features.map(f => <li key={f} className="text-sm text-gray-600">✓ {f}</li>)}</ul>
            <Button className="w-full" onClick={() => onSelectPlan(plan.id)}>Get {plan.name}</Button>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Wire banners into App.tsx layout**

In the main layout wrapper in App.tsx:
```tsx
// Add billing status query + conditionally render TrialBanner/GraceBanner/PaywallPage
// based on subscription status returned by /api/billing/portal
```

- [ ] **Step 5: Commit**
```bash
git add apps/web/src/components/
git commit -m "feat(web): TrialBanner + GraceBanner + PaywallPage components"
```

---

### Task 19: Settings pages (Team + Billing)

**Files:**
- Create: `apps/web/src/pages/settings/Team.tsx`
- Create: `apps/web/src/pages/settings/Billing.tsx`

- [ ] **Step 1: Create Team.tsx (invite + manage members)**
```tsx
// apps/web/src/pages/settings/Team.tsx
// - Shows current org members with roles
// - "Invite member" button — enters email + role, calls inviteMember GraphQL mutation
// - Remove member button (owner only, cannot remove self)
// - Shows seat usage vs plan limit
```
Implement with urql `useMutation` for invite + remove.

- [ ] **Step 2: Create Billing.tsx (plan + usage)**
```tsx
// apps/web/src/pages/settings/Billing.tsx
// - Shows current plan name, price, next billing date
// - Usage progress bars: leads today, Claude spend, Gemini queries, seats
// - "Upgrade" button → calls createCheckout mutation → redirects to Razorpay
// - "Cancel subscription" with confirmation dialog
// - billingStatusChanged subscription for instant plan activation
```

- [ ] **Step 3: Add settings routes to App.tsx**
```tsx
<Route path="/settings/team"    element={<ProtectedRoute><Team /></ProtectedRoute>} />
<Route path="/settings/billing" element={<ProtectedRoute><Billing /></ProtectedRoute>} />
```

- [ ] **Step 4: Commit**
```bash
git add apps/web/src/pages/settings/
git commit -m "feat(web): Team + Billing settings pages with live subscription status"
```

---

### Task 20: Superadmin frontend

**Files:**
- Create: `apps/web/src/pages/superadmin/Orgs.tsx`
- Create: `apps/web/src/pages/superadmin/OrgDetail.tsx`

- [ ] **Step 1: Create Orgs.tsx (all orgs table)**
```tsx
// apps/web/src/pages/superadmin/Orgs.tsx
// - Table of all orgs: name, plan badge, status, MRR, leads today, seats used
// - Filter by status (active/trial/locked/suspended)
// - Click row → navigate to /superadmin/orgs/:id
// - "New org" button → adminCreateOrg mutation
```

- [ ] **Step 2: Create OrgDetail.tsx (single org)**
```tsx
// apps/web/src/pages/superadmin/OrgDetail.tsx
// - Org details + member list
// - Plan override dropdown → adminOverridePlan mutation
// - Suspend / reset trial / delete buttons
// - "Impersonate" button → adminImpersonate mutation → store returned token → redirect to /dashboard
```

- [ ] **Step 3: Add superadmin route guard**
```tsx
// ProtectedSuperadminRoute — checks isSuperadmin from JWT, redirects otherwise
```

- [ ] **Step 4: Commit**
```bash
git add apps/web/src/pages/superadmin/
git commit -m "feat(web): superadmin org management pages"
```

---

## Final Tasks

### Task 21: PM2 ecosystem update

**Files:**
- Modify: `infra/ecosystem.config.js`

- [ ] **Step 1: Update PM2 config to include workers**
```javascript
// infra/ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'radar-api',
      script: 'apps/api/dist/server.js',
      env: { NODE_ENV: 'production' },
    },
    {
      name: 'radar-workers',
      script: 'apps/api/dist/workers/scheduler.js',
      env: { NODE_ENV: 'production' },
    },
    {
      name: 'radar-web',
      script: 'npx',
      args: 'serve apps/web/dist -p 5173',
    },
  ],
}
```

- [ ] **Step 2: Commit**
```bash
git add infra/ecosystem.config.js
git commit -m "chore(infra): update PM2 config for monorepo + workers process"
```

---

### Task 22: Full integration smoke test

- [ ] **Step 1: Start all services**
```bash
docker compose -f infra/docker-compose.yml up -d
npx prisma migrate deploy
cd apps/api && npx tsx src/server.ts &
cd apps/web && npm run dev &
```

- [ ] **Step 2: Test auth flows**
- Navigate to `http://localhost:5173/login`
- Verify Google OAuth redirects correctly
- Verify OTP send + verify flow
- Verify HttpOnly cookie is set (check DevTools → Application → Cookies)

- [ ] **Step 3: Test plan enforcement**
- Log in as a trial user
- Verify trial banner appears when daysLeft ≤ 8
- Expire trial manually in DB: `UPDATE org_subscriptions SET trial_ends_at = NOW() - INTERVAL '1 day' WHERE org_id = 1`
- Verify paywall page appears

- [ ] **Step 4: Test Razorpay webhook (local)**
```bash
# Use Razorpay webhook simulator or ngrok
# POST a subscription.activated event to /api/billing/webhook
# Verify org status changes to 'active'
```

- [ ] **Step 5: Test BullMQ**
- Navigate to `http://localhost:3001/admin/queues` (requires superadmin JWT)
- Manually add a job to findLeads queue
- Verify worker picks it up and writes to cron_log

- [ ] **Step 6: Final commit**
```bash
git add .
git commit -m "chore: final integration wiring — productization complete"
```

---

## Tech Stack Summary (as built)

| Layer | Technology |
|---|---|
| Language | TypeScript 5.4 strict |
| Monorepo | pnpm workspaces |
| API | Express 4 + graphql-yoga (Pothos) |
| Real-time | graphql-ws WebSocket subscriptions |
| Job queue | BullMQ + ioredis |
| Auth | Google OAuth (passport) + Email OTP (nodemailer + bcrypt) |
| Session | HttpOnly cookie JWT + Redis blocklist |
| ORM | Prisma 5 + $extends scoped client |
| Database | PostgreSQL 16 |
| Payments | Razorpay subscriptions |
| Frontend | React 18 + Vite + TypeScript |
| UI | shadcn/ui + Tailwind CSS |
| GraphQL client | urql + TanStack Query |
| Logging | Pino |
| Validation | Zod |
| Testing | Vitest |
| Local dev | Docker Compose (postgres + redis) |
| Production | PM2 (api + workers + web) |
