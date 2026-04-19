# SQLite → PostgreSQL + Prisma Migration — Implementation Plan v2

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `better-sqlite3` with self-hosted PostgreSQL 16 + Prisma ORM across the Radar outreach system, preserving all 14 table schemas (9 pipeline + 3 config + 2 ICP framework) and every existing helper behavior.

**Architecture:** Prisma `schema.prisma` becomes the source of truth. A single `PrismaClient` singleton is exported from `src/core/db/index.js` and reused across PM2 processes. Every engine script, utility module, API route, and script becomes async. No data migration — fresh-start on Postgres.

**Tech Stack:** PostgreSQL 16 (Homebrew on Mac locally, apt on Ubuntu VPS), Prisma ORM, Node.js ESM, Vitest.

**Spec:** [`docs/superpowers/specs/2026-04-17-sqlite-to-postgres-migration-design.md`](../specs/2026-04-17-sqlite-to-postgres-migration-design.md)

**Gap analysis (why v2):** [`docs/superpowers/specs/2026-04-19-postgres-migration-gap-analysis.md`](../specs/2026-04-19-postgres-migration-gap-analysis.md)

---

## What's different from v1 (at-a-glance)

| v1 assumed | v2 corrects |
|---|---|
| Flat root layout (`utils/*.js`, `dashboard/server.js`) | `src/core/`, `src/api/routes/` (16 files), `src/engines/`, `src/scheduler/`, `scripts/` |
| 12 tables | **14 tables** — adds `Offer` + `IcpProfile` singletons |
| 30 Lead fields | **36 Lead fields** — adds 6 ICP v2 columns |
| `icp_threshold_a='7'`, no `icp_weights` config | `icp_threshold_a='70'`, `icp_threshold_b='40'`, plus `icp_weights` JSON |
| Docker container for local Postgres | Homebrew `postgresql@16` (already running locally) |
| Green test baseline | **10 pre-existing failing tests** in sendEmails/sendFollowups — NOT regressions |
| Plan omits ICP v2 files | Adds port tasks for `icpScorer.js`, `offer.js`, `icpProfile.js`, `rescoreLeads.js`, + 16 API route files individually |
| `db.transaction()` sync call in rescoreLeads | Prisma `$transaction` interactive API |
| Single monolithic `dashboard/server.js` | Per-route porting for 16 files (lighter per file) |

---

## Ground Rules

- **Exact file paths always** — every task references the real file under `/Users/drprockz/Projects/Outreach`.
- **Commit after every task** — tiny, reversible commits make rollback trivial.
- **Run the existing Vitest suite** after each engine rewrite — baseline is 146 pass + 10 fail; goal is "no NEW failures" until Chunk 5 when send-engine tests are expected to change.
- **No behavior changes** — this migration is a pure refactor. Rate limits, send windows, content validation, bounce hard-stops, and reject-list semantics all stay byte-identical.
- **Keep `db/radar.sqlite` + `db/schema.sql` untouched** until Chunk 7.
- **No VPS cutover in this plan** — the plan's Phase 2 (VPS deployment) is deferred until user confirms current production host (CLAUDE.md notes "being migrated to personal server"). This plan gets to a **local-green state** and stops.

---

## Local prerequisites (already verified 2026-04-19)

- ✅ `postgresql@16` running via Homebrew (`brew services list` → started)
- ✅ `psql postgres` works with superuser `drprockz`
- ✅ Platform darwin 25.3, Node 20+
- ❌ Docker daemon NOT running — fine, not needed

---

## Chunk 1: Foundation (Prisma + Schema + Test Fixture)

**Commit cadence:** 3 commits — (1.1) deps + env, (1.2) schema + migration, (1.3) test fixture.

### Task 1.1: Install Prisma + create role/DBs + wire `.env`

**Files:**
- Modify: `package.json`, `.env`, `.env.example`

- [ ] **Step 1:** Install Prisma packages (keep `better-sqlite3` — still used until Chunk 7):

```bash
cd /Users/drprockz/Projects/Outreach
npm install @prisma/client
npm install --save-dev prisma
```

- [ ] **Step 2:** Create local Postgres role + databases:

```bash
psql postgres <<SQL
CREATE ROLE radar WITH LOGIN PASSWORD 'radar_dev';
CREATE DATABASE radar OWNER radar;
CREATE DATABASE radar_test OWNER radar;
GRANT ALL PRIVILEGES ON DATABASE radar TO radar;
GRANT ALL PRIVILEGES ON DATABASE radar_test TO radar;
SQL
```

Verify: `psql -U radar -d radar -c "SELECT 1;"` returns 1 row.

- [ ] **Step 3:** Add to `.env` (NOT committed):

```
DATABASE_URL="postgresql://radar:radar_dev@127.0.0.1:5432/radar?schema=public"
DATABASE_URL_TEST="postgresql://radar:radar_dev@127.0.0.1:5432/radar_test?schema=public"
```

**Do NOT remove `DB_PATH`** — still needed until Chunk 7.

- [ ] **Step 4:** Update `.env.example`:

```
DATABASE_URL="postgresql://radar:CHANGE_ME@127.0.0.1:5432/radar?schema=public"
DATABASE_URL_TEST="postgresql://radar:CHANGE_ME@127.0.0.1:5432/radar_test?schema=public"
```

Keep `DB_PATH` line in `.env.example` for now.

- [ ] **Step 5:** Commit:

```bash
git add package.json package-lock.json .env.example
git commit -m "chore(db): install prisma + configure DATABASE_URL for local postgres"
```

### Task 1.2: Author `prisma/schema.prisma` (all 14 tables)

**Files:**
- Create: `prisma/schema.prisma`

