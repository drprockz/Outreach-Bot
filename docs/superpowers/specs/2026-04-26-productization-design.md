# Radar — Production-Grade SaaS Productization Design

**Date:** 2026-04-26
**Author:** Darshan Parmar (Simple Inc)
**Status:** Approved

---

## 1. Overview

Transform Radar from a single-tenant personal tool into a production-grade multi-tenant SaaS with organizations, RBAC, superadmin, pricing plans, billing, and real-time updates.

**Approach chosen:** Row-level multi-tenancy + custom auth (Google OAuth + Email OTP) + Razorpay subscriptions + GraphQL (Pothos + graphql-yoga) + BullMQ job queue.

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
| ORM | Prisma (keep) |
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
| Workspace manager | pnpm workspaces |
| Structure | `apps/api` + `apps/web` + `packages/shared` |
| Shared package | Prisma-generated types, GraphQL codegen types |

### New infrastructure
| | |
|---|---|
| Redis | Required by BullMQ |
| Bull Board | BullMQ UI at `/admin/queues` |
| Docker Compose | Local dev: postgres + redis |

---

## 4. Data Model

### New Prisma models

```prisma
model Org {
  id          Int      @id @default(autoincrement())
  name        String
  slug        String   @unique
  status      String   @default("trial")  // trial | active | locked | suspended
  createdAt   DateTime @default(now())

  memberships OrgMembership[]
  subscription OrgSubscription?
  // all existing models reference this via orgId
}

model User {
  id            Int      @id @default(autoincrement())
  email         String   @unique
  googleId      String?  @unique @map("google_id")
  isSuperadmin  Boolean  @default(false) @map("is_superadmin")
  createdAt     DateTime @default(now())

  memberships   OrgMembership[]
  otpTokens     OtpToken[]
}

model OrgMembership {
  id     Int    @id @default(autoincrement())
  orgId  Int    @map("org_id")
  userId Int    @map("user_id")
  role   String // owner | admin

  org  Org  @relation(fields: [orgId], references: [id])
  user User @relation(fields: [userId], references: [id])

  @@unique([orgId, userId])
}

model OtpToken {
  id        Int      @id @default(autoincrement())
  userId    Int      @map("user_id")
  codeHash  String   @map("code_hash")  // bcrypt hash of 6-digit code
  expiresAt DateTime @map("expires_at")
  used      Boolean  @default(false)

  user User @relation(fields: [userId], references: [id])
}

model Plan {
  id         Int    @id @default(autoincrement())
  name       String // Trial | Starter | Growth | Agency
  priceInr   Int    @map("price_inr")  // 0 | 2999 | 6999 | 14999
  limitsJson Json   @map("limits_json")
  // {
  //   "leadsPerDay": 34,
  //   "seats": 2,
  //   "workspaces": 1,
  //   "bulkRetryEnabled": true,
  //   "exportEnabled": true,
  //   "apiAccess": false
  // }

  subscriptions OrgSubscription[]
}

model OrgSubscription {
  id                Int       @id @default(autoincrement())
  orgId             Int       @unique @map("org_id")
  planId            Int       @map("plan_id")
  status            String    // trial | active | locked | cancelled
  razorpaySubId     String?   @map("razorpay_sub_id")
  razorpayCustomerId String?  @map("razorpay_customer_id")
  trialEndsAt       DateTime? @map("trial_ends_at")
  currentPeriodEnd  DateTime? @map("current_period_end")
  cancelAtPeriodEnd Boolean   @default(false) @map("cancel_at_period_end")
  lastEventId       String?   @map("last_event_id")  // razorpay webhook dedup

  org  Org  @relation(fields: [orgId], references: [id])
  plan Plan @relation(fields: [planId], references: [id])
}
```

### Plan tiers

| Plan | Price | leadsPerDay | seats | workspaces |
|---|---|---|---|---|
| Trial | Free, 14d | 34 | 1 | 1 |
| Starter | ₹2,999/mo | 34 | 2 | 1 |
| Growth | ₹6,999/mo | 68 | 5 | 3 |
| Agency | ₹14,999/mo | unlimited | 10 | unlimited |

### orgId added to all existing models

Every existing model gets `orgId Int @map("org_id")` referencing `Org`:
- `Lead`, `Email`, `Reply`, `Bounce`, `CronLog`, `DailyMetrics`, `ErrorLog`
- `SequenceState`, `Config`, `Niche`, `Offer`, `IcpProfile`, `SavedView`
- `LeadSignal`, `RejectList`

---

## 5. Authentication + RBAC

