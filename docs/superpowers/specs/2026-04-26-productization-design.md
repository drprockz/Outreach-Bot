# Radar — Production-Grade SaaS Productization Design

**Date:** 2026-04-26
**Author:** Darshan Parmar (Simple Inc)
**Status:** Approved — rev 4 (post spec-review fixes)

---

## 1. Overview

Transform Radar from a single-tenant personal tool into a production-grade multi-tenant SaaS with organizations, RBAC, superadmin, pricing plans, billing, and real-time updates.

**Approach chosen:** Row-level multi-tenancy + custom auth (Google OAuth + Email OTP) + Razorpay subscriptions + GraphQL (Pothos + graphql-yoga) + BullMQ job queue.

**Terminology:** An **Org** is the top-level tenant. There is no separate "Workspace" concept — `Org === Workspace`. Plan limits refer to orgs (e.g. Growth plan allows 3 orgs per account in a future white-label scenario, but for Phase 1 each user account belongs to exactly one org). The word "workspace" is not used in code or UI; use "org" everywhere.

---

## 2. Sub-projects (build in order)

| # | Sub-project | Depends on |
|---|---|---|
| A | Multi-tenancy foundation + data migration | — |
| B | Auth + RBAC (Google OAuth + Email OTP) | A |
| C | Pricing plans + rate limiting + trial enforcement | A, B |
| D | Razorpay billing integration + webhooks | C |
| E | Superadmin panel | A, B, C, D |
| F | Frontend — auth pages, onboarding, settings, billing portal | B, C, D |
| G | Engine migration to TypeScript + BullMQ workers | A |

---

## 3. Tech Stack

### Backend
| Layer | Choice |
|---|---|
| Language | TypeScript (strict mode) |
| API | GraphQL via graphql-yoga + Pothos (code-first, type-safe schema) |
| Real-time | GraphQL subscriptions via `graphql-ws` |
| Job queue | BullMQ + Redis (replaces node-cron direct invocation) |
| ORM | Prisma (keep) + `$extends` org-scoping extension |
| Database | PostgreSQL (keep) |
| Logging | Pino (structured JSON) |
| Validation | Zod (built into Pothos resolvers) |
| Auth | passport + passport-google-oauth20 |
| Payments | razorpay (official SDK) |
| External routes | Plain Express (Razorpay webhooks, Google OAuth callback) |

### Frontend
| Layer | Choice |
|---|---|
| Framework | React 18 + Vite (keep) |
| Language | TypeScript |
| Routing | React Router v6 (keep) |
| Data fetching | TanStack Query + urql (GraphQL client) |
| UI components | shadcn/ui + Tailwind CSS |
| Real-time | urql subscriptions over `graphql-ws` |

### Monorepo
| | |
|---|---|
| Workspace manager | npm workspaces |
| Structure | `apps/api` + `apps/web` + `packages/shared` |
| Shared package | Prisma-generated types, GraphQL codegen types |

### New infrastructure
| | |
|---|---|
| Redis | Required by BullMQ + JWT revocation blocklist + pubsub |
| Bull Board | BullMQ UI at `/admin/queues` (guarded by `requireSuperadmin`) |
| Docker Compose | Local dev: postgres + redis |

### New environment variables (add to `.env.example`)
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

---

## 4. Data Model

### New Prisma models

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

model Org {
  id          Int       @id @default(autoincrement())
  name        String
  slug        String    @unique
  status      OrgStatus @default(trial)
  createdAt   DateTime  @default(now()) @db.Timestamptz(6) @map("created_at")

  memberships  OrgMembership[]
  subscription OrgSubscription?
}

model User {
  id            Int      @id @default(autoincrement())
  email         String   @unique
  googleId      String?  @unique @map("google_id")
  isSuperadmin  Boolean  @default(false) @map("is_superadmin")
  lastLoginAt   DateTime? @db.Timestamptz(6) @map("last_login_at")
  createdAt     DateTime @default(now()) @db.Timestamptz(6) @map("created_at")

  memberships   OrgMembership[]
  otpTokens     OtpToken[]
}

model OrgMembership {
  id     Int    @id @default(autoincrement())
  orgId  Int    @map("org_id")
  userId Int    @map("user_id")
  role   Role   // owner | admin

  org  Org  @relation(fields: [orgId], references: [id])
  user User @relation(fields: [userId], references: [id])

  @@unique([orgId, userId])
}

