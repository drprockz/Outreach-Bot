# Multi-Tenant Pipeline Migration Runbook

## When to do this

**Before activating any 2nd customer org.** Until then, the system runs safely with a single tenant (Org 1 = Simple Inc) and the runtime guard in `apps/api/src/lib/multiTenantGuard.ts` will refuse to run engines if a second active org is detected.

## What's wrong today

The 6 engine modules in `src/engines/*.js` are single-tenant:

- They read all configuration from `process.env`:
  - `DAILY_SEND_LIMIT`, `MAX_PER_INBOX`, `SEND_DELAY_MIN_MS`, `SEND_DELAY_MAX_MS`
  - `CLAUDE_DAILY_SPEND_CAP`, `MAX_EMAIL_WORDS`, `MIN_EMAIL_WORDS`
  - `INBOX_1_USER`, `INBOX_2_USER`, `OUTREACH_DOMAIN`
  - `SPAM_WORDS`, `BOUNCE_RATE_HARD_STOP`, `SPAM_RATE_HARD_STOP`
- They use the global `prisma` client (no `org_id` filter)
- All inserts implicitly write `org_id=1` because of the `DEFAULT 1` we added in the migration `20260428153151_add_orgid_defaults`

If a 2nd org becomes active (status='trial' or 'active') without this migration, every lead, email, and reply that engine touches lands under Org 1's data — a hard tenant-isolation breach. The runtime guard prevents this.

## What needs to change

Each engine module must accept an `orgConfig` object and use a scoped Prisma client:

```typescript
// New signature for every engine:
export interface EngineContext {
  orgId: number
  planLimits: PlanLimits
  scopedPrisma: ScopedPrisma  // returned by createScopedPrisma(orgId)
  inboxes: Array<{ user: string; pass: string }>  // org-specific inbox config
  outreachDomain: string  // org-specific domain
}

export default async function findLeads(ctx: EngineContext): Promise<void> {
  // Read all caps from ctx.planLimits, never from process.env
  // Use ctx.scopedPrisma for every DB access
  // Use ctx.inboxes for SMTP credentials
}
```

The worker shells (`apps/api/src/workers/*.worker.ts`) already have the right plumbing — they load the org's plan + scoped client. They just don't pass it to the engine yet.

## Migration plan (in order)

### Phase A — Engine config storage

1. Add `EngineConfig` model to Prisma schema:
   ```prisma
   model EngineConfig {
     id              Int    @id @default(autoincrement())
     orgId           Int    @unique @map("org_id")
     outreachDomain  String @map("outreach_domain")
     dailySendLimit  Int    @default(34) @map("daily_send_limit")
     maxPerInbox     Int    @default(17) @map("max_per_inbox")
     sendDelayMinMs  Int    @default(180000) @map("send_delay_min_ms")
     sendDelayMaxMs  Int    @default(420000) @map("send_delay_max_ms")
     spamWordsJson   Json   @map("spam_words_json")
     // ... etc

     org Org @relation(fields: [orgId], references: [id])
     @@map("engine_configs")
   }

   model OrgInbox {
     id           Int     @id @default(autoincrement())
     orgId        Int     @map("org_id")
     emailAddress String  @map("email_address")
     // App password (Gmail) — encrypted at rest with AES-256
     passwordEnc  String  @map("password_enc")
     position     Int     // 1 or 2 (round-robin order)
     active       Boolean @default(true)

     org Org @relation(fields: [orgId], references: [id])
     @@map("org_inboxes")
   }
   ```

2. Migrate Org 1's existing `.env` config into a `EngineConfig` row + 2 `OrgInbox` rows.

### Phase B — Engine refactor (one engine at a time)