- [ ] **Step 1:** Create `prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ────────────────── LEADS ──────────────────
model Lead {
  id                    Int       @id @default(autoincrement())
  discoveredAt          DateTime  @default(now()) @db.Timestamptz(6) @map("discovered_at")

  businessName          String?   @map("business_name")
  websiteUrl            String?   @map("website_url")
  category              String?
  city                  String?
  country               String?   @default("IN")
  searchQuery           String?   @map("search_query")

  techStack             Json?     @map("tech_stack")
  websiteProblems       Json?     @map("website_problems")
  lastUpdated           String?   @map("last_updated")
  hasSsl                Boolean?  @map("has_ssl")
  hasAnalytics          Boolean?  @map("has_analytics")
  ownerName             String?   @map("owner_name")
  ownerRole             String?   @map("owner_role")

  businessSignals       Json?     @map("business_signals")
  socialActive          Boolean?  @map("social_active")

  websiteQualityScore   Int?      @map("website_quality_score")
  judgeReason           String?   @map("judge_reason")
  judgeSkip             Boolean   @default(false) @map("judge_skip")

  icpScore              Int?      @map("icp_score")
  icpPriority           String?   @map("icp_priority")
  icpReason             String?   @map("icp_reason")

  // ICP v2 framework (0-100 score with breakdown) — added by ICP refactor
  icpBreakdown          Json?     @map("icp_breakdown")
  icpKeyMatches         Json?     @map("icp_key_matches")
  icpKeyGaps            Json?     @map("icp_key_gaps")
  icpDisqualifiers      Json?     @map("icp_disqualifiers")
  employeesEstimate     String?   @map("employees_estimate")
  businessStage         String?   @map("business_stage")

  contactName           String?   @map("contact_name")
  contactEmail          String?   @map("contact_email")
  contactConfidence     String?   @map("contact_confidence")
  contactSource         String?   @map("contact_source")

  emailStatus           String?   @map("email_status")
  emailVerifiedAt       DateTime? @db.Timestamptz(6) @map("email_verified_at")

  status                String    @default("discovered")
  // Valid statuses: discovered / extraction_failed / judge_skipped /
  // email_not_found / email_invalid / icp_c / deduped / ready / queued /
  // sent / replied / unsubscribed / bounced / nurture / disqualified

  domainLastContacted   DateTime? @db.Timestamptz(6) @map("domain_last_contacted")
  inRejectList          Boolean   @default(false) @map("in_reject_list")

  geminiTokensUsed      Int?      @map("gemini_tokens_used")
  geminiCostUsd         Decimal?  @db.Decimal(10, 6) @map("gemini_cost_usd")
  discoveryModel        String?   @map("discovery_model")
  extractionModel       String?   @map("extraction_model")
  judgeModel            String?   @map("judge_model")

  emails         Email[]
  bounces        Bounce[]
  replies        Reply[]
  sequenceState  SequenceState?

  @@index([status])
  @@index([icpPriority, icpScore])
  @@index([contactEmail])
  @@map("leads")
}

// ────────────────── EMAILS ──────────────────
model Email {
  id                    Int       @id @default(autoincrement())
  leadId                Int?      @map("lead_id")
  sequenceStep          Int       @default(0) @map("sequence_step")

  inboxUsed             String?   @map("inbox_used")
  fromDomain            String?   @default("trysimpleinc.com") @map("from_domain")
  fromName              String?   @map("from_name")

  subject               String?
  body                  String?
  wordCount             Int?      @map("word_count")
  hook                  String?
  containsLink          Boolean   @default(false) @map("contains_link")
  isHtml                Boolean   @default(false) @map("is_html")
  isPlainText           Boolean   @default(true)  @map("is_plain_text")

  contentValid          Boolean   @default(true)  @map("content_valid")
  validationFailReason  String?   @map("validation_fail_reason")
  regenerated           Boolean   @default(false)

  status                String    @default("pending")
  sentAt                DateTime? @db.Timestamptz(6) @map("sent_at")
  smtpResponse          String?   @map("smtp_response")
  smtpCode              Int?      @map("smtp_code")
  messageId             String?   @map("message_id")
  sendDurationMs        Int?      @map("send_duration_ms")

  inReplyTo             String?   @map("in_reply_to")
  referencesHeader      String?   @map("references_header")

  hookModel             String?   @map("hook_model")
  bodyModel             String?   @map("body_model")
  hookCostUsd           Decimal?  @db.Decimal(10, 6) @map("hook_cost_usd")
  bodyCostUsd           Decimal?  @db.Decimal(10, 6) @map("body_cost_usd")
  totalCostUsd          Decimal?  @db.Decimal(10, 6) @map("total_cost_usd")

  createdAt             DateTime  @default(now()) @db.Timestamptz(6) @map("created_at")

  lead    Lead?    @relation(fields: [leadId], references: [id])
  bounces Bounce[]
  replies Reply[]

  @@index([leadId])
  @@index([sentAt])
  @@index([status])
  @@map("emails")
}

// ────────────────── BOUNCES ──────────────────
model Bounce {
  id           Int       @id @default(autoincrement())
  emailId      Int?      @map("email_id")
  leadId       Int?      @map("lead_id")
  bounceType   String?   @map("bounce_type")
  smtpCode     Int?      @map("smtp_code")
  smtpMessage  String?   @map("smtp_message")
  bouncedAt    DateTime  @default(now()) @db.Timestamptz(6) @map("bounced_at")
  retryAfter   DateTime? @db.Timestamptz(6) @map("retry_after")

  email Email? @relation(fields: [emailId], references: [id])
  lead  Lead?  @relation(fields: [leadId], references: [id])

  @@map("bounces")
}

// ────────────────── REPLIES ──────────────────
model Reply {
  id                    Int       @id @default(autoincrement())
  leadId                Int?      @map("lead_id")
  emailId               Int?      @map("email_id")
  inboxReceivedAt       String?   @map("inbox_received_at")
  receivedAt            DateTime  @default(now()) @db.Timestamptz(6) @map("received_at")
  category              String?
  rawText               String?   @map("raw_text")
  classificationModel   String?   @map("classification_model")
  classificationCostUsd Decimal?  @db.Decimal(10, 6) @map("classification_cost_usd")
  sentimentScore        Int?      @map("sentiment_score")
  telegramAlerted       Boolean   @default(false) @map("telegram_alerted")
  requeueDate           DateTime? @db.Timestamptz(6) @map("requeue_date")
  actionedAt            DateTime? @db.Timestamptz(6) @map("actioned_at")
  actionTaken           String?   @map("action_taken")

  lead  Lead?  @relation(fields: [leadId], references: [id])
  email Email? @relation(fields: [emailId], references: [id])

  @@index([leadId])
  @@map("replies")
}

// ────────────────── REJECT LIST ──────────────────
model RejectList {
  id       Int      @id @default(autoincrement())
  email    String   @unique
  domain   String?
  reason   String?
  addedAt  DateTime @default(now()) @db.Timestamptz(6) @map("added_at")

  @@index([email])
  @@index([domain])
  @@map("reject_list")
}

// ────────────────── CRON LOG ──────────────────
model CronLog {
  id                Int       @id @default(autoincrement())
  jobName           String?   @map("job_name")
  scheduledAt       DateTime? @db.Timestamptz(6) @map("scheduled_at")
  startedAt         DateTime? @db.Timestamptz(6) @map("started_at")
  completedAt       DateTime? @db.Timestamptz(6) @map("completed_at")
  durationMs        Int?      @map("duration_ms")
  status            String?
  errorMessage      String?   @map("error_message")
  recordsProcessed  Int?      @map("records_processed")
  recordsSkipped    Int?      @map("records_skipped")
  costUsd           Decimal?  @db.Decimal(10, 6) @map("cost_usd")
  notes             String?

  @@index([jobName, scheduledAt])
  @@map("cron_log")
}

// ────────────────── DAILY METRICS ──────────────────
model DailyMetrics {
  id                    Int      @id @default(autoincrement())
  date                  String   @unique  // YYYY-MM-DD

  leadsDiscovered       Int      @default(0) @map("leads_discovered")
  leadsExtracted        Int      @default(0) @map("leads_extracted")
  leadsJudgePassed      Int      @default(0) @map("leads_judge_passed")
  leadsEmailFound       Int      @default(0) @map("leads_email_found")
  leadsEmailValid       Int      @default(0) @map("leads_email_valid")
  leadsIcpAb            Int      @default(0) @map("leads_icp_ab")
  leadsReady            Int      @default(0) @map("leads_ready")
  leadsDisqualified     Int      @default(0) @map("leads_disqualified")  // ICP v2

  emailsAttempted       Int      @default(0) @map("emails_attempted")
  emailsSent            Int      @default(0) @map("emails_sent")
  emailsHardBounced     Int      @default(0) @map("emails_hard_bounced")
  emailsSoftBounced     Int      @default(0) @map("emails_soft_bounced")
  emailsContentRejected Int      @default(0) @map("emails_content_rejected")

  sentInbox1            Int      @default(0) @map("sent_inbox_1")
  sentInbox2            Int      @default(0) @map("sent_inbox_2")

  repliesTotal          Int      @default(0) @map("replies_total")
  repliesHot            Int      @default(0) @map("replies_hot")
  repliesSchedule       Int      @default(0) @map("replies_schedule")
  repliesSoftNo         Int      @default(0) @map("replies_soft_no")
  repliesUnsubscribe    Int      @default(0) @map("replies_unsubscribe")
  repliesOoo            Int      @default(0) @map("replies_ooo")
  repliesOther          Int      @default(0) @map("replies_other")

  bounceRate            Float?   @map("bounce_rate")
  replyRate             Float?   @map("reply_rate")
  unsubscribeRate       Float?   @map("unsubscribe_rate")

  geminiCostUsd         Decimal  @default(0) @db.Decimal(14, 6) @map("gemini_cost_usd")
  sonnetCostUsd         Decimal  @default(0) @db.Decimal(14, 6) @map("sonnet_cost_usd")
  haikuCostUsd          Decimal  @default(0) @db.Decimal(14, 6) @map("haiku_cost_usd")
  mevCostUsd            Decimal  @default(0) @db.Decimal(14, 6) @map("mev_cost_usd")
  totalApiCostUsd       Decimal  @default(0) @db.Decimal(14, 6) @map("total_api_cost_usd")
  totalApiCostInr       Decimal  @default(0) @db.Decimal(14, 6) @map("total_api_cost_inr")

  domainBlacklisted     Boolean  @default(false) @map("domain_blacklisted")
  blacklistZones        Json?    @map("blacklist_zones")
  mailTesterScore       Float?   @map("mail_tester_score")
  postmasterReputation  String?  @map("postmaster_reputation")

  icpParseErrors        Int      @default(0) @map("icp_parse_errors")  // ICP v2
  followupsSent         Int      @default(0) @map("followups_sent")

  createdAt             DateTime @default(now()) @db.Timestamptz(6) @map("created_at")

  @@index([date])
  @@map("daily_metrics")
}

// ────────────────── ERROR LOG ──────────────────
model ErrorLog {
  id           Int       @id @default(autoincrement())
  occurredAt   DateTime  @default(now()) @db.Timestamptz(6) @map("occurred_at")
  source       String?
  jobName      String?   @map("job_name")
  errorType    String?   @map("error_type")
  errorCode    String?   @map("error_code")
  errorMessage String?   @map("error_message")
  stackTrace   String?   @map("stack_trace")
  leadId       Int?      @map("lead_id")
  emailId      Int?      @map("email_id")
  resolved     Boolean   @default(false)
  resolvedAt   DateTime? @db.Timestamptz(6) @map("resolved_at")

  @@index([source, occurredAt])
  @@map("error_log")
}

// ────────────────── SEQUENCE STATE ──────────────────
model SequenceState {
  id              Int       @id @default(autoincrement())
  leadId          Int       @unique @map("lead_id")
  currentStep     Int       @default(0) @map("current_step")
  nextSendDate    DateTime? @db.Date      @map("next_send_date")
  lastSentAt      DateTime? @db.Timestamptz(6) @map("last_sent_at")
  lastMessageId   String?   @map("last_message_id")
  lastSubject     String?   @map("last_subject")
  status          String    @default("active")
  pausedReason    String?   @map("paused_reason")
  updatedAt       DateTime  @default(now()) @db.Timestamptz(6) @updatedAt @map("updated_at")

  lead Lead @relation(fields: [leadId], references: [id])

  @@map("sequence_state")
}

// ────────────────── CONFIG ──────────────────
model Config {
  key   String  @id
  value String?

  @@map("config")
}

// ────────────────── NICHES ──────────────────
model Niche {
  id         Int      @id @default(autoincrement())
  label      String
  query      String
  dayOfWeek  Int?     @map("day_of_week")
  enabled    Boolean  @default(true)
  sortOrder  Int      @default(0) @map("sort_order")
  createdAt  DateTime @default(now()) @db.Timestamptz(6) @map("created_at")

  @@map("niches")
}

// ────────────────── ICP RULES (legacy; kept during migration) ──────────────────
model IcpRule {
  id          Int      @id @default(autoincrement())
  label       String
  points      Int
  description String?
  enabled     Boolean  @default(true)
  sortOrder   Int      @default(0) @map("sort_order")

  @@map("icp_rules")
}

// ────────────────── OFFER (singleton, ICP v2) ──────────────────
model Offer {
  id              Int       @id @default(1)
  problem         String?
  outcome         String?
  category        String?
  useCases        Json?     @map("use_cases")
  triggers        Json?
  alternatives    Json?
  differentiation String?
  priceRange      String?   @map("price_range")
  salesCycle      String?   @map("sales_cycle")
  criticality     String?
  inactionCost    String?   @map("inaction_cost")
  requiredInputs  Json?     @map("required_inputs")
  proofPoints     Json?     @map("proof_points")
  updatedAt       DateTime  @default(now()) @db.Timestamptz(6) @map("updated_at")

  @@map("offer")
}

// ────────────────── ICP PROFILE (singleton, ICP v2) ──────────────────
model IcpProfile {
  id                   Int       @id @default(1)
  industries           Json?
  companySize          String?   @map("company_size")
  revenueRange         String?   @map("revenue_range")
  geography            Json?
  stage                Json?
  techStack            Json?     @map("tech_stack")
  internalCapabilities Json?     @map("internal_capabilities")
  budgetRange          String?   @map("budget_range")
  problemFrequency     String?   @map("problem_frequency")
  problemCost          String?   @map("problem_cost")
  impactedKpis         Json?     @map("impacted_kpis")
  initiatorRoles       Json?     @map("initiator_roles")
  decisionRoles        Json?     @map("decision_roles")
  objections           Json?
  buyingProcess        String?   @map("buying_process")
  intentSignals        Json?     @map("intent_signals")
  currentTools         Json?     @map("current_tools")
  workarounds          Json?
  frustrations         Json?
  switchingBarriers    Json?     @map("switching_barriers")
  hardDisqualifiers    Json?     @map("hard_disqualifiers")
  updatedAt            DateTime  @default(now()) @db.Timestamptz(6) @map("updated_at")

  @@map("icp_profile")
}
```