### Google OAuth flow
```
GET  /auth/google                → redirect to Google consent screen
GET  /auth/google/callback
  → if new user: create User + Org + OrgMembership(owner) + OrgSubscription(trial)
  → if existing user: load membership
  → sign JWT { userId, orgId, role, isSuperadmin, exp: +7d }
  → redirect to /dashboard?token=...
```

### Email OTP flow
```
POST /api/otp/send    { email }
  → upsert User, generate 6-digit code, hash with bcrypt, store OtpToken (5min TTL)
  → send via nodemailer

POST /api/otp/verify  { email, code }
  → find OtpToken, compare hash, check expiry, mark used
  → if new user: create Org + OrgMembership + OrgSubscription(trial)
  → sign JWT, return token
```

### JWT payload
```ts
{
  userId: number,
  orgId: number,
  role: 'owner' | 'admin',
  isSuperadmin: boolean,
  exp: number
}
```

### Middleware stack
| Middleware | Purpose |
|---|---|
| `requireAuth` | Verify JWT, inject `req.user` |
| `requireRole(...roles)` | Guard owner-only mutations |
| `requireSuperadmin` | Guard all `/api/admin/*` and superadmin GraphQL resolvers |
| GraphQL context | `{ user: req.user, prisma, pubsub }` injected into all resolvers |

### Roles
- **Owner** — full access including billing + org deletion, cannot be removed
- **Admin** — manage leads, settings, niches, ICP — no billing access
- **Superadmin** — cross-org access, separate flag not a role, bypasses orgId scoping

---

## 6. Plan Enforcement + Rate Limiting

### Plan limits enforced at 2 layers

**Engine layer:** `findLeads` worker reads `plan.limitsJson.leadsPerDay` for the org from DB. Replaces `DAILY_SEND_LIMIT` env var for multi-tenant use.

**API middleware (GraphQL field-level guards):**
- Seat limit checked on `inviteMember` mutation
- Workspace limit checked on `createOrg` mutation
- `bulkRetryEnabled` flag checked on bulk retry mutations
- `exportEnabled` flag checked on CSV export query

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
→ Day 14: paywall, writes blocked
→ User clicks Upgrade → Razorpay Subscription checkout
→ Payment success → status: active, currentPeriodEnd set
→ Monthly auto-charge
→ Payment failure → 3-day grace → status: locked
→ Cancellation → active until currentPeriodEnd → locked
```

### API endpoints (plain Express — called by Razorpay + frontend)
```
POST /api/billing/create-subscription   → create Razorpay subscription, return checkout URL
POST /api/billing/webhook               → handle Razorpay events (signature verified)
POST /api/billing/cancel                → cancel at period end
POST /api/billing/change-plan           → upgrade/downgrade
GET  /api/billing/portal                → current plan, billing dates, usage
```

### GraphQL billing queries/mutations (for frontend)
```graphql
query BillingStatus { billing { plan status trialDaysLeft currentPeriodEnd usage { leadsToday seatsUsed } } }
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
| `payment.failed` | start 3-day grace, send Telegram + email alert |

**Webhook security:** `X-Razorpay-Signature` verified via `crypto.createHmac('sha256', webhookSecret)`. Replays rejected via stored `lastEventId` on `OrgSubscription`.

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

### Resolver structure
```
apps/api/src/graphql/
  schema.ts              ← Pothos builder instance
  context.ts             ← { user, prisma, pubsub }
  resolvers/
    leads.ts
    emails.ts
    replies.ts
    billing.ts
    orgs.ts
    admin.ts             ← superadmin only
  subscriptions/
    engine.ts
    leads.ts
    replies.ts
    billing.ts
```

---

## 9. Superadmin Panel

### GraphQL superadmin queries/mutations (guarded by requireSuperadmin)
```graphql
# Queries
adminOrgs(filter, page)           → all orgs + plan + usage + status
adminOrg(id)                      → single org detail + billing history
adminUsers(filter)                → all users across orgs
adminMetrics                      → system MRR, active orgs, churn, total API cost

# Mutations
adminCreateOrg(input)             → manually provision org
adminSuspendOrg(orgId)            → status → suspended
adminOverridePlan(orgId, planId)  → bypass billing, assign plan
adminResetTrial(orgId, days)      → extend trial
adminDeleteOrg(orgId, token)      → hard delete with confirmation token
adminImpersonate(orgId)           → returns short-lived scoped JWT (1hr TTL)
```