model OtpToken {
  id        Int      @id @default(autoincrement())
  userId    Int      @map("user_id")
  codeHash  String   @map("code_hash")   // bcrypt hash of 6-digit code
  expiresAt DateTime @map("expires_at")
  used      Boolean  @default(false)
  attempts  Int      @default(0)         // lock after 5 failed attempts (attempts >= 5)

  user User @relation(fields: [userId], references: [id])

  @@index([userId, used, expiresAt])     // compound index for verify lookup + cleanup
}

model Plan {
  id         Int    @id @default(autoincrement())
  name       String // Trial | Starter | Growth | Agency
  priceInr   Int    @map("price_inr")   // 0 | 2999 | 6999 | 14999
  limitsJson Json   @map("limits_json")
  // {
  //   "leadsPerDay": 34,           // -1 = unlimited
  //   "seats": 2,                  // -1 = unlimited
  //   "claudeDailySpendCapUsd": 3, // per-org AI spend cap
  //   "geminiQueriesPerDay": 150,  // per-org Gemini discovery quota
  //   "bulkRetryEnabled": true,
  //   "exportEnabled": true,
  //   "apiAccess": false
  // }

  subscriptions OrgSubscription[]
}

model OrgSubscription {
  id                 Int                @id @default(autoincrement())
  orgId              Int                @unique @map("org_id")
  planId             Int                @map("plan_id")
  status             SubscriptionStatus @default(trial)
  razorpaySubId      String?   @map("razorpay_sub_id")
  razorpayCustomerId String?   @map("razorpay_customer_id")
  trialEndsAt        DateTime? @db.Timestamptz(6) @map("trial_ends_at")
  currentPeriodEnd   DateTime? @db.Timestamptz(6) @map("current_period_end")
  graceEndsAt        DateTime? @db.Timestamptz(6) @map("grace_ends_at")
  cancelAtPeriodEnd  Boolean   @default(false) @map("cancel_at_period_end")

  org  Org  @relation(fields: [orgId], references: [id])
  plan Plan @relation(fields: [planId], references: [id])

  webhookEvents RazorpayWebhookEvent[]
}

// Replaces single lastEventId field — full idempotency log
model RazorpayWebhookEvent {
  id             Int      @id @default(autoincrement())
  razorpayEventId String  @unique @map("razorpay_event_id")
  eventType      String   @map("event_type")
  orgSubId       Int      @map("org_sub_id")
  processedAt    DateTime @default(now()) @db.Timestamptz(6) @map("processed_at")

  orgSub OrgSubscription @relation(fields: [orgSubId], references: [id])

  // @@index([razorpayEventId]) — omitted: @unique above already creates the index
}
```

### Plan tiers

| Plan | Price | leadsPerDay | seats | claudeDailySpendCapUsd | geminiQueriesPerDay |
|---|---|---|---|---|---|
| Trial | Free, 14d | 34 | 1 | $1.00 | 150 |
| Starter | ₹2,999/mo | 34 | 2 | $3.00 | 150 |
| Growth | ₹6,999/mo | 68 | 5 | $6.00 | 300 |
| Agency | ₹14,999/mo | -1 (unlimited) | 10 | $12.00 | 600 |

### orgId added to all existing models

Every existing model gets `orgId Int @map("org_id")` referencing `Org`:
- `Lead`, `Email`, `Reply`, `Bounce`, `CronLog`, `DailyMetrics`, `ErrorLog`
- `SequenceState`, `Config`, `Niche`, `Offer`, `IcpProfile`, `SavedView`
- `LeadSignal`, `RejectList`

### Prisma org-scoping extension (enforces multi-tenancy automatically)

A Prisma `$extends` client extension is created in `packages/shared/src/prismaClient.ts`. It wraps all `findMany`, `findFirst`, `findUnique`, `update`, `updateMany`, `delete`, `deleteMany` operations on tenant-scoped models to automatically inject `where: { orgId }` from context. All resolvers use this scoped client, not the raw PrismaClient. A raw PrismaClient (unscoped) is available only to superadmin resolvers and migration scripts.

```ts
// packages/shared/src/prismaClient.ts
export function createScopedPrisma(orgId: number) {
  return prisma.$extends({
    query: {
      lead: { findMany: addOrgFilter(orgId), /* ... */ },
      email: { findMany: addOrgFilter(orgId), /* ... */ },
      // ... all 14 tenant-scoped models
    }
  })
}
```

A missing `orgId` filter is a compile-time error when using the scoped client — not a runtime risk.

---

## 5. Authentication + RBAC

### Google OAuth flow

Token is delivered via `HttpOnly` cookie, NOT a URL query parameter (prevents JWT exposure in browser history, Nginx logs, and Referer headers).

```
GET  /auth/google                → redirect to Google consent screen
GET  /auth/google/callback
  → if new user: create User + Org + OrgMembership(owner) + OrgSubscription(trial)
  → if existing user: load membership, update lastLoginAt
  → sign JWT { jti: uuid, userId, orgId, role, isSuperadmin, iat: <unix>, exp: +7d }
  → Set-Cookie: token=<jwt>; HttpOnly; Secure; SameSite=Lax; Path=/
  → redirect to /dashboard  (no token in URL)
  → Note: OAuth cannot return JSON body. Frontend gets JWT for WebSocket via
    GET /api/auth/token (reads HttpOnly cookie, returns { token } JSON — auth-required)
