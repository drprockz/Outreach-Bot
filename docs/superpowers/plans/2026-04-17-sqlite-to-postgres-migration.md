# SQLite → PostgreSQL + Prisma Migration — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace better-sqlite3 with self-hosted PostgreSQL 16 + Prisma ORM across the Radar outreach system, preserving all 12 table schemas and every existing helper behavior.

**Architecture:** Prisma `schema.prisma` becomes the source of truth. A single `PrismaClient` singleton is exported from `utils/db.js` and reused across PM2 processes. Every engine script, utility module, and dashboard route becomes async. No data migration — fresh-start on Postgres.

**Tech Stack:** PostgreSQL 16, Prisma ORM, Node.js ESM, Vitest, Docker (local dev), PM2 (production).

**Spec:** [`docs/superpowers/specs/2026-04-17-sqlite-to-postgres-migration-design.md`](../specs/2026-04-17-sqlite-to-postgres-migration-design.md)

---

## Ground Rules

- **Exact file paths always** — every task references the real file under `/home/darshanparmar/Projects/Outreach-Bot/` (local) or the equivalent `/home/radar/` (production).
- **Commit after every task** — tiny, reversible commits make rollback trivial.
- **Run the existing Vitest suite** after each engine rewrite — the tests ARE the regression harness. If a test breaks, fix it before moving on.
- **No behavior changes** — this migration is a pure refactor. Rate limits, send windows, content validation, bounce hard-stops, and reject-list semantics all stay byte-identical.
- **Keep `db/radar.sqlite` untouched** until Chunk 7 — it's the rollback anchor.

---

## Chunk 1: Foundation (Prisma + Schema + Test Fixture)

### Task 1.1: Install Prisma and scaffold

**Files:**
- Modify: `package.json`
- Create: `prisma/schema.prisma`
- Create: `.env` (add `DATABASE_URL`)
- Create: `.env.example` (add `DATABASE_URL` entry)

- [ ] **Step 1: Install Prisma packages**

Run:
```bash
cd /home/darshanparmar/Projects/Outreach-Bot
npm install @prisma/client
npm install --save-dev prisma
```

Expected: `@prisma/client` in `dependencies`, `prisma` in `devDependencies`. Do NOT remove `better-sqlite3` yet — it must keep working until Chunk 7.

- [ ] **Step 2: Start a local Postgres 16 container**

Run:
```bash
docker run -d --name radar-pg \
  -e POSTGRES_USER=radar \
  -e POSTGRES_PASSWORD=radar_dev \
  -e POSTGRES_DB=radar \
  -p 5432:5432 \
  postgres:16
```

Expected: container running. Verify with `docker ps | grep radar-pg`.

- [ ] **Step 3: Add DATABASE_URL to `.env`**

Add these two lines to `.env`:
```
DATABASE_URL="postgresql://radar:radar_dev@127.0.0.1:5432/radar?schema=public"
DATABASE_URL_TEST="postgresql://radar:radar_dev@127.0.0.1:5432/radar_test?schema=public"
```