**Singleton pattern note:** `Offer.id` and `IcpProfile.id` both have `@default(1)`. Combined with application-level enforcement via `upsert({ where: { id: 1 }, create: { id: 1 }, update: {} })`, we get the same semantics as SQLite's `CHECK (id=1) + INSERT OR IGNORE`. No Postgres CHECK constraint — keeps schema portable.

- [ ] **Step 2:** Generate initial migration:

```bash
cd /Users/drprockz/Projects/Outreach
npx prisma migrate dev --name init
```

Expected: `prisma/migrations/<timestamp>_init/migration.sql` created, schema applied to `radar` DB, Prisma Client generated. If prompted about drift, note that the DB is fresh so there's nothing to lose.

- [ ] **Step 3:** Verify generated SQL:

```bash
head -50 prisma/migrations/*_init/migration.sql
```

Confirm table names are snake_case (from `@@map`) and columns are snake_case (from `@map`). Check `offer` and `icp_profile` tables are present.

- [ ] **Step 4:** Apply the same migration to test DB:

```bash
DATABASE_URL="$DATABASE_URL_TEST" npx prisma migrate deploy
```

- [ ] **Step 5:** Commit:

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(db): add prisma schema for all 14 tables (incl ICP v2 Offer + IcpProfile)"
```

### Task 1.3: Postgres-backed test fixture

**Files:**
- Create: `tests/helpers/testDb.js`
- Create: `tests/helpers/testDb.test.js`
- Modify: `package.json` scripts

- [ ] **Step 1:** Create `tests/helpers/testDb.js`:

```js
// Test helper: provides a fresh Postgres state per test by truncating all tables.
// Assumes DATABASE_URL_TEST points at a DB with migrations already applied.
import { PrismaClient } from '@prisma/client';

// Force prisma to use the test URL
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST || process.env.DATABASE_URL;

let _prisma;

export function getTestPrisma() {
  if (!_prisma) {
    _prisma = new PrismaClient({
      datasources: { db: { url: process.env.DATABASE_URL_TEST } },
    });
  }
  return _prisma;
}

// All 14 tables, children before parents
const TABLES = [
  'bounces', 'replies', 'sequence_state', 'emails', 'leads',
  'reject_list', 'cron_log', 'daily_metrics', 'error_log',
  'config', 'niches', 'icp_rules', 'offer', 'icp_profile',
];

