# Postgres Migration Plan — Gap Analysis

**Date:** 2026-04-19
**Reviewer:** Claude (pre-execution audit)
**Against:** [`docs/superpowers/plans/2026-04-17-sqlite-to-postgres-migration.md`](../plans/2026-04-17-sqlite-to-postgres-migration.md)
**Against spec:** [`docs/superpowers/specs/2026-04-17-sqlite-to-postgres-migration-design.md`](2026-04-17-sqlite-to-postgres-migration-design.md)

**Status:** ❌ **DO NOT EXECUTE AS-WRITTEN.** Plan was authored 2 days before a major repo restructure + ICP framework refactor that landed in the interim. Execution against the plan verbatim would produce broken code and a schema missing ~15% of current tables/columns.

---

## TL;DR

The plan is structurally sound (Prisma singleton, async-throughout, local-first Docker validation, 48h rollback window) but it references a codebase snapshot from **2026-04-17** that no longer exists. Since then:

1. **Repo reorganized** (commit [`91947d6`](../../../)) into `src/core`, `src/engines`, `src/api`, `src/scheduler`, `web/` — plan still references flat root-level layout (`utils/db.js`, `findLeads.js`, `dashboard/server.js`).
2. **ICP framework refactor shipped** (11 commits this session) adding 2 new tables, 6 new `leads` columns, 3 new config keys, 1 new status value, and ~5 new source files — all absent from the plan's Prisma schema.
3. **Docker daemon is not running locally** (plan's Phase 1 validation step). But `postgresql@16` is installed and running via Homebrew — we can use that directly, no Docker needed.

Also there are **10 pre-existing failing tests** on `reach` baseline (unrelated to this migration). Plan assumes green suite as starting point.

---

## Gap 1: File paths — 100% stale

**Plan says:**
```
utils/db.js, utils/claude.js, utils/mev.js, utils/concurrency.js
findLeads.js, sendEmails.js, sendFollowups.js, checkReplies.js,
  dailyReport.js, healthCheck.js, cron.js
dashboard/server.js (one file, 834 lines)
tests/utils/db.test.js, tests/findLeads.test.js, tests/dashboard/api.test.js
testFindLeads.js, testFullPipeline.js (root)
```

**Reality:**
```
src/core/db/index.js          ← was utils/db.js
src/core/ai/claude.js         ← was utils/claude.js
src/core/ai/gemini.js         ← new (Gemini 2.5 Flash wrapper)
src/core/ai/icpScorer.js      ← NEW from ICP v2 refactor
src/core/integrations/mev.js  ← was utils/mev.js
src/core/integrations/telegram.js
src/core/integrations/blacklistCheck.js
src/core/email/mailer.js, imap.js, contentValidator.js
src/core/lib/concurrency.js, sleep.js
src/engines/*.js (6 engines — same names, different path)
src/scheduler/cron.js         ← was cron.js
src/api/server.js             ← was dashboard/server.js (now a 75-line bootstrap)
src/api/routes/*.js           ← 16 route files (modular, not monolithic)
src/api/middleware/auth.js
tests/core/db/db.test.js      ← was tests/utils/db.test.js
tests/core/ai/icpScorer.test.js  ← NEW
tests/api/api.test.js, offer.test.js, icpProfile.test.js  ← API tests here
tests/engines/*.test.js       ← all engine tests
tests/scripts/rescoreLeads.test.js  ← NEW
scripts/rescoreLeads.js       ← NEW (one-off migration from ICP v2)
scripts/testFindLeads.js, testFullPipeline.js  ← moved here
web/                          ← React SPA (plan doesn't mention; no DB access so safe)
```

**Impact:** Every `git add` path, every `cat <file>` command, every import path in the plan is wrong. Roughly 80+ individual fix points across the plan body.

---

## Gap 2: Schema is now 14 tables, not 12 — Prisma schema is missing ICP v2 additions

### Tables

| Plan says | Reality |
|---|---|
| 9 pipeline + 3 config = 12 | 9 pipeline + 3 config + 2 ICP framework = **14** |

**Missing from plan's Prisma schema:**

```prisma
model Offer {
  id              Int       @id @default(1)  // CHECK (id = 1) — singleton
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

**Note on singleton pattern:** SQLite uses `CHECK (id = 1)` + `INSERT OR IGNORE INTO offer (id) VALUES (1)`. Prisma/Postgres can either:
- Keep the `CHECK` via `@db.Check(...)` (Prisma 5.7+ supports it) or raw SQL
- Or rely on application-level enforcement (always `upsert where: { id: 1 }`)

I recommend **option B** — simpler, matches how we already use it. Seed via `prisma.offer.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} })` at startup.

### Lead model — 6 missing columns

Plan's `Lead` model has ~30 fields. Current schema has **~36** — 6 were added by ICP v2 Chunk 1:

```prisma
// Add to Lead model:
icpBreakdown       Json?    @map("icp_breakdown")
icpKeyMatches      Json?    @map("icp_key_matches")
icpKeyGaps         Json?    @map("icp_key_gaps")
icpDisqualifiers   Json?    @map("icp_disqualifiers")
employeesEstimate  String?  @map("employees_estimate")
businessStage      String?  @map("business_stage")
```

### Status enum — `disqualified` missing

Plan keeps `status` as `String` (correct choice). But the seeded default rows/tests reference pre-ICP-v2 statuses. Current valid set:
```
discovered / extraction_failed / judge_skipped / email_not_found /
email_invalid / icp_c / deduped / ready / queued / sent / replied /
unsubscribed / bounced / nurture / disqualified
```

### `icp_score` semantics — 0–10 → 0–100

Plan's `Int?` type is correct. But `icp_threshold_a` default in `seedConfigDefaults()` was flipped 7→70 and `icp_threshold_b` 4→40 during ICP v2 Chunk 1. Plan's seed still lists the OLD values:
```js
['icp_threshold_a', '7'],    // STALE — current is '70'
['icp_threshold_b', '4'],    // STALE — current is '40'
```

Also missing from plan's seed list:
```js
['icp_weights', '{"firmographic":20,"problem":20,"intent":15,"tech":15,"economic":15,"buying":15}'],
```

Plus a one-off upgrade block (flips existing 0-10 values to 0-100) that must survive the migration.

---

## Gap 3: Missing source files from plan inventory

Plan's "Files Changed" table lists ~15 files. It's missing:

| File | Status | Needs Prisma port? |
|---|---|---|
| `src/core/ai/icpScorer.js` | Exists | **Yes** — `loadScoringContext()` does raw `db.prepare(...).get()` on offer/icp_profile |
| `src/api/routes/offer.js` | Exists | **Yes** — GET/PUT with JSON array parsing |
| `src/api/routes/icpProfile.js` | Exists | **Yes** — same pattern |
| `src/api/routes/icpRules.js` | Exists | **Yes** — legacy route kept during migration |
| `src/api/routes/config.js` | Exists | **Yes** — now includes `icp_weights` sum-to-100 validation |
| All 16 `src/api/routes/*.js` files | Exists | **Yes** — each one imports `getDb()` |
| `scripts/rescoreLeads.js` | Exists (NEW) | **Yes** — uses `db.transaction()`, better-sqlite3-specific |
| `tests/core/ai/icpScorer.test.js` | Exists (18 tests) | **Yes** — mocks `callGemini`, needs fixture update |
| `tests/engines/insertLead.test.js` | Exists (4 tests) | **Yes** — tests the 35-col positional INSERT helper |
| `tests/scripts/rescoreLeads.test.js` | Exists (4 tests) | **Yes** — tests transaction semantics |

**Most concerning:** `src/engines/findLeads.js:18` exports an **`insertLead` helper** that does a 35-column positional INSERT. In Prisma this becomes a clean `prisma.lead.create({ data: {...} })` — a net simplification, but the test at `tests/engines/insertLead.test.js` exercises the positional contract and will need full rewrite.

**Also:** `scripts/rescoreLeads.js` uses `better-sqlite3`'s SYNC `db.transaction(fn)` API. Prisma's `$transaction([...])` is async + different semantics. The fix shipped in commit `b1281c3` wraps 3 statements atomically per lead — needs careful translation.

---

## Gap 4: Test suite assumptions

### Current test count (post-ICP-v2)

- **Total: 156 tests** (22 test files)
- **Passing: 146**
- **Failing: 10** — pre-existing in `tests/engines/sendEmails.test.js` (6) + `tests/engines/sendFollowups.test.js` (4). Unrelated to this migration, flagged as separate side task. They fail with `status=skipped` vs expected `success` and mock-arg mismatches.

Plan's verification checklist says "`npm test` passes with zero failures." That's **not true today** and won't be true mid-migration either. Either:
- **Option A:** Fix the 10 pre-existing failures first (already flagged as a separate task chip).
- **Option B:** Acknowledge the baseline in the plan, target "10 failures → 10 failures" (no regression).

Recommend **A** — we don't want ambiguity during rollout.

### Test helper collisions

Plan's `tests/helpers/testDb.js` pattern is good but the current test files don't use it — each test sets up its own tmpdir + SQLite file. Porting those tests will be the single largest category of work, with ~22 files × ~5 tests each = 110+ points of change.

### Specific test files that need extra care

- `tests/core/ai/icpScorer.test.js`: mocks `callGemini` and exercises `loadScoringContext(db)`. The `db` is passed in — with Prisma, this becomes `prisma`. Clean change.
- `tests/engines/insertLead.test.js`: directly calls `insertLead(db, lead, niche, status)` and inspects the resulting row. With Prisma, `insertLead` becomes a thin wrapper around `prisma.lead.create` and probably no longer needs to be an exported helper.
- `tests/scripts/rescoreLeads.test.js`: one test asserts `deletePending` within a transaction. Prisma translation requires `prisma.$transaction([...])` or interactive tx.
- `tests/api/api.test.js`: 31 tests — spins up the Express app against a tmpdir SQLite. Needs Postgres per-test truncation via the new fixture.

---

## Gap 5: Raw SQL hotspots that don't translate mechanically

These places use SQL features that need explicit Prisma thought:

### Places flagged for careful translation

1. **`src/engines/findLeads.js` — cooldown query (line ~231)** — uses `substr(contact_email, instr(contact_email, '@') + 1)` to extract domain in SQL. Prisma has no equivalent; compute in JS after `findMany`:
   ```js
   const cooledDomains = new Set(
     (await prisma.lead.findMany({
       where: { status: { in: ['sent', 'replied'] }, domainLastContacted: { gte: ninetyDaysAgo } },
       select: { contactEmail: true }
     })).map(r => r.contactEmail?.split('@')[1]).filter(Boolean)
   );
   ```

2. **`src/engines/findLeads.js` — AI spend cap read (line ~404)** — uses `COALESCE(col1, 0) + COALESCE(col2, 0)` conditionally based on `ANTHROPIC_DISABLED`. Prisma: fetch the row and do the math in JS.

3. **`src/engines/sendEmails.js` — batch lead query** — has `ORDER BY l.icp_priority ASC, l.icp_score DESC` with JOIN on emails. Prisma equivalent:
   ```js
   await prisma.lead.findMany({
     where: { status: 'ready' },
     include: { emails: { where: { status: 'pending', sequenceStep: 0 } } },
     orderBy: [{ icpPriority: 'asc' }, { icpScore: 'desc' }]
   })
   ```

4. **`src/api/routes/funnel.js` — `GROUP BY icp_score`** — use `prisma.lead.groupBy({ by: ['icpScore'], _count: true })`.

5. **`src/api/routes/cronStatus.js` — "NOT TRIGGERED" detection** — plan includes this but path is wrong. Route already exists at `src/api/routes/cronStatus.js` (73 lines); plan points at `dashboard/server.js`.

6. **`scripts/rescoreLeads.js` — `db.transaction()`** — see Gap 3.

7. **`src/core/db/index.js:25-36` — `initSchema()` + `addColumnIfMissing()`** — these are SQLite-specific and become obsolete with Prisma migrations. Must be fully removed, not ported. All callers (tests, seed scripts, etc.) need to call `prisma.$connect()` equivalent instead.

---

## Gap 6: Async-propagation risks

Plan says "make everything async." Specific spots that are fragile:

### `src/engines/findLeads.js` concurrency primitives

Current code uses `withConcurrency(items, 20, async fn)` — the lib already handles async workers. Fine.

**But:** the dedup `Set`s (`knownEmails`, `rejectedEmails`, `cooledDomains`) are pre-loaded sync once, then mutated via `.add()` in the concurrent worker. JS's event loop guarantees no interleave for `.add()`. With async DB ops inserted, we now have `await` points where another worker could mutate the set between check and add. Need to either:
- Re-verify each email in the DB on insert (expensive)
- OR move dedup to a post-processing step (simpler)
- OR document that the in-memory Set is still race-free because `.has/.add` are sync and JS is still single-threaded

The third is true. Plan is fine here, but it's a subtle point worth flagging.

### Top-level await in `findLeads()` body

Current body is a sync `try { ... }` — becomes async with Prisma. Fine. But `src/scheduler/cron.js:58` (cron.js) fires engines without awaiting. Plan catches this at Task 5.4. ✅

### Dashboard route handlers

Currently sync `(req, res) => { ... }` with sync `db.prepare().get()`. Must become `async (req, res) => { ... }`. Any forgotten `await` on a `prisma.X` call becomes a silent promise leak (response sends before data returns, dashboard shows empty). High-risk; add an ESLint rule `require-await` + `no-floating-promises` during this work.

---

## Gap 7: Local validation — Docker not needed

Plan says: `docker run -d --name radar-pg postgres:16`.

**Current state:**
```
$ brew services list
postgresql@16 started  (running)
```

Postgres 16 is already running on Mac via Homebrew. Either:
- **Use existing Homebrew instance** (simpler; requires creating `radar` role + `radar` / `radar_test` DBs via `psql`)
- **Start Docker daemon + use plan's Docker container** (mirrors production closer but more overhead)

Recommend **Homebrew** for local work — the VPS cutover will use apt-installed Postgres anyway, so Docker is only useful for exact-version parity (both are 16).

---

## Gap 8: VPS cutover assumptions

Plan's Phase 2 (Task 7.4) assumes:
- User has SSH access to the VPS
- `radar` systemd user exists at `/home/radar`
- PM2 is running with `radar-cron` and `radar-dashboard` process names

Per `CLAUDE.md §1`: "Host: Ubuntu 24 VPS, PM2-managed (being migrated to personal server)". The "being migrated to personal server" phrase suggests the host is itself in flux. Before executing Task 7.4, user should confirm:
- Which host is current prod?
- Is the personal-server migration done?
- Does PM2 still use the same process names?

**Action:** Flag in rollout section; don't block.

---

## Gap 9: Backup script — macOS pg_dump vs prod

Plan's `backup.sh` uses `pg_dump --format=custom --compress=9`. Works identically on macOS Homebrew Postgres and Ubuntu apt Postgres — both pg 16.

But: `~/.pgpass` file format is the same (POSIX). No gap; flagged for completeness.

---

## Gap 10: Remaining concerns

- **Schema drift risk during migration:** If work spans multiple days and a new `ALTER TABLE` happens on SQLite during that window, the Prisma migration misses it. Mitigation: hold migration work to a single continuous session + lock schema changes on `reach` until done.
- **Existing migrations folder:** `prisma/migrations/` doesn't exist yet. The initial `prisma migrate dev --name init` will generate it. But if the plan is run MULTIPLE times during iteration, we'll end up with multiple `init` migrations. Mitigation: delete `prisma/migrations/` before each full re-run if we iterate the schema.
- **`better-sqlite3` in node_modules after removal:** `package-lock.json` may retain transitive entries. `npm prune` after `npm uninstall better-sqlite3` is worth adding to Task 7.5.
- **Tests that MOCK the DB module:** `tests/engines/findLeads.test.js` does `vi.mock('../../src/core/ai/gemini.js', ...)` — these mocks don't touch DB, but if Prisma is also mocked anywhere it needs updating. Grep for `vi.mock.*db`.

---

## Recommended path forward

Given all the gaps, I see three options:

### Option A: Update the plan first, then execute against corrected plan

1. Rewrite the plan document with all corrections (paths, schema, tests, helpers)
2. Re-run the writing-plans review loop
3. Execute Chunk-by-chunk with subagents

**Pros:** Safe, matches TDD intent ("test against a correct spec")
**Cons:** 1-2 hours of upfront plan surgery before any code lands

### Option B: Execute with running corrections (risky)

Start at Chunk 1, fix paths/schema as I go, document corrections inline. Pause after each chunk for user review.

**Pros:** Forward progress immediately
**Cons:** Higher chance of missing something; the plan's "correctness" is eroding as we work

### Option C: Write a corrected plan in parallel, then start Chunk 1 against it (RECOMMENDED)

1. Write [`docs/superpowers/plans/2026-04-19-postgres-migration-v2.md`](../plans/2026-04-19-postgres-migration-v2.md) — a corrected plan that:
   - Uses current file paths
   - Includes Offer/IcpProfile models + 6 new Lead columns
   - Uses Homebrew Postgres (not Docker)
   - Acknowledges the 10 pre-existing test failures
   - Flags all the "Gap N" items above as resolved
2. Start executing Chunk 1 (Prisma install + schema + test fixture) TDD-style
3. Pause at Chunk 1 completion for user review

**Pros:** Explicit traceable corrections, TDD-compliant, minimal scope creep
**Cons:** Takes ~1 hour of plan writing before touching code

**My call:** Option C. Executing a broken plan blindly would waste more time than the plan surgery.

## Status: blocked pending human decision

User is AFK. I will:

1. **Not start execution blind** — writing broken migration code is harder to undo than not starting
2. **Write the corrected plan** as a separate document while the user is AFK
3. **Verify local prereqs** (Homebrew Postgres role creation, Prisma package install test)
4. **Pause before touching `src/**` or `prisma/schema.prisma`** until user confirms Option C

When the user returns, they can either:
- Approve the corrected plan and I start Chunk 1
- Choose Option A (fix original plan) or Option B (execute with running corrections)
- Redirect entirely

---

## Quick-reference fixes needed in the original plan

If you prefer Option A over Option C (rewriting the plan in place), apply these edits:

- [ ] Replace every `utils/db.js` reference with `src/core/db/index.js`
- [ ] Replace every `utils/claude.js` with `src/core/ai/claude.js`
- [ ] Replace every `utils/mev.js` with `src/core/integrations/mev.js`
- [ ] Replace every top-level engine file (`findLeads.js`, etc.) with `src/engines/<name>.js`
- [ ] Replace `dashboard/server.js` with the appropriate `src/api/routes/<file>.js` (16 files)
- [ ] Replace `cron.js` with `src/scheduler/cron.js`
- [ ] Replace `tests/utils/*` with `tests/core/db/` or `tests/core/ai/` or equivalents
- [ ] Replace `tests/findLeads.test.js` with `tests/engines/findLeads.test.js`
- [ ] Replace `tests/dashboard/api.test.js` with `tests/api/api.test.js` (+ offer.test.js + icpProfile.test.js)
- [ ] Add `Offer` + `IcpProfile` Prisma models
- [ ] Add 6 new columns to `Lead` model: `icpBreakdown`, `icpKeyMatches`, `icpKeyGaps`, `icpDisqualifiers`, `employeesEstimate`, `businessStage`
- [ ] Update `seedConfigDefaults` list: change `icp_threshold_a` default `'7'` → `'70'`, `icp_threshold_b` `'4'` → `'40'`, add `icp_weights` entry
- [ ] Add Prisma-port tasks for `src/core/ai/icpScorer.js`, `scripts/rescoreLeads.js` (transaction semantics)
- [ ] Add Prisma-port task for EACH of 16 `src/api/routes/*.js` files (not one monolithic dashboard)
- [ ] Add rewrite task for `tests/engines/insertLead.test.js`, `tests/core/ai/icpScorer.test.js`, `tests/scripts/rescoreLeads.test.js`
- [ ] Replace Docker setup with `brew services list` verification
- [ ] Remove `initSchema()` + `addColumnIfMissing()` from helper inventory (these go away entirely with Prisma)
- [ ] Acknowledge 10 pre-existing failing tests + make their fix a prerequisite (or document as acceptable baseline)
- [ ] Verify VPS host is current (given the "migrating to personal server" note in CLAUDE.md)