```

### Email OTP flow

```
POST /api/otp/send    { email }
  → IP-based rate limit: 10 requests / 15 min (express-rate-limit, keyed by IP)
  → upsert User, generate 6-digit code, bcrypt-hash, store OtpToken (5min TTL, attempts=0)
  → send via nodemailer

POST /api/otp/verify  { email, code }
  → IP-based rate limit: 10 requests / 15 min
  → find OtpToken, check expiry, check used=false
  → compare bcrypt hash
  → if mismatch: increment attempts; if attempts >= 5: mark used=true, reject 429; else reject 401
  → if match: mark used=true, delete all expired/used OtpTokens for this userId (cleanup)
  → if new user: create Org + OrgMembership + OrgSubscription(trial)
  → sign JWT { jti: uuid, userId, orgId, role, isSuperadmin, iat: <unix>, exp: +7d }
  → Set-Cookie: token=<jwt>; HttpOnly; Secure; SameSite=Lax; Path=/
  → also return { token: <jwt> } in JSON body (for in-memory use by WebSocket connectionParams)
```

### JWT payload
```ts
{
  jti: string,          // uuid v4 — used for revocation
  userId: number,
  orgId: number,
  role: 'owner' | 'admin',
  isSuperadmin: boolean,
  iat: number,          // unix timestamp — used for per-org revokedBefore check
  exp: number
}
```

### JWT revocation (Redis blocklist)

Redis is already in the stack (BullMQ). A `jti` blocklist is maintained in Redis with TTL matching the JWT expiry:

```ts
// On logout / org deletion / impersonation end / account suspension:
await redis.set(`jwt:revoked:${jti}`, '1', 'EX', secondsUntilExpiry)