export async function truncateAll() {
  const prisma = getTestPrisma();
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${TABLES.map(t => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE;`
  );
}

export async function closeTestPrisma() {
  if (_prisma) {
    await _prisma.$disconnect();
    _prisma = null;
  }
}
```

- [ ] **Step 2:** Add to `package.json` scripts:

```json
"test:db:reset": "DATABASE_URL=\"$DATABASE_URL_TEST\" prisma migrate reset --force --skip-seed"
```

Add to existing `"scripts": { ... }` — don't overwrite the existing `test` / `test:watch`.

- [ ] **Step 3:** Smoke test at `tests/helpers/testDb.test.js`:

```js
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestPrisma, truncateAll, closeTestPrisma } from './testDb.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closeTestPrisma(); });

describe('testDb helper', () => {
  it('truncates + isolates state between tests', async () => {
    const prisma = getTestPrisma();
    await prisma.rejectList.create({ data: { email: 'a@b.com', domain: 'b.com', reason: 'test' } });
    expect(await prisma.rejectList.count()).toBe(1);
  });

  it('second test sees zero rows (truncate ran)', async () => {
    const prisma = getTestPrisma();
    expect(await prisma.rejectList.count()).toBe(0);
  });

  it('truncate covers offer + icp_profile singletons', async () => {
    const prisma = getTestPrisma();
    await prisma.offer.upsert({ where: { id: 1 }, create: { id: 1, problem: 'x' }, update: {} });
    expect(await prisma.offer.count()).toBe(1);
    await truncateAll();
    expect(await prisma.offer.count()).toBe(0);
  });
});
```

- [ ] **Step 4:** Run: `npm test -- tests/helpers/testDb.test.js` — expect 3 pass.

- [ ] **Step 5:** Commit:

```bash
git add tests/helpers/ package.json
git commit -m "test(db): add postgres test fixture with truncate-per-test"
```

---

## Chunk 2: `src/core/db/index.js` Rewrite

**Commit cadence:** 1 commit at end. Must keep old SQLite helpers as stubs or remove cleanly; every caller will be rewritten in Chunks 3-6 to use async Prisma calls.

### Task 2.1: Rewrite `src/core/db/index.js`

**Files:**
- Modify: `src/core/db/index.js`
- Modify: `tests/core/db/db.test.js`

- [ ] **Step 1:** Overwrite `src/core/db/index.js` with:

```js
import { PrismaClient } from '@prisma/client';
import 'dotenv/config';

let _prisma;

export function getPrisma() {
  if (!_prisma) {
    _prisma = new PrismaClient();
  }
  return _prisma;
}

// Convenience named export — same instance as getPrisma()
export const prisma = new Proxy({}, {
  get(_t, prop) { return getPrisma()[prop]; },
});

/** For tests only */
export async function resetDb() {
  if (_prisma) { await _prisma.$disconnect(); _prisma = null; }
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

async function ensureDailyMetricsRow(date) {
  await getPrisma().dailyMetrics.upsert({
    where: { date },
    create: { date },
    update: {},
  });
}

export async function bumpMetric(field, amount = 1) {
  const d = today();
  await ensureDailyMetricsRow(d);
  await getPrisma().dailyMetrics.update({
    where: { date: d },
    data: { [field]: { increment: amount } },
  });
}

// Consolidated cost-metric helper (was 3 parallel UPSERTs in claude.js/mev.js/db.js)
export async function bumpCostMetric(field, amountUsd) {
  const d = today();
  await ensureDailyMetricsRow(d);
  await getPrisma().dailyMetrics.update({
    where: { date: d },
    data: {
      [field]: { increment: amountUsd },
      totalApiCostUsd: { increment: amountUsd },
    },
  });
}

export async function logError(source, err, { jobName, errorType, errorCode, leadId, emailId } = {}) {
  await getPrisma().errorLog.create({
    data: {
      source,
      jobName: jobName ?? null,
      errorType: errorType ?? null,
      errorCode: errorCode ?? null,
      errorMessage: err?.message || String(err),
      stackTrace: err?.stack ?? null,
      leadId: leadId ?? null,
      emailId: emailId ?? null,
    },
  });
}

export async function logCron(jobName) {
  const now = new Date();
  const row = await getPrisma().cronLog.create({
    data: { jobName, scheduledAt: now, startedAt: now, status: 'running' },
    select: { id: true },
  });
  return row.id;
}

export async function finishCron(id, { status = 'success', recordsProcessed = 0, recordsSkipped = 0, costUsd = 0, error = null } = {}) {
  const row = await getPrisma().cronLog.findUnique({ where: { id }, select: { startedAt: true } });
  const durationMs = row?.startedAt ? Date.now() - row.startedAt.getTime() : null;
  await getPrisma().cronLog.update({
    where: { id },
    data: {
      completedAt: new Date(),
      durationMs,
      status,
      recordsProcessed,
      recordsSkipped,
      costUsd,
      errorMessage: error,
    },
  });
}

export async function isRejected(email) {
  const domain = email.split('@')[1];
  const row = await getPrisma().rejectList.findFirst({
    where: { OR: [{ email }, { domain }] },
    select: { id: true },
  });
  return !!row;
}

export async function addToRejectList(email, reason) {
  const domain = email.split('@')[1];
  await getPrisma().rejectList.upsert({
    where: { email },
    create: { email, domain, reason },
    update: {},  // INSERT OR IGNORE semantics
  });
}

export async function todaySentCount() {
  const row = await getPrisma().dailyMetrics.findUnique({
    where: { date: today() },
    select: { emailsSent: true },
  });
  return row?.emailsSent || 0;
}

export async function todayBounceRate() {
  const row = await getPrisma().dailyMetrics.findUnique({
    where: { date: today() },
    select: { emailsSent: true, emailsHardBounced: true },
  });
  if (!row || row.emailsSent === 0) return 0;
  return row.emailsHardBounced / row.emailsSent;
}

export async function getConfigMap() {
  try {
    const rows = await getPrisma().config.findMany();
    return Object.fromEntries(rows.map(r => [r.key, r.value]));
  } catch {
    return {};
  }
}

export function getConfigInt(cfg, key, fallback) {
  const v = parseInt(cfg[key]);
  return isNaN(v) ? fallback : v;
}

export function getConfigFloat(cfg, key, fallback) {
  const v = parseFloat(cfg[key]);
  return isNaN(v) ? fallback : v;
}

export function getConfigStr(cfg, key, fallback) {
  return cfg[key] ?? fallback;
}

export async function seedConfigDefaults() {
  const defaults = [
    ['daily_send_limit', '0'],
    ['max_per_inbox', '17'],
    ['send_delay_min_ms', '180000'],
    ['send_delay_max_ms', '420000'],
    ['send_window_start', '9'],
    ['send_window_end', '17'],
    ['bounce_rate_hard_stop', '0.02'],
    ['claude_daily_spend_cap', '3.00'],
    ['find_leads_enabled', '1'],
    ['send_emails_enabled', '1'],
    ['send_followups_enabled', '1'],
    ['check_replies_enabled', '1'],
    ['icp_threshold_a', '70'],   // ICP v2: was '7'
    ['icp_threshold_b', '40'],   // ICP v2: was '4'
    ['icp_weights', JSON.stringify({ firmographic: 20, problem: 20, intent: 15, tech: 15, economic: 15, buying: 15 })],
    ['find_leads_per_batch', '30'],
    ['find_leads_cities', '["Mumbai","Bangalore","Delhi NCR","Pune"]'],
    ['find_leads_business_size', 'msme'],
    ['find_leads_count', '150'],
    ['persona_name', 'Darshan Parmar'],
    ['persona_role', 'Full-Stack Developer'],
    ['persona_company', 'Simple Inc'],
    ['persona_website', 'simpleinc.in'],
    ['persona_tone', 'professional but direct'],
    ['persona_services', 'Full-stack web development, redesigns, performance optimisation, custom React apps, API integrations'],
  ];
  await getPrisma().config.createMany({
    data: defaults.map(([key, value]) => ({ key, value })),
    skipDuplicates: true,
  });

  // ICP v2 one-off upgrade: flip old 0-10 thresholds to 0-100
  const prisma = getPrisma();
  const threshA = await prisma.config.findUnique({ where: { key: 'icp_threshold_a' } });
  if (threshA && Number(threshA.value) <= 10) {
    await prisma.config.update({ where: { key: 'icp_threshold_a' }, data: { value: '70' } });
    await prisma.config.update({ where: { key: 'icp_threshold_b' }, data: { value: '40' } });
  }
}

export async function seedNichesAndIcpRules() {
  const prisma = getPrisma();

  if ((await prisma.niche.count()) === 0) {
    await prisma.niche.createMany({
      data: [
        { dayOfWeek: 1, label: 'Shopify/D2C brands',     query: 'India D2C ecommerce brand Shopify outdated website',         sortOrder: 0 },
        { dayOfWeek: 2, label: 'Real estate agencies',   query: 'Mumbai real estate agency property portal outdated website', sortOrder: 1 },
        { dayOfWeek: 3, label: 'Funded startups',        query: 'India funded B2B startup outdated website developer needed', sortOrder: 2 },
        { dayOfWeek: 4, label: 'Restaurants/cafes',      query: 'Mumbai restaurant cafe outdated website no online booking',  sortOrder: 3 },
        { dayOfWeek: 5, label: 'Agencies/consultancies', query: 'Mumbai digital agency overflow web development outsource',   sortOrder: 4 },
        { dayOfWeek: 6, label: 'Healthcare/salons',      query: 'India healthcare salon clinic outdated website no booking',  sortOrder: 5 },
      ],
    });
  }

  if ((await prisma.icpRule.count()) === 0) {
    await prisma.icpRule.createMany({
      data: [
        { points:  3, label: 'India-based B2C-facing (restaurant, salon, real estate, D2C)',    sortOrder: 0 },
        { points:  2, label: '20+ Google reviews (established business, has budget)',           sortOrder: 1 },
        { points:  2, label: 'WordPress/Wix/Squarespace stack (easiest sell)',                  sortOrder: 2 },
        { points:  2, label: 'Website last updated 2+ years ago',                               sortOrder: 3 },
        { points:  1, label: 'Active Instagram/Facebook but neglected website',                 sortOrder: 4 },
        { points:  1, label: 'WhatsApp Business on site but no online booking/ordering',        sortOrder: 5 },
        { points: -2, label: 'Freelancer or solo consultant (low budget)',                      sortOrder: 6 },
        { points: -3, label: 'Already on modern stack (Next.js, custom React, Webflow)',        sortOrder: 7 },
      ],
    });
  }

  // ICP v2 singletons — create empty row if missing
  await prisma.offer.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
  await prisma.icpProfile.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
}
```

**Deliberate removals:** `initSchema()`, `addColumnIfMissing()`, `getDb()` are **not** ported. Prisma migrations replace `initSchema`; column additions are schema-level changes managed via `prisma migrate dev`; `getDb()` callers switch to `getPrisma()` or `prisma`.

- [ ] **Step 2:** Rewrite `tests/core/db/db.test.js` to use the Postgres fixture. Overwrite with:

```js
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { truncateAll, closeTestPrisma } from '../../helpers/testDb.js';
import {
  resetDb, today, logError, isRejected, addToRejectList,
  bumpMetric, bumpCostMetric, todaySentCount, todayBounceRate,
  getConfigMap, seedConfigDefaults, seedNichesAndIcpRules, getPrisma,
} from '../../../src/core/db/index.js';

beforeEach(async () => { await truncateAll(); await resetDb(); });
afterAll(async () => { await resetDb(); await closeTestPrisma(); });

describe('db helpers (prisma)', () => {
  it('today() returns YYYY-MM-DD', () => {
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('logError inserts into error_log', async () => {
    await logError('test-source', new Error('boom'));
    const rows = await getPrisma().errorLog.findMany({ where: { source: 'test-source' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].errorMessage).toBe('boom');
  });

  it('isRejected returns false for unknown email', async () => {
    expect(await isRejected('nobody@example.com')).toBe(false);
  });

  it('addToRejectList + isRejected roundtrip', async () => {
    await addToRejectList('test@spam.com', 'unsubscribe');
    expect(await isRejected('test@spam.com')).toBe(true);
  });

  it('bumpMetric creates row and increments field', async () => {
    await bumpMetric('emailsSent', 5);
    expect(await todaySentCount()).toBe(5);
    await bumpMetric('emailsSent', 3);
    expect(await todaySentCount()).toBe(8);
  });

  it('bumpCostMetric bumps named field AND totalApiCostUsd', async () => {
    await bumpCostMetric('sonnetCostUsd', 0.05);
    const row = await getPrisma().dailyMetrics.findUnique({ where: { date: today() } });
    expect(Number(row.sonnetCostUsd)).toBeCloseTo(0.05);
    expect(Number(row.totalApiCostUsd)).toBeCloseTo(0.05);
  });

  it('todayBounceRate returns 0 with no sends', async () => {
    expect(await todayBounceRate()).toBe(0);
  });

  it('seedConfigDefaults is idempotent + flips old thresholds', async () => {
    const prisma = getPrisma();
    // Seed with legacy values to test the upgrade
    await prisma.config.create({ data: { key: 'icp_threshold_a', value: '7' } });
    await prisma.config.create({ data: { key: 'icp_threshold_b', value: '4' } });
    await seedConfigDefaults();
    const cfg = await getConfigMap();
    expect(cfg['daily_send_limit']).toBe('0');
    expect(cfg['icp_threshold_a']).toBe('70');
    expect(cfg['icp_threshold_b']).toBe('40');
    expect(cfg['icp_weights']).toContain('firmographic');
  });

  it('seedNichesAndIcpRules seeds 6 niches + 8 rules + offer + icp_profile singletons', async () => {
    await seedNichesAndIcpRules();
    expect(await getPrisma().niche.count()).toBe(6);
    expect(await getPrisma().icpRule.count()).toBe(8);
    expect(await getPrisma().offer.count()).toBe(1);
    expect(await getPrisma().icpProfile.count()).toBe(1);
  });
});
```

- [ ] **Step 3:** Run: `npm test -- tests/core/db/db.test.js`. Expect all pass. Any failure here means a Prisma schema/field mismatch — fix before continuing (downstream chunks depend on this).

- [ ] **Step 4:** Commit:

```bash
git add src/core/db/index.js tests/core/db/db.test.js
git commit -m "feat(db): rewrite src/core/db/index.js to use PrismaClient"
```

**Side effect:** Every caller of `getDb()` / `initSchema()` / `addColumnIfMissing` is now broken. Full suite will have many failures. That's expected — Chunks 3-6 fix them.

---

## Chunk 3: Cost-tracking utilities + icpScorer + rescoreLeads

**Commit cadence:** 4 commits, one per file.

### Task 3.1: Rewrite `src/core/ai/claude.js`

**Files:**
- Modify: `src/core/ai/claude.js`
- (No dedicated test file today — covered by integration tests)

- [ ] **Step 1:** Read the current file. Identify every `getDb()`/`prepare()` call against `daily_metrics`. Replace with `await bumpCostMetric('sonnetCostUsd' | 'haikuCostUsd', costUsd)` imports from `../db/index.js`. Replace `SELECT ... FROM daily_metrics WHERE date=?` with `await getPrisma().dailyMetrics.findUnique({ where: { date: today() }, select: { totalApiCostUsd: true } })`. Make every exported function `async`.

- [ ] **Step 2:** Commit:

```bash
git add src/core/ai/claude.js
git commit -m "feat(claude): async + prisma for daily_metrics cost tracking"
```

### Task 3.2: Rewrite `src/core/integrations/mev.js`

**Files:**
- Modify: `src/core/integrations/mev.js`

- [ ] **Step 1:** Same mechanical rewrite. Replace UPSERT with `await bumpCostMetric('mevCostUsd', costUsd)`. Make exported verify function `async` (already is, in all likelihood).

- [ ] **Step 2:** Commit:

```bash
git add src/core/integrations/mev.js
git commit -m "feat(mev): async + prisma for daily_metrics cost tracking"
```

### Task 3.3: Rewrite `src/core/ai/icpScorer.js`

**Files:**
- Modify: `src/core/ai/icpScorer.js`
- Modify: `tests/core/ai/icpScorer.test.js`

The current `loadScoringContext(db)` uses `db.prepare('SELECT * FROM offer WHERE id = 1').get()`. With Prisma, the `Json` type returns parsed JS objects/arrays directly — no manual `JSON.parse` needed.

- [ ] **Step 1:** Rewrite `loadScoringContext` to accept a Prisma client:

```js
// Before
export function loadScoringContext(db) {
  const offer = db.prepare('SELECT * FROM offer WHERE id = 1').get();
  const icp   = db.prepare('SELECT * FROM icp_profile WHERE id = 1').get();
  // ...
}

// After
export async function loadScoringContext(prisma) {
  const offer = await prisma.offer.findUnique({ where: { id: 1 } });
  const icp   = await prisma.icpProfile.findUnique({ where: { id: 1 } });
  if (!offer || !icp) throw new Error('ICP scoring requires offer + icp_profile rows to exist');
  if (!offer.problem || !Array.isArray(icp.industries) || icp.industries.length === 0) {
    throw new Error('ICP scoring requires offer.problem and icp_profile.industries to be configured');
  }
  // JSON fields are already parsed by Prisma — no parseJsonFields() needed
  return { offer, icp };
}
```

Remove the now-unused `OFFER_JSON_FIELDS`, `ICP_JSON_FIELDS`, and `parseJsonFields` helpers.

`scoreLead()` stays mostly the same — just update the `logError` call signature to use the same async form (it already did).

- [ ] **Step 2:** Update `tests/core/ai/icpScorer.test.js` — switch from SQLite tmpdir fixture to Postgres truncate fixture:

```js
import { truncateAll, closeTestPrisma, getTestPrisma } from '../../helpers/testDb.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closeTestPrisma(); });

// Tests that previously called initSchema()+db.prepare() now use:
const prisma = getTestPrisma();
await prisma.offer.upsert({ where: { id: 1 }, create: { id: 1, problem: 'outdated websites' }, update: {} });
await prisma.icpProfile.upsert({ where: { id: 1 }, create: { id: 1, industries: ['restaurants','salons'] }, update: {} });
const ctx = await loadScoringContext(prisma);
```

The mock setup for `callGemini` stays unchanged. All 18 existing tests translate directly — the only differences are the DB setup and `await loadScoringContext(...)`.

- [ ] **Step 3:** Run: `npm test -- tests/core/ai/icpScorer.test.js`. Expect 18 pass.

- [ ] **Step 4:** Commit:

```bash
git add src/core/ai/icpScorer.js tests/core/ai/icpScorer.test.js
git commit -m "feat(icpScorer): prisma-based loadScoringContext; remove manual JSON parsing"
```

### Task 3.4: Rewrite `scripts/rescoreLeads.js`

**Files:**
- Modify: `scripts/rescoreLeads.js`
- Modify: `tests/scripts/rescoreLeads.test.js`

The current script uses `better-sqlite3`'s sync `db.transaction(fn)`. Prisma's equivalent is `prisma.$transaction(async (tx) => { ... })` (interactive form).

- [ ] **Step 1:** Rewrite forward path:

```js
import 'dotenv/config';
import { getPrisma, getConfigMap, getConfigInt, getConfigStr } from '../src/core/db/index.js';
import { loadScoringContext, scoreLead } from '../src/core/ai/icpScorer.js';

const DEFAULT_WEIGHTS = { firmographic: 20, problem: 20, intent: 15, tech: 15, economic: 15, buying: 15 };
const SCOREABLE_STATUSES = ['ready', 'sent', 'replied', 'nurture', 'bounced', 'unsubscribed'];

export default async function rescoreLeads({ legacy = false } = {}) {
  if (legacy) return rescoreLegacy();

  const prisma = getPrisma();
  const cfg = await getConfigMap();
  const scoringCtx = await loadScoringContext(prisma);
  scoringCtx.weights = (() => {
    try { return JSON.parse(getConfigStr(cfg, 'icp_weights', JSON.stringify(DEFAULT_WEIGHTS))); }
    catch { return DEFAULT_WEIGHTS; }
  })();
  scoringCtx.threshA = getConfigInt(cfg, 'icp_threshold_a', 70);
  scoringCtx.threshB = getConfigInt(cfg, 'icp_threshold_b', 40);

  const leads = await prisma.lead.findMany({
    where: { status: { in: SCOREABLE_STATUSES } },
    orderBy: { id: 'asc' },
  });

  const stats = { total: leads.length, A: 0, B: 0, C: 0, disqualified: 0, ready_to_dq: 0, cost: 0 };

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];
    // Prisma already returns JSON fields as parsed arrays — no JSON.parse needed
    const icp = await scoreLead(lead, scoringCtx);
    stats.cost += icp.costUsd;

    await prisma.$transaction(async (tx) => {
      await tx.lead.update({
        where: { id: lead.id },
        data: {
          icpScore: icp.icp_score,
          icpPriority: icp.icp_priority,
          icpReason: icp.icp_reason,
          icpBreakdown: icp.icp_breakdown || null,
          icpKeyMatches: icp.icp_key_matches || [],
          icpKeyGaps: icp.icp_key_gaps || [],
          icpDisqualifiers: icp.icp_disqualifiers || [],
        },
      });

      if (icp.icp_disqualifiers.length > 0 && lead.status === 'ready') {
        await tx.lead.update({ where: { id: lead.id }, data: { status: 'disqualified' } });
        await tx.email.deleteMany({ where: { leadId: lead.id, status: 'pending' } });
      }
    });

    stats[icp.icp_priority]++;
    if (icp.icp_disqualifiers.length > 0) {
      stats.disqualified++;
      if (lead.status === 'ready') stats.ready_to_dq++;
    }

    if ((i + 1) % 50 === 0) {
      console.log(`[rescore] ${i + 1}/${leads.length} done ($${stats.cost.toFixed(4)} so far)`);
    }
  }

  console.log('\n=== Rescore summary ===');
  console.log(`Total: ${stats.total}`);
  console.log(`A: ${stats.A}  B: ${stats.B}  C: ${stats.C}  Disqualified: ${stats.disqualified}`);
  console.log(`ready → disqualified transitions: ${stats.ready_to_dq}`);
  console.log(`Gemini cost: $${stats.cost.toFixed(4)}`);

  return stats;
}

async function rescoreLegacy() {
  const { callGemini } = await import('../src/core/ai/gemini.js');
  const prisma = getPrisma();

  const rules = await prisma.icpRule.findMany({ where: { enabled: true }, orderBy: { sortOrder: 'asc' } });
  if (rules.length === 0) throw new Error('legacy rescore requires icp_rules rows');
  const rubric = rules.map(r => `${r.points > 0 ? '+' : ''}${r.points}  ${r.label}`).join('\n');
  const threshA = 7;
  const threshB = 4;

  const leads = await prisma.lead.findMany({
    where: { status: { in: SCOREABLE_STATUSES } },
  });

  let cost = 0;
  for (const lead of leads) {
    const prompt = `Score this lead on the ICP rubric and return JSON {icp_score: number, icp_priority: "A"|"B"|"C", icp_reason: "brief explanation"}.

Rubric:
${rubric}

Priority: A=${threshA}-10, B=${threshB}-${threshA - 1}, C=below ${threshB} (including negative)

Lead data:
Company: ${lead.businessName}
Tech stack: ${JSON.stringify(lead.techStack || [])}
Business signals: ${JSON.stringify(lead.businessSignals || [])}
City: ${lead.city}
Category: ${lead.category}
Quality score: ${lead.websiteQualityScore}

Return only valid JSON.`;
    const result = await callGemini(prompt);
    cost += result.costUsd;
    let parsed;
    try {
      parsed = JSON.parse(result.text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim());
    } catch {
      parsed = { icp_score: 0, icp_priority: 'C', icp_reason: 'parse error' };
    }
    await prisma.lead.update({
      where: { id: lead.id },
      data: { icpScore: parsed.icp_score, icpPriority: parsed.icp_priority, icpReason: parsed.icp_reason || '' },
    });
  }
  console.log(`Legacy rescore done: ${leads.length} leads, cost $${cost.toFixed(4)}`);
  return { total: leads.length, cost };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*[/\\]/, ''))) {
  const legacy = process.argv.includes('--legacy');
  rescoreLeads({ legacy }).catch(err => { console.error(err); process.exit(1); });
}
```

- [ ] **Step 2:** Update `tests/scripts/rescoreLeads.test.js` — switch DB setup to Postgres fixture; Gemini mock unchanged. The transaction test needs minor adjustment since Prisma's `$transaction` returns differently, but assertion logic (status flip + pending email deletion) stays the same.

- [ ] **Step 3:** Run: `npm test -- tests/scripts/rescoreLeads.test.js`. Expect 4 pass.

- [ ] **Step 4:** Commit:

```bash
git add scripts/rescoreLeads.js tests/scripts/rescoreLeads.test.js
git commit -m "feat(rescore): async + prisma with \$transaction for atomic updates"
```

---

## Chunk 4: Engine rewrites — findLeads, sendEmails, sendFollowups

**Commit cadence:** 1 commit per engine. Pattern is mechanical but large.

### Task 4.1: Rewrite `src/engines/findLeads.js`

**Files:**
- Modify: `src/engines/findLeads.js`
- Modify: `tests/engines/findLeads.test.js`
- Modify: `tests/engines/insertLead.test.js`

**Key simplifications:**
- `insertLead(db, lead, niche, status)` becomes `insertLead(lead, niche, status)` — `prisma` is imported at module scope.
- The 35-column positional INSERT becomes a clean `prisma.lead.create({ data: {...} })` with named fields.
- JSON stringification disappears: `JSON.stringify(lead.tech_stack || [])` → just `lead.techStack || []` (Prisma `Json` type handles serialization).
- Boolean columns: `0`/`1` → `false`/`true`.
- `datetime('now')` → `new Date()` (or rely on `@default(now())`).

- [ ] **Step 1:** Walk the file top-to-bottom. Replace every `db.prepare(...)` with Prisma calls per the pattern table:

| SQLite | Prisma |
|---|---|
| `.all()` | `findMany` |
| `.get()` | `findFirst` / `findUnique` |
| `.run()` INSERT | `create` |
| `.run()` UPDATE | `update` / `updateMany` |
| `.run()` UPSERT (`ON CONFLICT`) | `upsert` |
| `JSON.stringify(arr)` on write | just `arr` |
| `JSON.parse(row.col)` on read | just `row.col` (already parsed) |
| `0`/`1` for boolean columns | `false`/`true` |

- [ ] **Step 2:** Rewrite `insertLead` as:

```js
export async function insertLead(lead, niche, status) {
  return prisma.lead.create({
    data: {
      businessName: lead.business_name,
      websiteUrl: lead.website_url,
      category: lead.category,
      city: lead.city,
      country: 'IN',
      searchQuery: niche.query,
      techStack: lead.tech_stack || [],
      websiteProblems: lead.website_problems || [],
      lastUpdated: lead.last_updated,
      hasSsl: Boolean(lead.has_ssl),
      hasAnalytics: Boolean(lead.has_analytics),
      ownerName: lead.owner_name,
      ownerRole: lead.owner_role,
      businessSignals: lead.business_signals || [],
      socialActive: Boolean(lead.social_active),
      websiteQualityScore: lead.website_quality_score,
      judgeReason: lead.judge_reason,
      contactName: lead.owner_name,
      contactEmail: lead.contact_email,
      contactConfidence: lead.contact_confidence,
      contactSource: lead.contact_source,
      emailStatus: lead.email_status,
      emailVerifiedAt: status === 'ready' ? new Date() : null,
      employeesEstimate: lead.employees_estimate || 'unknown',
      businessStage: lead.business_stage || 'unknown',
      icpScore: lead.icp_score,
      icpPriority: lead.icp_priority,
      icpReason: lead.icp_reason,
      icpBreakdown: lead.icp_breakdown || null,
      icpKeyMatches: lead.icp_key_matches || [],
      icpKeyGaps: lead.icp_key_gaps || [],
      icpDisqualifiers: lead.icp_disqualifiers || [],
      status,
      geminiCostUsd: (lead.extractCost || 0) + (lead.icpCost || 0),
      discoveryModel: 'gemini-2.5-flash',
      extractionModel: 'gemini-2.5-flash',
    },
  });
}
```

Call sites update from `insertLead(db, lead, niche, status)` → `await insertLead(lead, niche, status)`.

- [ ] **Step 3:** Rewrite the domain-cooldown query (currently `SELECT DISTINCT substr(contact_email, instr(contact_email, '@') + 1)`). Extract domain in JS:

```js
const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
const cooledDomainLeads = await prisma.lead.findMany({
  where: {
    status: { in: ['sent', 'replied'] },
    domainLastContacted: { gte: ninetyDaysAgo },
    contactEmail: { not: null },
  },
  select: { contactEmail: true },
});
const cooledDomains = new Set(
  cooledDomainLeads.map(r => r.contactEmail?.split('@')[1]).filter(Boolean)
);
```

- [ ] **Step 4:** Rewrite the AI spend-cap check:

```js
const row = await prisma.dailyMetrics.findUnique({
  where: { date: todayStr },
  select: { geminiCostUsd: true, sonnetCostUsd: true, haikuCostUsd: true },
});
const aiSpendToday = ANTHROPIC_DISABLED
  ? Number(row?.geminiCostUsd || 0)
  : Number(row?.sonnetCostUsd || 0) + Number(row?.haikuCostUsd || 0);
```

Note the `Number()` casts — Prisma returns `Decimal` objects, not plain numbers.

- [ ] **Step 5:** `await` every helper call: `logCron`, `finishCron`, `logError`, `bumpMetric`, `addToRejectList`, `isRejected`, `getConfigMap`, `seedConfigDefaults`, `seedNichesAndIcpRules`.

Run an "await audit" grep to catch missed ones:

```bash
grep -nE "logCron|finishCron|logError|bumpMetric|addToRejectList|isRejected|getConfigMap|seedConfigDefaults|seedNichesAndIcpRules|loadScoringContext|scoreLead|insertLead" src/engines/findLeads.js | grep -v "await\|import\|//"
```

Any hit is a potential missing `await`.

- [ ] **Step 6:** Update `tests/engines/findLeads.test.js`:
- Replace SQLite tmpdir setup with the Postgres fixture (`truncateAll` per test).
- Keep all `vi.mock('../../src/core/ai/gemini.js', ...)` mocks unchanged.
- The existing mocks' Gemini response shapes (for extraction and scoring) already match the new schema.
- Any test assertion that reads `JSON.parse(row.icp_breakdown)` becomes just `row.icpBreakdown` (already parsed by Prisma; note camelCase).

- [ ] **Step 7:** Update `tests/engines/insertLead.test.js`:
- Change signature: `insertLead(lead, niche, status)` (no `db` arg).
- JSON assertions: `JSON.parse(row.icp_disqualifiers)` → `row.icpDisqualifiers` (already array).
- Run: `npm test -- tests/engines/insertLead.test.js`. Expect 4 pass.

- [ ] **Step 8:** Run: `npm test -- tests/engines/findLeads.test.js`. Expect full pass of findLeads-specific tests (was 9 tests incl. new disqualifier + fails-fast).

- [ ] **Step 9:** Commit:

```bash
git add src/engines/findLeads.js tests/engines/findLeads.test.js tests/engines/insertLead.test.js
git commit -m "feat(findLeads): rewrite all queries to prisma; simplify insertLead"
```

### Task 4.2: Rewrite `src/engines/sendEmails.js`

**Files:**
- Modify: `src/engines/sendEmails.js`
- Modify: `tests/engines/sendEmails.test.js`

This file has 6 pre-existing failing tests (baseline). Fix them if rescaling to Prisma resolves them; document which remain failing if not.

- [ ] **Step 1:** Rewrite queries. Key spots:
- The `ORDER BY l.icp_priority ASC, l.icp_score DESC` ready-leads query: `prisma.lead.findMany({ where: { status: 'ready' }, include: { emails: { where: { status: 'pending', sequenceStep: 0 } } }, orderBy: [{ icpPriority: 'asc' }, { icpScore: 'desc' }] })`.
- Per-send `await todayBounceRate()` check — keep as-is but ensure awaited.
- Email row creation after send: `prisma.email.update({ where: { id }, data: { status: 'sent', sentAt: new Date(), ... } })`.
- Bounce row on 5xx: `prisma.bounce.create({...})` + `await addToRejectList(email, 'hard bounce')`.

- [ ] **Step 2:** Make top-level `async`.

- [ ] **Step 3:** Update test fixture to Postgres. The `icp_score: 80, 70` seeds from the ICP v2 rescale stay (they're already on the new scale).

- [ ] **Step 4:** Run: `npm test -- tests/engines/sendEmails.test.js`. Note which tests pass/fail — the 6 pre-existing failures may or may not resolve.

- [ ] **Step 5:** Commit:

```bash
git add src/engines/sendEmails.js tests/engines/sendEmails.test.js
git commit -m "feat(sendEmails): rewrite queries with prisma, async throughout"
```

### Task 4.3: Rewrite `src/engines/sendFollowups.js`

**Files:**
- Modify: `src/engines/sendFollowups.js`
- Modify: `tests/engines/sendFollowups.test.js`

4 pre-existing failing tests. Same treatment as sendEmails.

- [ ] **Step 1:** Rewrite. Sequence state upserts use `prisma.sequenceState.upsert({ where: { leadId }, create: {...}, update: {...} })`. Threading headers (`inReplyTo`, `references`) are pure JS — untouched.

- [ ] **Step 2:** Run: `npm test -- tests/engines/sendFollowups.test.js`.

- [ ] **Step 3:** Commit:

```bash
git add src/engines/sendFollowups.js tests/engines/sendFollowups.test.js
git commit -m "feat(sendFollowups): rewrite queries with prisma, async throughout"
```

---

## Chunk 5: Engine rewrites — checkReplies, dailyReport, healthCheck, cron

### Task 5.1: Rewrite `src/engines/checkReplies.js`

- [ ] Standard pattern. `prisma.reply.create`. Unsubscribe → `await addToRejectList`. Telegram code untouched.

- [ ] Tests + commit:

```bash
npm test -- tests/engines/checkReplies.test.js
git add src/engines/checkReplies.js tests/engines/checkReplies.test.js
git commit -m "feat(checkReplies): rewrite queries with prisma, async throughout"
```

### Task 5.2: Rewrite `src/engines/dailyReport.js`

- [ ] Heavy aggregation. Use `prisma.email.aggregate({ _count: true, where: {...} })` or `prisma.email.count`. For SUMs: `prisma.dailyMetrics.findUnique({ where: { date } })` and sum Decimal columns in JS via `Number(...)`.

- [ ] Tests + commit:

```bash
npm test -- tests/engines/dailyReport.test.js
git add src/engines/dailyReport.js tests/engines/dailyReport.test.js
git commit -m "feat(dailyReport): rewrite queries with prisma, async throughout"
```

### Task 5.3: Rewrite `src/engines/healthCheck.js`

- [ ] Blacklist hit write:

```js
await prisma.dailyMetrics.upsert({
  where: { date: today() },
  create: { date: today(), domainBlacklisted: true, blacklistZones: zones },
  update: { domainBlacklisted: true, blacklistZones: zones },
});
await prisma.config.upsert({
  where: { key: 'daily_send_limit' },
  create: { key: 'daily_send_limit', value: '0' },
  update: { value: '0' },
});
```

- [ ] Commit (no dedicated test):

```bash
git add src/engines/healthCheck.js
git commit -m "feat(healthCheck): rewrite queries with prisma, async throughout"
```

### Task 5.4: Rewrite `src/scheduler/cron.js`

- [ ] Wrap every scheduled callback in `async () => { try { await engineFn(); } catch (err) { await logError('cron', err, { jobName }); } }`.

- [ ] Commit:

```bash
git add src/scheduler/cron.js
git commit -m "feat(cron): await async engines, catch + log unhandled rejections"
```

---

## Chunk 6: API routes rewrite (16 files)

Each route file follows the same pattern: import `getPrisma` from `../../core/db/index.js`, make every handler `async`, replace `db.prepare().all/get/run` with Prisma calls.

**Commit cadence:** 3-4 commits grouped by functional area.

### Task 6.1: Simple routes (auth, niches, icpRules, offer, icpProfile, config, health, sequences)

**Files:**
- `src/api/routes/auth.js` (JWT — probably no DB changes)
- `src/api/routes/niches.js`
- `src/api/routes/icpRules.js`
- `src/api/routes/offer.js`
- `src/api/routes/icpProfile.js`
- `src/api/routes/config.js`
- `src/api/routes/health.js`
- `src/api/routes/sequences.js`

- [ ] Rewrite each. `offer.js` and `icpProfile.js` specifically: the `serialize()` helper that parses JSON fields goes away entirely (Prisma returns them parsed). `config.js`'s `icp_weights` validation stays; the INSERT OR REPLACE becomes `prisma.config.upsert(...)`.

- [ ] Tests: `npm test -- tests/api/`. Goal: preserve current pass count (29+).

- [ ] Commit:

```bash
git add src/api/routes/{auth,niches,icpRules,offer,icpProfile,config,health,sequences}.js tests/api/
git commit -m "feat(api): rewrite singleton/simple routes to prisma"
```

### Task 6.2: Data-heavy routes (leads, sendLog, replies, errors, costs, overview)

**Files:**
- `src/api/routes/leads.js`
- `src/api/routes/sendLog.js`
- `src/api/routes/replies.js`
- `src/api/routes/errors.js`
- `src/api/routes/costs.js`
- `src/api/routes/overview.js`

- [ ] Rewrite. `leads.js` paginated queries: `prisma.lead.findMany({ where, skip, take, orderBy })`. `sendLog.js` joins: `include: { lead: true }`.

- [ ] Commit:

```bash
git add src/api/routes/{leads,sendLog,replies,errors,costs,overview}.js
git commit -m "feat(api): rewrite data-heavy routes to prisma"
```

### Task 6.3: Analytical routes (funnel, cronStatus)

- [ ] `funnel.js`: `GROUP BY icp_score` → `prisma.lead.groupBy({ by: ['icpScore'], _count: true })`.

- [ ] `cronStatus.js`: The "NOT TRIGGERED" detection (`scheduled_at > 30min ago + no cron_log row today`) — translate carefully:

```js
async function cronJobStatus(jobName, scheduledHour, scheduledMinute) {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const scheduledToday = new Date(startOfDay);
  scheduledToday.setHours(scheduledHour, scheduledMinute, 0, 0);

  const row = await prisma.cronLog.findFirst({
    where: { jobName, scheduledAt: { gte: startOfDay } },
    orderBy: { scheduledAt: 'desc' },
  });
  if (row) return row;

  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
  if (scheduledToday < thirtyMinAgo) {
    return { jobName, status: 'NOT_TRIGGERED', scheduledAt: scheduledToday };
  }
  return { jobName, status: 'PENDING', scheduledAt: scheduledToday };
}
```

- [ ] Commit:

```bash
git add src/api/routes/{funnel,cronStatus}.js
git commit -m "feat(api): rewrite analytical routes (funnel, cronStatus) to prisma"
```

### Task 6.4: `src/api/server.js` bootstrap

- [ ] Remove any `getDb()` imports. Remove any `initSchema()` calls (Prisma migrations handle schema). Add a `prisma.$disconnect()` on process shutdown.

- [ ] Commit:

```bash
git add src/api/server.js
git commit -m "feat(api): swap server bootstrap to prisma client"
```

---

## Chunk 7: Ops + Cleanup + Local Green

### Task 7.1: Rewrite `infra/backup.sh`

- [ ] Replace SQLite file-copy with `pg_dump --format=custom --compress=9 | rclone rcat b2:...`. Credentials via `~/.pgpass` (not `.env`).

- [ ] Commit:

```bash
git add infra/backup.sh
git commit -m "feat(backup): replace sqlite file-copy with pg_dump to B2"
```

### Task 7.2: Clean up stale files

- [ ] `git rm db/schema.sql` — Prisma is source of truth.
- [ ] Remove `DB_PATH` from `.env.example`.
- [ ] Port `scripts/testFindLeads.js` and `scripts/testFullPipeline.js` if still useful; otherwise delete.

- [ ] Commit:

```bash
git add .env.example scripts/
git rm db/schema.sql
git commit -m "chore(db): remove legacy schema.sql + port ad-hoc test scripts"
```

### Task 7.3: Full regression check

- [ ] Run: `npm test`. Target:
  - Previously 146 pass + 10 fail (baseline).
  - Expect: same or better. If worse, triage before declaring done.

- [ ] Grep for stragglers:

```bash
grep -rn "getDb\|initSchema\|better-sqlite3" --include="*.js" . | grep -v node_modules
```

Expected: zero hits in `src/**` and `tests/**`. Only `package.json` / `package-lock.json` may still mention `better-sqlite3` (handled next).

- [ ] End-to-end smoke against local Postgres:

```bash
# Seed
node -e "(async () => { const m = await import('./src/core/db/index.js'); await m.seedConfigDefaults(); await m.seedNichesAndIcpRules(); await m.resetDb(); })()"

# Set small lead count
psql -U radar -d radar -c "UPDATE config SET value='3' WHERE key='find_leads_count';"

# Run (optional, costs Gemini $)
# node src/engines/findLeads.js
```

- [ ] Tag clean state:

```bash
git tag postgres-local-green
```

### Task 7.4: Remove `better-sqlite3`

- [ ] `npm uninstall better-sqlite3`
- [ ] `git add package.json package-lock.json`
- [ ] Commit:

```bash
git commit -m "chore(db): remove better-sqlite3 dependency"
```

### Task 7.5: **STOP HERE** — VPS cutover deferred

Per gap-analysis §8, the VPS cutover (original plan Task 7.4) is deferred until user confirms current production host. Do NOT execute Phase 2 in this plan session.

When user is ready for VPS cutover:
1. Confirm current VPS host (`CLAUDE.md` notes "being migrated to personal server")
2. Follow the Phase 2 steps from original plan v1 with all paths updated per gap-analysis
3. 48-hour watch period before deleting `db/radar.sqlite` on the VPS

---

## Verification Checklist (local-green acceptance)

- [ ] `prisma/schema.prisma` contains all 14 models (12 original + Offer + IcpProfile)
- [ ] `Lead` model has all 36+ fields including 6 ICP v2 additions
- [ ] `prisma migrate deploy` runs cleanly on a fresh DB
- [ ] `npm test` matches or beats the 146 pass / 10 fail baseline
- [ ] `src/core/db/index.js` exports every helper the SQLite version did (plus `bumpCostMetric`)
- [ ] All 6 engines async throughout
- [ ] All 16 API route files async throughout
- [ ] `src/core/ai/icpScorer.js` uses Prisma; no raw SQL
- [ ] `scripts/rescoreLeads.js` uses `prisma.$transaction` for atomicity
- [ ] `src/scheduler/cron.js` awaits each engine + catches + logs errors
- [ ] `infra/backup.sh` produces a restorable `pg_dump` archive
- [ ] No `getDb`, `initSchema`, or `better-sqlite3` references anywhere in source
- [ ] Non-negotiable rules from CLAUDE.md §13 still hold (content validator, bounce hard-stop, reject-list, DAILY_SEND_LIMIT=0)

When all boxes ticked → `git tag postgres-local-green` → hand off to user for VPS cutover decision.