And to `.env.example` (the version that's committed to git, without real secrets):
```
DATABASE_URL="postgresql://radar:CHANGE_ME@127.0.0.1:5432/radar?schema=public"
DATABASE_URL_TEST="postgresql://radar:CHANGE_ME@127.0.0.1:5432/radar_test?schema=public"
```

Do NOT yet remove `DB_PATH` — it's still used until `utils/db.js` is rewritten.

- [ ] **Step 4: Create the `radar_test` database**

Run:
```bash
docker exec radar-pg psql -U radar -c "CREATE DATABASE radar_test;"
```

Expected: `CREATE DATABASE`.

- [ ] **Step 5: Commit**

```bash
git checkout -b postgres-migration
git add package.json package-lock.json .env.example
git commit -m "chore(db): install prisma + configure DATABASE_URL"
```

(Note: `.env` stays uncommitted per existing `.gitignore`.)

---

### Task 1.2: Author `prisma/schema.prisma`

**Files:**
- Create: `prisma/schema.prisma`

This is the single largest change in the plan. Translate every table from `db/schema.sql` applying the type mapping in the spec.

- [ ] **Step 1: Write `prisma/schema.prisma`**

Create `prisma/schema.prisma` with the following content. Note the `@map` directives on every model so Postgres table names stay snake_case (matching `db/schema.sql`), while Prisma models use camelCase.

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

  contactName           String?   @map("contact_name")
  contactEmail          String?   @map("contact_email")
  contactConfidence     String?   @map("contact_confidence")
  contactSource         String?   @map("contact_source")

  emailStatus           String?   @map("email_status")
  emailVerifiedAt       DateTime? @db.Timestamptz(6) @map("email_verified_at")

  status                String    @default("discovered")

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

// ────────────────── ICP RULES ──────────────────
model IcpRule {
  id          Int      @id @default(autoincrement())
  label       String
  points      Int
  description String?
  enabled     Boolean  @default(true)
  sortOrder   Int      @default(0) @map("sort_order")

  @@map("icp_rules")
}
```

- [ ] **Step 2: Generate initial migration**

Run:
```bash
npx prisma migrate dev --name init
```

Expected: migration folder created at `prisma/migrations/<timestamp>_init/migration.sql`; schema applied to local `radar` DB; Prisma Client generated at `node_modules/@prisma/client`.

- [ ] **Step 3: Manually verify the generated SQL**

Run:
```bash
cat prisma/migrations/*_init/migration.sql | head -50
```

Expected: `CREATE TABLE "leads"` etc. Confirm table names are snake_case (from `@@map`) and column names are snake_case (from `@map`).

- [ ] **Step 4: Apply same migration to the test DB**

Run:
```bash
DATABASE_URL="$DATABASE_URL_TEST" npx prisma migrate deploy
```

Expected: migration applied to `radar_test` database.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(db): add prisma schema for all 12 tables"
```

---

### Task 1.3: Add a Postgres-backed test fixture

The current test suite uses `DB_PATH` + `resetDb()` + `initSchema()`. For Postgres, we need a helper that truncates all tables between tests (full schema recreation per test is too slow).

**Files:**
- Create: `tests/helpers/testDb.js`

- [ ] **Step 1: Write the test helper**

Create `tests/helpers/testDb.js`:

```js
// Test helper: provides a fresh Postgres state per test by truncating all tables.
// Assumes DATABASE_URL_TEST points at a DB with migrations already applied.
import { PrismaClient } from '@prisma/client';

// Force prisma to use the test URL regardless of how tests are invoked
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

// Ordered so that children are truncated before parents (RESTART IDENTITY resets autoincrement).
const TABLES = [
  'bounces', 'replies', 'sequence_state', 'emails', 'leads',
  'reject_list', 'cron_log', 'daily_metrics', 'error_log',
  'config', 'niches', 'icp_rules',
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

- [ ] **Step 2: Add npm script to reset the test DB**

Modify `package.json` `scripts`:

```json
"scripts": {
  "test": "vitest run",
  "test:watch": "vitest",
  "test:db:reset": "DATABASE_URL=\"$DATABASE_URL_TEST\" prisma migrate reset --force --skip-seed"
}
```

- [ ] **Step 3: Smoke-test the fixture**

Create `tests/helpers/testDb.test.js`:

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
});
```

- [ ] **Step 4: Run the smoke test**

Run:
```bash
npm test -- tests/helpers/testDb.test.js
```

Expected: 2 tests pass. If they don't: verify `DATABASE_URL_TEST` is set in `.env` and `radar_test` has migrations applied.

- [ ] **Step 5: Commit**

```bash
git add tests/helpers/ package.json
git commit -m "test(db): add postgres test fixture with truncate-per-test"
```

---

## Chunk 2: `utils/db.js` Rewrite

### Task 2.1: Rewrite `utils/db.js` to export PrismaClient singleton

**Files:**
- Modify: `utils/db.js`
- Modify: `tests/utils/db.test.js`

This is the keystone task — every other module imports from here. Port every helper from the current file to Prisma with the same call signature. Helpers become `async` (breaking change — callers in later tasks will `await` them).

- [ ] **Step 1: Rewrite `utils/db.js`**

Overwrite `utils/db.js` with:

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

// Convenience: `import { prisma } from './utils/db.js'`
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

// Consolidated cost-metric bump (replaces 3 near-identical UPSERTs).
// Always increments the named column AND `totalApiCostUsd` atomically.
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
      errorMessage: err.message || String(err),
      stackTrace: err.stack ?? null,
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
    ['icp_threshold_a', '7'],
    ['icp_threshold_b', '4'],
    ['find_leads_per_batch', '30'],
    ['find_leads_cities',        '["Mumbai","Bangalore","Delhi NCR","Pune"]'],
    ['find_leads_business_size', 'msme'],
    ['find_leads_count',         '150'],
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
}

export async function seedNichesAndIcpRules() {
  const prisma = getPrisma();

  const nicheCount = await prisma.niche.count();
  if (nicheCount === 0) {
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

  const ruleCount = await prisma.icpRule.count();
  if (ruleCount === 0) {
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
}
```

**Note:** `getDb()` is removed. Callers must switch to either `getPrisma()` or the `prisma` named export (they're equivalent; `prisma` is nicer syntax). `initSchema()` is also removed — Prisma migrations replace it.

- [ ] **Step 2: Rewrite `tests/utils/db.test.js`**

Overwrite with a Prisma-aware version that uses the test fixture:

```js
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { truncateAll, closeTestPrisma } from '../helpers/testDb.js';
import {
  resetDb, today, logError, isRejected, addToRejectList,
  bumpMetric, bumpCostMetric, todaySentCount, todayBounceRate,
  getConfigMap, seedConfigDefaults, seedNichesAndIcpRules, getPrisma,
} from '../../utils/db.js';

beforeEach(async () => { await truncateAll(); await resetDb(); });
afterAll(async () => { await resetDb(); await closeTestPrisma(); });

describe('db helpers', () => {
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

  it('seedConfigDefaults is idempotent', async () => {
    await seedConfigDefaults();
    await seedConfigDefaults();
    const cfg = await getConfigMap();
    expect(cfg['daily_send_limit']).toBe('0');
  });

  it('seedNichesAndIcpRules seeds 6 niches + 8 rules', async () => {
    await seedNichesAndIcpRules();
    expect(await getPrisma().niche.count()).toBe(6);
    expect(await getPrisma().icpRule.count()).toBe(8);
  });
});
```

- [ ] **Step 3: Run the new db tests**

Run:
```bash
npm test -- tests/utils/db.test.js
```

Expected: all tests pass. If `logError` complains about unknown fields, check your Prisma schema camelCase conversions.

- [ ] **Step 4: Commit**

```bash
git add utils/db.js tests/utils/db.test.js
git commit -m "feat(db): rewrite utils/db.js to use PrismaClient"
```

---

## Chunk 3: Cost-Tracking Utilities (`utils/claude.js`, `utils/mev.js`)

### Task 3.1: Rewrite `utils/claude.js`

**Files:**
- Modify: `utils/claude.js`
- Modify: `tests/utils/claude.test.js`

- [ ] **Step 1: Read the current `utils/claude.js`**

Run:
```bash
cat /home/darshanparmar/Projects/Outreach-Bot/utils/claude.js
```

Identify every call that uses `getDb()` / `prepare()` / raw SQL against `daily_metrics`. There will be an UPSERT on Sonnet/Haiku cost columns and a read for the spend cap.

- [ ] **Step 2: Replace raw SQL with `bumpCostMetric` + Prisma reads**

Every UPSERT like:
```js
db.prepare(`INSERT INTO daily_metrics (date, sonnet_cost_usd, total_api_cost_usd) VALUES (?, ?, ?) ON CONFLICT(date) DO UPDATE SET ...`).run(...)
```
becomes:
```js
await bumpCostMetric('sonnetCostUsd', costUsd); // or 'haikuCostUsd'
```

Every spend-cap read like:
```js
const row = db.prepare(`SELECT total_api_cost_usd FROM daily_metrics WHERE date=?`).get(today());
```
becomes:
```js
const row = await getPrisma().dailyMetrics.findUnique({ where: { date: today() }, select: { totalApiCostUsd: true } });
```

Make every exported function `async`. Update imports at the top:
```js
import { bumpCostMetric, getPrisma, today, logError } from './db.js';
```

- [ ] **Step 3: Update `tests/utils/claude.test.js`**

Switch from SQLite-based setup to the new fixture:
```js
import { beforeEach, afterAll } from 'vitest';
import { truncateAll, closeTestPrisma } from '../helpers/testDb.js';
import { resetDb } from '../../utils/db.js';

beforeEach(async () => { await truncateAll(); await resetDb(); });
afterAll(async () => { await resetDb(); await closeTestPrisma(); });
```
Await every call into `utils/claude.js`. If tests mock the Anthropic SDK, keep that mocking intact — only change the DB side.

- [ ] **Step 4: Run tests**

```bash
npm test -- tests/utils/claude.test.js
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add utils/claude.js tests/utils/claude.test.js
git commit -m "feat(claude): async + prisma for daily_metrics cost tracking"
```

### Task 3.2: Rewrite `utils/mev.js`

**Files:**
- Modify: `utils/mev.js`
- Modify: `tests/utils/mev.test.js`

- [ ] **Step 1: Same mechanical rewrite**

Replace the `daily_metrics` UPSERT with `await bumpCostMetric('mevCostUsd', costUsd)`. Make the exported verify-function `async` (it probably already is). Update imports: `import { bumpCostMetric } from './db.js';`.

- [ ] **Step 2: Update `tests/utils/mev.test.js`**

Same pattern as `claude.test.js` — swap fixture, await calls.

- [ ] **Step 3: Run tests**

```bash
npm test -- tests/utils/mev.test.js
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add utils/mev.js tests/utils/mev.test.js
git commit -m "feat(mev): async + prisma for daily_metrics cost tracking"
```

---

## Chunk 4: Engines — `findLeads`, `sendEmails`, `sendFollowups`

Each engine is rewritten in the same pattern:
1. Replace `getDb().prepare('...').run(...)` / `.get(...)` / `.all(...)` with Prisma equivalents.
2. Add `await` everywhere.
3. Promote the top-level function to `async` if not already.
4. Re-run the existing `.test.js` file and fix any breakage.

**Await Audit Per File** — BEFORE committing each engine, run this grep to verify every newly-async helper call is awaited (missing `await` on a promise-returning call becomes a silent unhandled rejection that corrupts state):
```bash
grep -nE "bumpMetric|bumpCostMetric|logError|addToRejectList|isRejected|logCron|finishCron|todaySentCount|todayBounceRate|getConfigMap|seedConfigDefaults|seedNichesAndIcpRules" <file>.js
```
Every hit must be either preceded by `await` on the same line, or appear inside a `const x = ...; await x;` pattern. Non-await matches (e.g. `import` lines) are fine.

### Task 4.1: Rewrite `findLeads.js`

**Files:**
- Modify: `findLeads.js`
- Modify: `tests/findLeads.test.js` (only the fixture/setup — assertions stay)

- [ ] **Step 1: Walk the file top-to-bottom**

For each statement matching `db.prepare` or `getDb()`, replace with a Prisma call. Common patterns:

| SQLite | Prisma |
|---|---|
| `.all()` | `findMany` |
| `.get()` | `findFirst` or `findUnique` |
| `.run()` insert | `create` / `createMany` |
| `.run()` update | `update` / `updateMany` |
| `.run()` with `ON CONFLICT` | `upsert` |
| `datetime('now')` | `new Date()` or rely on `@default(now())` |
| Boolean column writes (currently `0`/`1`) | write `true` / `false` |
| JSON array columns (currently stringified `JSON.stringify(arr)`) | write the raw array (Prisma serializes `Json`) |

- [ ] **Step 2: Make `runFindLeads()` (or equivalent) async and await internal calls**

Including `bumpMetric`, `logError`, `logCron`, `finishCron`, `addToRejectList`, `isRejected` — all now async.

- [ ] **Step 3: Update `tests/findLeads.test.js` fixture**

If the test file touches the DB, swap its setup to use `tests/helpers/testDb.js`. If it only tests the pure `buildDiscoveryPrompt` function (as the current `findLeads.test.js` at the repo root does), no changes needed.

- [ ] **Step 4: Run tests**

```bash
npm test -- findLeads.test.js tests/findLeads.test.js
```

Expected: all pass.

- [ ] **Step 5: Run an end-to-end smoke test against local Postgres**

Create a tiny runner `smoke/findLeads-smoke.js` (delete after verifying) or reuse `testFindLeads.js` with a 3-lead cap via `find_leads_count=3` in the `config` table. Run:

```bash
node testFindLeads.js
```

Expected: completes without throwing; `leads` table has new rows; `daily_metrics` has a row for today.

- [ ] **Step 6: Commit**

```bash
git add findLeads.js tests/findLeads.test.js
git commit -m "feat(findLeads): rewrite queries with prisma, async throughout"
```

### Task 4.2: Rewrite `sendEmails.js`

**Files:**
- Modify: `sendEmails.js`
- Modify: `tests/sendEmails.test.js`

- [ ] **Step 1: Same rewrite pattern**

Pay extra attention to:
- The `todayBounceRate()` check before each send — now async, must be awaited inside the per-lead loop
- The `ORDER BY icpPriority ASC, icpScore DESC` query — use `prisma.lead.findMany({ orderBy: [{ icpPriority: 'asc' }, { icpScore: 'desc' }] })`
- Email row creation after a successful send — use `prisma.email.create`
- Bounce row creation on 5xx — use `prisma.bounce.create`, also call `addToRejectList`

- [ ] **Step 2: Make top-level `async`**

- [ ] **Step 3: Run tests**

```bash
npm test -- tests/sendEmails.test.js
```

Expected: all pass. If tests assert against the DB, use the new fixture.

- [ ] **Step 4: Commit**

```bash
git add sendEmails.js tests/sendEmails.test.js
git commit -m "feat(sendEmails): rewrite queries with prisma, async throughout"
```

### Task 4.3: Rewrite `sendFollowups.js`

**Files:**
- Modify: `sendFollowups.js`
- Modify: `tests/sendFollowups.test.js`

- [ ] **Step 1: Same rewrite pattern**

Pay attention to `sequence_state` upserts — use `prisma.sequenceState.upsert({ where: { leadId }, create: {...}, update: {...} })`. The `inReplyTo` + `references` header chain logic is pure JS and stays untouched.

- [ ] **Step 2: Run tests**

```bash
npm test -- tests/sendFollowups.test.js
```

Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add sendFollowups.js tests/sendFollowups.test.js
git commit -m "feat(sendFollowups): rewrite queries with prisma, async throughout"
```

---

## Chunk 5: Engines — `checkReplies`, `dailyReport`, `healthCheck`, `cron.js`

### Task 5.1: Rewrite `checkReplies.js`

**Files:**
- Modify: `checkReplies.js`
- Modify: `tests/checkReplies.test.js`

- [ ] **Step 1: Rewrite**

Standard pattern. Reply-writes use `prisma.reply.create`. Unsubscribe path calls `addToRejectList` (now async). Telegram alert code is untouched.

- [ ] **Step 2: Tests + commit**

```bash
npm test -- tests/checkReplies.test.js
git add checkReplies.js tests/checkReplies.test.js
git commit -m "feat(checkReplies): rewrite queries with prisma, async throughout"
```

### Task 5.2: Rewrite `dailyReport.js`

**Files:**
- Modify: `dailyReport.js`
- Modify: `tests/dailyReport.test.js`

- [ ] **Step 1: Rewrite**

This engine does heavy aggregation — `COUNT(*)`, `SUM(...)`. Use Prisma `aggregate` / `groupBy`:
```js
await prisma.email.aggregate({ _count: true, where: { status: 'sent', sentAt: { gte: startOfDay } } });
```
The Telegram + email-digest HTML generation is untouched.

- [ ] **Step 2: Tests + commit**

```bash
npm test -- tests/dailyReport.test.js
git add dailyReport.js tests/dailyReport.test.js
git commit -m "feat(dailyReport): rewrite queries with prisma, async throughout"
```

### Task 5.3: Rewrite `healthCheck.js`

**Files:**
- Modify: `healthCheck.js`

- [ ] **Step 1: Rewrite**

On blacklist hit, currently writes `domain_blacklisted=1` and `blacklist_zones=JSON.stringify(zones)` to `daily_metrics`. Use `upsert` so it works even on a day with no prior `bumpMetric` calls:
```js
await prisma.dailyMetrics.upsert({
  where: { date: today() },
  create: { date: today(), domainBlacklisted: true, blacklistZones: zones },
  update: { domainBlacklisted: true, blacklistZones: zones },
});
```
Also writes `daily_send_limit=0` to the `config` table (non-negotiable rule #11 from CLAUDE.md §13):
```js
await prisma.config.upsert({ where: { key: 'daily_send_limit' }, create: { key: 'daily_send_limit', value: '0' }, update: { value: '0' } });
```

- [ ] **Step 2: Commit** (no existing test file for this engine)

```bash
git add healthCheck.js
git commit -m "feat(healthCheck): rewrite queries with prisma, async throughout"
```

### Task 5.4: Rewrite `cron.js`

**Files:**
- Modify: `cron.js`

- [ ] **Step 1: `await` each engine**

Wrap every `node-cron` callback so it awaits. Example:
```js
// Before
cron.schedule('0 9 * * 1-6', () => { runFindLeads(); });

// After
cron.schedule('0 9 * * 1-6', async () => {
  try { await runFindLeads(); }
  catch (err) { await logError('cron', err, { jobName: 'findLeads' }); }
});
```

Every engine that was previously fire-and-forget now must be awaited. Errors inside a scheduled task would otherwise become unhandled rejections.

- [ ] **Step 2: Commit**

```bash
git add cron.js
git commit -m "feat(cron): await async engines, catch + log unhandled rejections"
```

---

## Chunk 6: Dashboard API

### Task 6.1: Rewrite `dashboard/server.js`

**Files:**
- Modify: `dashboard/server.js`
- Modify: `tests/dashboard/api.test.js`

The dashboard is the longest single file (834 lines) and has the most queries. Rewrite in logical passes rather than one pass.

- [ ] **Step 1: Swap imports**

```js
// Before
import { getDb, ... } from '../utils/db.js';
const db = getDb();
// After
import { getPrisma, ... } from '../utils/db.js';
const prisma = getPrisma();
```

Make every Express route handler `async` and `await` every DB call.

- [ ] **Step 2: Rewrite route-by-route**

Group work by the dashboard pages in CLAUDE.md §11:

- **Overview** — funnel counts (aggregate queries), metric cards, heatmap
- **Lead Pipeline** — paginated leads table with filters → `prisma.lead.findMany({ where, skip, take, orderBy })`
- **Send Log** — email rows joined with lead → `prisma.email.findMany({ include: { lead: true } })`
- **Reply Feed** — same include pattern
- **Sequence Tracker** — `prisma.sequenceState.findMany({ include: { lead: true } })`
- **Cron Job Status** — includes the "NOT TRIGGERED" detection below
- **Health Monitor** — reads `daily_metrics` + `config`
- **Cost Tracker** — `daily_metrics` aggregates
- **Error Log** — `prisma.errorLog.findMany`

- [ ] **Step 3: Implement "NOT TRIGGERED" detection**

Per CLAUDE.md §11: for each of 9 scheduled jobs, if `scheduled_at` was >30 minutes ago AND no `cron_log` row exists for today → `NOT TRIGGERED`.

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

- [ ] **Step 4: Run dashboard API tests**

```bash
npm test -- tests/dashboard/api.test.js
```

Expected: all pass. If tests used supertest against the Express app, the fixture should truncate between tests and seed fresh data per test.

- [ ] **Step 5: Manual click-through**

Start the dashboard locally:
```bash
cd dashboard && npm run dev    # or whatever vite runs
# In another terminal
node dashboard/server.js
```

Open each page in a browser. Verify:
- Zero-row state (empty DB) renders without errors
- After seeding 3 leads + 1 email + 1 reply manually via `psql`, every card shows the right count

- [ ] **Step 6: Commit**

```bash
git add dashboard/server.js tests/dashboard/api.test.js
git commit -m "feat(dashboard): rewrite express api with prisma"
```

---

## Chunk 7: Ops, Cutover, Cleanup

### Task 7.1: Rewrite `backup.sh`

**Files:**
- Modify: `backup.sh`

- [ ] **Step 1: Replace content**

```bash
#!/bin/bash
set -euo pipefail
TS=$(date +%Y%m%d-%H%M%S)
# Credentials sourced from ~/.pgpass (chmod 600) — NOT .env, because
# this script runs under shell cron outside PM2's env.
pg_dump \
  -h 127.0.0.1 -U radar -d radar \
  --format=custom --compress=9 \
  | rclone rcat "b2:radar-backups/radar-${TS}.dump"
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x backup.sh
```

- [ ] **Step 3: Local dry-run**

Temporarily swap `rclone rcat …` for `> /tmp/radar-test.dump`. Run:
```bash
./backup.sh
ls -la /tmp/radar-test.dump
```
Expected: non-zero file created. Restore original `rclone` line.

- [ ] **Step 4: Commit**

```bash
git add backup.sh
git commit -m "feat(backup): replace sqlite file-copy with pg_dump to B2"
```

### Task 7.2: Clean up stale files

**Files:**
- Delete (git rm): `db/schema.sql`
- Modify: `testFindLeads.js`, `testFullPipeline.js`
- Modify: `.env.example` (remove `DB_PATH`)

- [ ] **Step 1: Port ad-hoc test scripts**

`testFindLeads.js` and `testFullPipeline.js` both import from `utils/db.js`. Swap `initSchema()` calls for a no-op (schema is now applied via `prisma migrate deploy`), swap raw SQL for Prisma, and await everywhere. If these scripts were one-off debugging tools, confirm with a quick run whether they still have value; if not, git-rm them.

- [ ] **Step 2: Remove `DB_PATH` from `.env.example`**

Delete the line if present. Do NOT delete `DB_PATH` from `.env` yet (safety).

- [ ] **Step 3: Delete `db/schema.sql`**

```bash
git rm db/schema.sql
```

Prisma is the source of truth now. Migrations under `prisma/migrations/` replace it.

- [ ] **Step 4: Commit**

```bash
git add .env.example testFindLeads.js testFullPipeline.js
git commit -m "chore(db): remove legacy schema.sql + port ad-hoc test scripts"
```

### Task 7.3: Full local regression

- [ ] **Step 1: Run the full test suite**

```bash
npm test
```

Expected: all tests pass — including `utils/concurrency.test.js` (which doesn't touch the DB directly but runs in the same Vitest process). Every previously-passing test should still pass. If any fail: the failure is real — diagnose before continuing.

- [ ] **Step 1a: Verify no stragglers reference the old API**

```bash
grep -rn "getDb\|initSchema\|better-sqlite3" --include="*.js" . | grep -v node_modules
```
Expected: only `package.json` lockfile entries (handled in Task 7.5) should still mention `better-sqlite3`. Zero hits in source files. Any `getDb` / `initSchema` hit is a missed rewrite — fix before proceeding.

- [ ] **Step 2: End-to-end smoke**

In order, against local Docker Postgres:
1. Seed config:
   ```bash
   node -e "(async () => { const m = await import('./utils/db.js'); await m.seedConfigDefaults(); await m.seedNichesAndIcpRules(); await m.resetDb(); })()"
   ```
2. Set `find_leads_count=3` in `config` table via psql:
   ```bash
   docker exec radar-pg psql -U radar -d radar -c "UPDATE config SET value='3' WHERE key='find_leads_count';"
   ```
3. `node findLeads.js` — creates 3 leads
4. `node sendEmails.js` — with `DAILY_SEND_LIMIT=0` (default), exits cleanly without sending
5. Start dashboard, click every page — all render without error

Expected: no exceptions, data visible in dashboard.

- [ ] **Step 3: Commit a clean point**

```bash
git tag pre-cutover-local-green
```

### Task 7.4: VPS cutover (production)

**Execute one evening, after the 8:30 PM `dailyReport` job completes.**

- [ ] **Step 1: Stop PM2 processes**

On the VPS:
```bash
pm2 stop radar-cron radar-dashboard
```

- [ ] **Step 2: Tag rollback anchor**

```bash
cd /home/radar
git tag pre-postgres-cutover
```

- [ ] **Step 3: Install Postgres 16**

```bash
sudo apt update
sudo apt install -y postgresql-16
sudo systemctl enable --now postgresql
```

- [ ] **Step 4: Create role + DB + password**

```bash
sudo -u postgres psql <<SQL
CREATE USER radar WITH PASSWORD '<strong-password>';
CREATE DATABASE radar OWNER radar;
SQL
```

- [ ] **Step 5: Apply tuning**

Edit `/etc/postgresql/16/main/postgresql.conf`:
```
listen_addresses = 'localhost'
shared_buffers = 256MB
max_connections = 20
work_mem = 16MB
```
Then:
```bash
sudo systemctl restart postgresql
```

- [ ] **Step 6: Create `~/.pgpass` for backup.sh**

```bash
echo "127.0.0.1:5432:radar:radar:<strong-password>" > ~/.pgpass
chmod 600 ~/.pgpass
```

- [ ] **Step 7: Pull the migration branch**

```bash
cd /home/radar
git pull origin postgres-migration
```

- [ ] **Step 8: Install deps + apply migrations**

```bash
npm install
npx prisma generate
DATABASE_URL="postgresql://radar:<strong-password>@127.0.0.1:5432/radar?schema=public" \
  npx prisma migrate deploy
```

- [ ] **Step 9: Update `.env`**

Add to `/home/radar/.env`:
```
DATABASE_URL="postgresql://radar:<strong-password>@127.0.0.1:5432/radar?schema=public"
```
**Leave `DB_PATH=...` in `.env` for now** — it's the rollback anchor. Removal happens in Task 7.5 Step 3 after 48h of clean runs.

- [ ] **Step 10: Seed config**

```bash
node -e "(async () => { const m = await import('./utils/db.js'); await m.seedConfigDefaults(); await m.seedNichesAndIcpRules(); await m.resetDb(); })()"
```

- [ ] **Step 11: Start PM2**

```bash
pm2 start ecosystem.config.js
pm2 save
```

- [ ] **Step 12: Tail logs overnight**

```bash
pm2 logs radar-cron
```

Next morning at 9:00 AM IST, confirm:
- `findLeads` job runs and creates rows in `leads` table
- `cron_log` has a row with `status='success'`
- No entries in `error_log`

### Task 7.5: 48-hour cleanup

**Only after 48 hours of clean Postgres runs.**

- [ ] **Step 1: Remove SQLite artifacts**

```bash
cd /home/radar
rm db/radar.sqlite db/radar.sqlite-wal db/radar.sqlite-shm
```

- [ ] **Step 2: Remove `better-sqlite3`**

```bash
npm uninstall better-sqlite3
```

- [ ] **Step 3: Remove `DB_PATH`**

Delete `DB_PATH=...` from `/home/radar/.env`.

- [ ] **Step 4: Commit + merge to main**

```bash
git add package.json package-lock.json
git commit -m "chore(db): remove better-sqlite3 after 48h clean postgres runs"
git push origin postgres-migration
# Open PR, review, merge to main
```

---

## Rollback Plan (if needed within 48h of cutover)

On the VPS:
```bash
pm2 stop radar-cron radar-dashboard
cd /home/radar
git checkout pre-postgres-cutover
npm install
pm2 start ecosystem.config.js
```

Because `db/radar.sqlite` is untouched until Task 7.5, this is a clean restore to the last known-good state.

---

## Verification Checklist (do not sign off until all ✓)

- [ ] All 12 Prisma models present in `prisma/schema.prisma`
- [ ] `prisma migrate deploy` runs cleanly on a fresh DB
- [ ] `npm test` passes with zero failures
- [ ] `utils/db.js` exports every helper the old file did (plus `bumpCostMetric`)
- [ ] `findLeads.js`, `sendEmails.js`, `sendFollowups.js`, `checkReplies.js`, `dailyReport.js`, `healthCheck.js` all async
- [ ] `cron.js` awaits each engine + catches + logs errors
- [ ] Dashboard renders every page against both empty and seeded DBs
- [ ] `backup.sh` produces a restorable `pg_dump` archive on B2
- [ ] `CLAUDE_DAILY_SPEND_CAP` still blocks AI calls (test by setting cap to 0.01 temporarily)
- [ ] `DAILY_SEND_LIMIT=0` still blocks sends
- [ ] `contentValidator` still runs before every send
- [ ] `reject_list` membership is still absolute (sends skip rejected addresses)