For each of the 6 engines (start with `findLeads.js` since it's the most complex):

1. Convert from JS to TS, move to `apps/api/src/engines/`.
2. Change signature to accept `EngineContext`.
3. Replace every `process.env.X` with `ctx.engineConfig.x` or `ctx.planLimits.x`.
4. Replace every `prisma.lead.create({...})` with `ctx.scopedPrisma.lead.create({...})`. The scoped client auto-injects `orgId`.
5. Replace `getInboxes()` (legacy global) with `ctx.inboxes`.
6. Update tests to mock `EngineContext` instead of `process.env`.

### Phase C — Worker rewiring

In each worker file, replace the dynamic legacy import with the new TS engine:

```typescript
// Before:
const findLeads = (await import('../../../../src/engines/findLeads.js')).default
await findLeads()

// After:
import { findLeads } from '../engines/findLeads.js'  // top of file
const ctx: EngineContext = {
  orgId,
  planLimits: sub.plan.limitsJson as PlanLimits,
  scopedPrisma: createScopedPrisma(orgId),
  inboxes: await loadInboxes(orgId),
  outreachDomain: engineConfig.outreachDomain,
}
await findLeads(ctx)
```

### Phase D — Remove the guard

1. Delete `apps/api/src/lib/multiTenantGuard.ts`
2. Remove `assertSingleActiveOrg(...)` calls from each worker
3. Remove this runbook (or move to `docs/runbooks/archive/`)
4. Drop the DB-level `DEFAULT 1` on `org_id` columns once you're confident every code path passes orgId explicitly:
   ```sql
   -- generated as a Prisma migration
   ALTER TABLE leads ALTER COLUMN org_id DROP DEFAULT;
   -- ... and so on for the other 14 tables
   ```

### Phase E — Onboard the 2nd customer

Once Phases A-D are done:

1. Run `EngineConfig` seeder for the new org (or a UI form in `/settings/inboxes` and `/settings/engine`).
2. Add their inboxes via UI (encrypted at rest).
3. Their org status flips from `trial` to `active` (or stays `trial` for 14 days).
4. The next morning at 09:00 IST, the BullMQ scheduler enqueues `findLeads { orgId: NEW_ORG_ID }`. The worker picks it up, the engine runs scoped to that org's data, no cross-tenant leak.

## Estimated effort

- **Phase A** (schema + seed): 1-2 hours
- **Phase B** (6 engines × ~1-2 hours each): 6-12 hours
- **Phase C** (6 workers): 1-2 hours
- **Phase D** (cleanup): 1 hour
- **Total: ~10-17 hours** of focused work

## Risk areas

- `findLeads.js` calls Gemini grounding free tier (150 queries/day). Per-org quota tracking is non-trivial because the API key is shared. Either:
  - Use one shared paid Gemini API key and track per-org consumption in `DailyMetrics.geminiQueriesUsed`, OR
  - Issue per-org Gemini API keys and let each org bring their own (BYO-key model).
- Bounce rate auto-pause logic currently reads global `daily_metrics`. Must scope to per-org bounce rate post-migration, OR keep a global bounce rate as an additional safety net (recommended).
- The legacy dashboard at port 3001 still reads from `prisma.lead.findMany({})` (no org_id filter). After migration, those queries must filter to `org_id=1` explicitly OR the dashboard must require a session and use the scoped client. Otherwise superadmin staring at the legacy dashboard sees mixed data.

## Verification before flipping the switch

After Phase D, before activating the 2nd org:

1. Create a TEST org with `prisma.org.create({ data: { name: 'Test', slug: 'test', status: 'trial' } })`
2. Manually enqueue a job: `await queues.findLeads.add('findLeads', { orgId: TEST_ORG_ID })`
3. Watch Bull Board (`/admin/queues`) — job should run cleanly with the test org's config
4. Confirm in DB: `SELECT count(*) FROM leads WHERE org_id = TEST_ORG_ID` — should match expected pipeline output
5. Confirm NO Org 1 rows were touched: `SELECT count(*) FROM leads WHERE org_id = 1 AND created_at > NOW() - INTERVAL '5 minutes'`
6. Then delete the test org + its data: `DELETE FROM orgs WHERE slug = 'test'` (CASCADE will clean up)

Only after this verification passes is it safe to flip a real customer org from `trial` to `active`.