// In requireAuth middleware:
const revoked = await redis.get(`jwt:revoked:${jti}`)
if (revoked) return res.status(401).json({ error: 'Token revoked' })
```

`adminDeleteOrg` invalidates all active JWTs for that org by storing a per-org revocation timestamp:
```ts
await redis.set(`jwt:org:${orgId}:revokedBefore`, Date.now(), 'EX', 7 * 86400)
// requireAuth checks: if token.iat < revokedBefore → reject
```

### GraphQL WebSocket auth (`graphql-ws`)

The `requireAuth` Express middleware does not run on WebSocket upgrades. The `graphql-ws` server's `onConnect` handler validates the token from `connectionParams`:

```ts
// apps/api/src/graphql/wsServer.ts
const wsServer = useServer({
  schema,
  onConnect: async (ctx) => {
    const token = ctx.connectionParams?.authToken as string
    if (!token) throw new Error('Unauthorized')
    const user = await verifyJwt(token)  // same as requireAuth, checks Redis blocklist
    if (!user) throw new Error('Unauthorized')
    return { user }  // injected into subscription context
  },
  context: (ctx) => ({ user: ctx.extra.user, prisma: createScopedPrisma(ctx.extra.user.orgId), pubsub }),
}, wsHttpServer)
```

Unauthenticated WebSocket connections are rejected with close code `4401`.

### Middleware stack
| Middleware | Purpose |
|---|---|
| `requireAuth` | Verify JWT (cookie or Bearer), check Redis blocklist, inject `req.user` |
| `requireRole(...roles)` | Guard owner-only mutations |
| `requireSuperadmin` | Guard all superadmin GraphQL resolvers + Bull Board |
| `orgRateLimit` | express-rate-limit keyed by orgId, limits by plan tier |
| `otpRateLimit` | express-rate-limit keyed by IP, 10 req/15min, for OTP endpoints only |
| GraphQL context | `{ user, prisma: createScopedPrisma(orgId), pubsub }` |

### Roles
- **Owner** — full access including billing + org deletion, cannot be removed
- **Admin** — manage leads, settings, niches, ICP — no billing access
- **Superadmin** — cross-org access, `isSuperadmin` flag on User, bypasses orgId scoping, uses raw PrismaClient

---

## 6. Plan Enforcement + Rate Limiting

### Plan limits enforced at 2 layers

**Engine layer:** `findLeads` worker reads `plan.limitsJson` for the org from DB:
- `leadsPerDay` replaces `DAILY_SEND_LIMIT` env var
- `claudeDailySpendCapUsd` replaces `CLAUDE_DAILY_SPEND_CAP` env var — `checkSpendCap(orgId)` queries `DailyMetrics WHERE orgId = ? AND date = today()`
- `geminiQueriesPerDay` caps Gemini grounding calls per org per day, tracked in `DailyMetrics.geminiDiscoveryQueries`

**API middleware (GraphQL field-level guards):**
- Seat limit checked on `inviteMember` mutation
- `bulkRetryEnabled` flag checked on bulk retry mutations
- `exportEnabled` flag checked on CSV export query

### Multi-org AI quota management

The Gemini free tier cap (150 queries/day) was global in single-tenant mode. In multi-tenant mode:
- Each org has its own `geminiQueriesPerDay` quota tracked in `DailyMetrics`
- Trial and Starter orgs: 150 queries/day each (requires paid Gemini API key once >1 active org exists, since free tier is 1,500/day total — safe up to ~10 orgs)
- Growth: 300/day, Agency: 600/day — these require the paid Gemini API
- The `findLeads` worker checks remaining quota before each discovery batch and halts gracefully if exhausted (logs to `cron_log`, sends Telegram alert, does not hard-crash)
- `GEMINI_API_KEY` must be a paid key once more than 1 active org exists

### API rate limiting (express-rate-limit, keyed by orgId)
| Plan | Requests/minute |
|---|---|
| Trial | 30 |
| Starter | 60 |
| Growth | 120 |
| Agency | 300 |

### Trial expiry
- Daily cron at midnight checks `OrgSubscription.trialEndsAt`
- Expired orgs → `status: locked`
- Locked orgs: all write mutations return `PAYMENT_REQUIRED` error, reads still work
- Trial banner shown when `daysLeft <= 8`

---

## 7. Razorpay Billing

### Subscription lifecycle
```
Signup → Trial (14 days, no card required)
→ Day 14: paywall, writes blocked (status: locked)
→ User clicks Upgrade → Razorpay Subscription checkout
→ Payment success → status: active, currentPeriodEnd set
→ Monthly auto-charge
→ Payment failure → grace period 3 days (status: grace) → status: locked
→ Cancellation → active until currentPeriodEnd → status: locked
```

### API endpoints (plain Express — called by Razorpay + frontend)
```
POST /api/billing/create-subscription   → create Razorpay subscription, return checkout URL
POST /api/billing/webhook               → handle Razorpay events (no auth, HMAC verified)
POST /api/billing/cancel                → cancel at period end
POST /api/billing/change-plan           → upgrade/downgrade
GET  /api/billing/portal                → current plan, billing dates, usage
```

### GraphQL billing queries/mutations (for frontend)
```graphql
query BillingStatus {
  billing { plan status trialDaysLeft currentPeriodEnd graceEndsAt
    usage { leadsToday seatsUsed claudeSpendUsd geminiQueriesUsed } }
}
mutation CreateCheckout($planId: ID!) { createCheckout(planId: $planId) { checkoutUrl } }
mutation CancelSubscription { cancelSubscription { cancelAtPeriodEnd } }
```

### Webhook events handled
| Event | Action |
|---|---|
| `subscription.activated` | status → active, store razorpaySubId |
| `subscription.charged` | extend currentPeriodEnd, log payment |
| `subscription.cancelled` | set cancelAtPeriodEnd = true |
| `subscription.completed` | status → locked |
| `payment.failed` | status → grace, graceEndsAt = now+3d, send Telegram + email alert |

### Webhook security + idempotency

- `X-Razorpay-Signature` verified via `crypto.createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)` before any processing
- Each webhook event is upserted into `RazorpayWebhookEvent` using `razorpayEventId` as unique key — duplicate deliveries are silently no-ops
- The webhook handler is fully idempotent: re-processing the same event produces the same DB state

---

## 8. GraphQL Schema (Pothos, code-first)

### Key types
```ts
// Pothos builder with Prisma plugin
const Lead = builder.prismaObject('Lead', { ... })
const Org  = builder.prismaObject('Org', { ... })
const User = builder.prismaObject('User', { ... })
```

### Subscriptions (real-time via graphql-ws + Redis pubsub)
| Subscription | Payload | Where used |
|---|---|---|
| `engineProgress` | `{ jobName, stage, count, total }` | Cron Status page — live progress bar |
| `newLead` | `Lead` | Lead Pipeline — new row appears without refresh |
| `newReply` | `Reply` | Reply Feed — toast + live row |
| `billingStatusChanged` | `{ status, plan }` | Billing page — instant activation after payment |

All subscriptions are scoped to `orgId` from the WebSocket context — subscribers only receive events for their own org.

### Resolver structure
```
apps/api/src/graphql/
  schema.ts              ← Pothos builder instance
  context.ts             ← { user, prisma: ScopedPrisma, pubsub }
  resolvers/
    leads.ts
    emails.ts
    replies.ts
    billing.ts
    orgs.ts
    admin.ts             ← superadmin only, uses raw PrismaClient
  subscriptions/
    engine.ts
    leads.ts
    replies.ts
    billing.ts