### Frontend pages (`/superadmin/*`)
| Page | Content |
|---|---|
| `/superadmin/orgs` | Table: plan badge, status, MRR, leads used today, seats |
| `/superadmin/orgs/:id` | Org detail: members, billing history, usage charts, plan override |
| `/superadmin/users` | All users, last login, org membership |
| `/superadmin/metrics` | System KPIs: MRR, active orgs, churn, API cost burn |

**Impersonation safety:** JWTs carry `{ impersonating: true, originalAdminId }`, 1hr TTL, logged to audit trail, cannot impersonate other superadmins.

---

## 10. Frontend Changes

### New pages
```
/login              → "Continue with Google" + "Use email OTP" tab
/otp                → enter 6-digit code
/onboarding         → step 1: org name, step 2: invite team (skippable)
/settings/profile   → name, email, avatar
/settings/team      → invite, change roles, remove members (owner + admin)
/settings/billing   → plan, usage meters, upgrade, cancel (owner only)
/settings/org       → org name, slug, timezone, delete (owner only)
```

### UI components (shadcn/ui)
- Trial banner (sticky top bar when `daysLeft <= 8`)
- Paywall page (status = locked)
- Billing portal with usage progress bars
- Plan upgrade modal with Razorpay checkout redirect

### Real-time wiring (urql subscriptions)
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
After:  node-cron → enqueues BullMQ job → worker processes job
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
2. Runs the same pipeline logic (now TypeScript)
3. Publishes `engineProgress` events to Redis pubsub during execution
4. Writes to `cron_log` on start + completion (unchanged)

### Benefits over node-cron direct execution
- Job survives server restart (persisted in Redis)
- Automatic retries on failure (configurable backoff)
- Bull Board UI shows job history, failures, duration at `/admin/queues`
- Engine progress visible in real-time on dashboard via subscription

---

## 12. Migration Strategy

### 4-step sequence (zero data loss)

**Step 1 — Prisma migration: add nullable orgId to all tables**
All 14 affected tables get `org_id INT REFERENCES orgs(id)` (nullable).

**Step 2 — Seed script (run once on production)**
```ts
// scripts/seed-org1.ts
// 1. INSERT INTO orgs { id:1, name:'Simple Inc', slug:'simpleinc', status:'active' }
// 2. INSERT INTO users { email:'darshan@trysimpleinc.com', isSuperadmin:true }
// 3. INSERT INTO org_memberships { orgId:1, userId:1, role:'owner' }
// 4. INSERT INTO org_subscriptions { orgId:1, planId:4 (Agency), status:'active' }
// 5. UPDATE leads SET org_id=1 WHERE org_id IS NULL  -- and all other tables
```

**Step 3 — Prisma migration: make orgId NOT NULL**
Safe because step 2 backfilled all rows. Wrapped in transaction — rolls back if any null remains.

**Step 4 — Engine files → TypeScript BullMQ workers**
Done incrementally per engine. Old `.js` files removed after each worker is verified.

### Rollback plan
Steps 1–3 are Prisma migrations in a transaction. If step 3 fails, it rolls back automatically. Old app remains functional on the existing DB until migration succeeds.

**Estimated downtime:** ~30 seconds (NOT NULL constraint flip).

---

## 13. Project Structure (post-migration)

```
/
├── apps/
│   ├── api/                    # Express + GraphQL + BullMQ workers
│   │   ├── src/
│   │   │   ├── graphql/        # Pothos schema + resolvers + subscriptions
│   │   │   ├── workers/        # BullMQ workers (one per engine)
│   │   │   ├── webhooks/       # Plain Express: razorpay, google oauth
│   │   │   ├── middleware/     # requireAuth, requireRole, requireSuperadmin, enforcePlan
│   │   │   └── server.ts
│   │   └── package.json
│   └── web/                    # React 18 + Vite + shadcn/ui
│       ├── src/
│       │   ├── pages/          # existing + new auth/settings/superadmin pages
│       │   ├── components/
│       │   └── lib/            # urql client, TanStack Query setup
│       └── package.json
├── packages/
│   └── shared/                 # Prisma client, GraphQL codegen types
│       └── package.json
├── prisma/
│   └── schema.prisma           # single source of truth
├── scripts/
│   └── seed-org1.ts            # one-time migration seed
├── infra/
│   ├── docker-compose.yml      # postgres + redis for local dev
│   └── ecosystem.config.js     # PM2
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

Multi-tenancy adds one new rule: **every Prisma query on a tenant-scoped model MUST include `WHERE org_id = ?`**. The GraphQL context injects `orgId` and resolver-level helpers enforce this. A missing `orgId` filter is treated as a critical bug.