```

---

## 9. Superadmin Panel

### GraphQL superadmin queries/mutations (guarded by `requireSuperadmin`, use raw PrismaClient)
```graphql
# Queries
adminOrgs(filter, page)           → all orgs + plan + usage + status
adminOrg(id)                      → single org detail + billing history
adminUsers(filter)                → all users across orgs
adminMetrics                      → system MRR, active orgs, churn, total API cost

# Mutations
adminCreateOrg(input)             → manually provision org
adminSuspendOrg(orgId)            → status → suspended, revoke all org JWTs
adminOverridePlan(orgId, planId)  → bypass billing, assign plan
adminResetTrial(orgId, days)      → extend trial
adminDeleteOrg(orgId, token)      → hard delete with confirmation token, revoke all org JWTs
adminImpersonate(orgId)           → returns 1hr scoped JWT (stored in Redis for revocation)
```

### Impersonation safety
- Impersonation JWTs carry `{ impersonating: true, originalAdminId, jti }`, 1hr TTL
- `jti` stored in Redis: `jwt:impersonation:${jti}` with 1hr TTL (explicit revocable)
- Logged to `AuditLog` table: `{ action: 'impersonate', actorId, targetOrgId, issuedAt }`
- Cannot impersonate another superadmin
- `adminSuspendOrg` and `adminDeleteOrg` call the JWT org-revocation mechanism

### AuditLog model (new)
```prisma
model AuditLog {
  id        Int      @id @default(autoincrement())
  action    String   // impersonate | suspend | delete | override_plan | reset_trial
  actorId   Int      @map("actor_id")
  targetOrgId Int?   @map("target_org_id")
  meta      Json?
  createdAt DateTime @default(now()) @db.Timestamptz(6) @map("created_at")

  @@index([actorId])
  @@index([targetOrgId])
  @@map("audit_log")
}
```

### Frontend pages (`/superadmin/*`)
| Page | Content |
|---|---|
| `/superadmin/orgs` | Table: plan badge, status, MRR, leads used today, seats |
| `/superadmin/orgs/:id` | Org detail: members, billing history, usage charts, plan override |
| `/superadmin/users` | All users, last login, org membership |
| `/superadmin/metrics` | System KPIs: MRR, active orgs, churn, API cost burn |
| `/admin/queues` | Bull Board (BullMQ job dashboard) — guarded by `requireSuperadmin` |

---

## 10. Frontend Changes

### New pages
```
/login              → "Continue with Google" button + "Use email OTP" tab
/otp                → enter 6-digit code sent to email
/onboarding         → step 1: org name, step 2: invite team (skippable)
/settings/profile   → name, email, avatar
/settings/team      → invite, change roles, remove members (owner + admin)
/settings/billing   → plan, usage meters, upgrade, cancel (owner only)
/settings/org       → org name, slug, timezone, delete (owner only)
```

### UI components (shadcn/ui)
- Trial banner (sticky top bar when `daysLeft <= 8`)
- Grace period banner (payment failed, X days to resolve)
- Paywall page (status = locked)
- Billing portal with usage progress bars (leads, Claude spend, Gemini queries, seats)
- Plan upgrade modal with Razorpay checkout redirect

### Real-time wiring (urql subscriptions, auth via `connectionParams.authToken`)
| Component | Subscription |
|---|---|
| Cron Status page | `engineProgress` → live stage progress bar |
| Lead Pipeline | `newLead` → row appears without refresh |
| Reply Feed | `newReply` → toast + live row prepend |
| Billing page | `billingStatusChanged` → instant plan activation |

---

## 11. Engine Migration to BullMQ

### Architecture change
```
Before: node-cron → fires engine function directly at scheduled time
After:  node-cron → enqueues BullMQ job { orgId } → worker processes job
```

### Worker structure
```
apps/api/src/workers/
  findLeads.worker.ts
  sendEmails.worker.ts
  sendFollowups.worker.ts
  checkReplies.worker.ts
  dailyReport.worker.ts
  healthCheck.worker.ts
```

Each worker:
1. Receives `{ orgId }` in job data
2. Loads org's plan limits from DB (`claudeDailySpendCapUsd`, `leadsPerDay`, `geminiQueriesPerDay`)
3. Checks per-org Gemini quota before discovery — halts gracefully if exhausted
4. Uses `createScopedPrisma(orgId)` — never raw PrismaClient
5. Calls `checkSpendCap(orgId)` — org-scoped, not global
6. Publishes `engineProgress` events to Redis pubsub (scoped by `orgId`)
7. Writes to `cron_log` on start + completion (unchanged)

### Benefits over node-cron direct execution
- Job survives server restart (persisted in Redis)
- Automatic retries on failure (configurable backoff)
- Bull Board UI shows job history, failures, duration
- Engine progress visible in real-time on dashboard via subscription

---

## 12. Migration Strategy

### 3-step sequence (zero data loss)

**Step 1 — Prisma migration: add nullable `orgId` to all tables**

All 14 affected tables get `org_id INT REFERENCES orgs(id)` (nullable). This migration is safe to run against the live DB with zero downtime — adding a nullable column does not lock tables in PostgreSQL.

**Step 2 — Combined migration: seed Org 1 + backfill + make NOT NULL**

Steps 2 and 3 from the original design are merged into a single Prisma `--create-only` custom SQL migration that runs atomically in one transaction:

```sql
-- migration: 20260426_seed_org1_and_enforce_not_null.sql
BEGIN;

-- Seed Org 1
-- IMPORTANT: set OWNER_EMAIL to the Google/OTP login email (NOT the outreach inbox).
-- Using the outreach address (darshan@trysimpleinc.com) as the login email will
-- create a duplicate User row on first OAuth login, leaving the superadmin flag orphaned.
-- Use the personal Gmail or a simpleinc.in address that will be used to log in.
INSERT INTO orgs (id, name, slug, status, created_at)
  VALUES (1, 'Simple Inc', 'simpleinc', 'active', NOW())
  ON CONFLICT DO NOTHING;

INSERT INTO users (id, email, is_superadmin, created_at)
  VALUES (1, :'OWNER_EMAIL', true, NOW())   -- pass via: psql -v OWNER_EMAIL=your@email.com
  ON CONFLICT DO NOTHING;

INSERT INTO org_memberships (org_id, user_id, role)
  VALUES (1, 1, 'owner')
  ON CONFLICT DO NOTHING;

INSERT INTO plans (id, name, price_inr, limits_json)
  VALUES (4, 'Agency', 14999, '{"leadsPerDay":-1,"seats":10,"claudeDailySpendCapUsd":12,"geminiQueriesPerDay":600,"bulkRetryEnabled":true,"exportEnabled":true,"apiAccess":false}')
  ON CONFLICT DO NOTHING;

INSERT INTO org_subscriptions (org_id, plan_id, status)
  VALUES (1, 4, 'active')
  ON CONFLICT DO NOTHING;

-- Backfill all tenant tables
UPDATE leads            SET org_id = 1 WHERE org_id IS NULL;
UPDATE emails           SET org_id = 1 WHERE org_id IS NULL;
UPDATE replies          SET org_id = 1 WHERE org_id IS NULL;
UPDATE bounces          SET org_id = 1 WHERE org_id IS NULL;
UPDATE cron_log         SET org_id = 1 WHERE org_id IS NULL;
UPDATE daily_metrics    SET org_id = 1 WHERE org_id IS NULL;
UPDATE error_log        SET org_id = 1 WHERE org_id IS NULL;
UPDATE sequence_state   SET org_id = 1 WHERE org_id IS NULL;
UPDATE config           SET org_id = 1 WHERE org_id IS NULL;
UPDATE niches           SET org_id = 1 WHERE org_id IS NULL;
UPDATE offer            SET org_id = 1 WHERE org_id IS NULL;
UPDATE icp_profile      SET org_id = 1 WHERE org_id IS NULL;
UPDATE saved_views      SET org_id = 1 WHERE org_id IS NULL;
UPDATE lead_signals     SET org_id = 1 WHERE org_id IS NULL;
UPDATE reject_list      SET org_id = 1 WHERE org_id IS NULL;

-- Make NOT NULL (safe: all rows just backfilled in this transaction)
ALTER TABLE leads            ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE emails           ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE replies          ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE bounces          ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE cron_log         ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE daily_metrics    ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE error_log        ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE sequence_state   ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE config            ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE niches           ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE offer            ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE icp_profile      ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE saved_views      ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE lead_signals     ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE reject_list      ALTER COLUMN org_id SET NOT NULL;

COMMIT;
```

If any statement fails, the entire transaction rolls back — no partial state.

**Step 3 — Engine files → TypeScript BullMQ workers**

Done incrementally per engine. Old `.js` files removed after each worker is verified in production.

**Estimated downtime:** ~30 seconds (NOT NULL constraint flip inside transaction).

---

## 13. Project Structure (post-migration)

```
/
├── apps/
│   ├── api/                      # Express + GraphQL + BullMQ workers
│   │   ├── src/
│   │   │   ├── graphql/          # Pothos schema + resolvers + subscriptions
│   │   │   ├── workers/          # BullMQ workers (one per engine)
│   │   │   ├── webhooks/         # Plain Express: razorpay, google oauth callback
│   │   │   ├── middleware/       # requireAuth, requireRole, requireSuperadmin, enforcePlan, rateLimits
│   │   │   └── server.ts
│   │   └── package.json
│   └── web/                      # React 18 + Vite + shadcn/ui
│       ├── src/
│       │   ├── pages/            # existing + new auth/settings/superadmin pages
│       │   ├── components/
│       │   └── lib/              # urql client, TanStack Query, graphql-ws setup
│       └── package.json
├── packages/
│   └── shared/                   # Prisma client + scoped extension, GraphQL codegen types
│       └── package.json
├── prisma/
│   └── schema.prisma             # single source of truth
├── infra/
│   ├── docker-compose.yml        # postgres + redis for local dev
│   └── ecosystem.config.js       # PM2
└── pnpm-workspace.yaml
```

---

## 14. Non-negotiable rules (inherited from CLAUDE.md, still apply)

All existing rules from CLAUDE.md apply unchanged:
- Plain text only emails, no tracking pixels, no links in step 0–1
- Bounce rate >2% = hard stop
- `reject_list` is absolute
- `DAILY_SEND_LIMIT=0` = hard stop
- `cron_log` written at start AND end
- All errors → `error_log`
- From domain MUST be `trysimpleinc.com`

### New multi-tenancy rules

1. **All Prisma queries on tenant-scoped models MUST use `createScopedPrisma(orgId)`** — not raw PrismaClient. The extension enforces this at the type level.
2. **Superadmin resolvers use raw PrismaClient explicitly** — this is intentional and must be clearly marked in code.
3. **`checkSpendCap` is always called with `orgId`** — the global single-row version is deleted.
4. **Gemini quota is tracked per org per day** — a worker that exceeds its org's `geminiQueriesPerDay` must halt and log, not silently continue.
5. **JWT `jti` is always a UUID v4** — required for the Redis blocklist revocation mechanism.
