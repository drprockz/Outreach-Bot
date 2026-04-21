# Pipeline Hardening — Chunk 1: Data-Integrity Foundation

**Date:** 2026-04-21
**Author:** Darshan Parmar (w/ Claude)
**Status:** Draft — pending spec review + user approval
**Scope:** First of 7 chunks in the pipeline-hardening roadmap. See §2 for full roadmap, §3 for Chunk 1 boundaries.

---

## 1. Problem

The lead-enrichment pipeline (`findLeads.js` 11-stage flow) and the engines that consume its output (`sendEmails`, `checkReplies`, `healthCheck`) have grown organically during the warmup phase. An audit (2026-04-21) surfaced 16 concrete gaps across correctness, quality, deliverability safety, cost efficiency, and observability.

Four of those gaps are **load-bearing invariants** — every other improvement we want to make (richer prompts, per-domain caps, reply-driven auto-reject, better observability) assumes these hold. They do not hold today:

1. **Non-atomic lead + email insert** at [findLeads.js:481–503](src/engines/findLeads.js:481) — `insertLead()` is called, then `prisma.email.create()` is called. If the second call throws, the lead row is orphaned in the DB with `status='ready'` but no email to send. The send engine will either silently skip it or fail downstream.

2. **No unique constraint on `leads.contactEmail`** — schema has `@@index([contactEmail])` at [schema.prisma:75](prisma/schema.prisma:75) but not `@unique`. Dedup relies entirely on an in-memory `Set` pre-loaded at pipeline start ([findLeads.js:261–282](src/engines/findLeads.js:261)). That Set is stale the moment concurrent workers start writing. Postgres-casing (`John@X.com` vs `john@x.com`) is not handled — same address can land twice.

3. **MEV `error` status silently passes** — at [mev.js:31–33](src/core/integrations/mev.js:31) any axios error becomes `{status:'error', confidence:0}`. The findLeads gate at [findLeads.js:388](src/engines/findLeads.js:388) filters `unknown + low-confidence` but not `error`. Leads with zero verification slip straight into the ready pile and get contacted.

4. **No regex validation on Gemini-guessed emails** — extraction produces addresses of the form `firstname@domain` by pattern-matching website content. Malformed results (spaces in local-part, missing TLD, truncated strings like `info@`) flow into MEV, burn `$0.00288` per call, and come back invalid. Role-address hits (`info@`, `support@`, `hello@`) also pass — they're never a decision-maker but the pipeline treats them like any other lead.

These four gaps compound: a non-atomic insert writing a non-unique, non-normalized, non-regex-checked email is every downstream guard's foundation. Fix them first.

## 2. The 7-chunk roadmap (context)

Chunk 1 is the first of seven specs. Only Chunk 1 is being fully specified in this document. Future chunks will each get their own spec at `docs/superpowers/specs/<date>-pipeline-hardening-chunk-N-<topic>-design.md`.

| # | Chunk | Summary |
|---|---|---|
| **1** | **Data-integrity foundation** (this doc) | Atomic persistence, unique-email constraint, MEV error gate + retry, email regex validation |
| 2 | LLM output validation & single-retry | Post-gen length / link / punctuation checks, enum validation on extracted signals, malformed-JSON retry |
| 3 | Resumability & granular observability | `pipeline_run` + `pipeline_stage_progress` tables, per-stage metrics, error categorization, grounding-cost tracking |
| 4 | Send-side hardening | Pre-send re-validation of AI-generated bodies, per-domain weekly cap, bounce → auto-reject_list, stricter identity assertion |
| 5 | Reply-side feedback loop | Auto-detect unsubscribe/"stop" → reject_list, negative-intent → reject_list, positive-but-not-now → nurture, confidence gate → manual review |
| 6 | Quality depth | Richer hook/body prompts using signals+tech+problem, per-niche persona (move from global), ICP parse-error retry |
| 7 | Health reactions | Auto-pause on blacklist, per-inbox health score, weekly mail-tester reminder, reply-rate-driven inbox scoring |

Dependencies: Chunk 2 assumes Chunk 1's uniqueness + atomic insert. Chunks 4/5 re-use the `integrity.js` module introduced in Chunk 1. Chunks 3/6/7 depend only on 1 being done.

## 3. Chunk 1 scope

### Goals

- **Atomicity**: a `status='ready'` lead in the DB always has a matching pending `emails` row, or neither exists.
- **Uniqueness**: no two `leads` rows can exist for the same email address, regardless of casing or whitespace.
- **Verified-or-classified**: every lead that reaches ICP scoring either has a MEV-`valid` result, a passable `unknown` (confidence ≥ 0.5), or an explicit `skipped` (no API key configured). No `error` leaks through.
- **Shape-gated emails**: regex + role-address rejection happens before MEV, saving both credits and downstream pipeline waste.
- **Machine-readable failure reasons**: new fine-grained statuses (`email_malformed`, `email_verify_error`) so the dashboard and Telegram digest can attribute drops by cause.

### Non-goals (explicitly deferred)

- Disposable-email → dedicated status (stays `email_invalid` with `emailStatus='disposable'`). Belongs in Chunk 2.
- Retry budget / exponential backoff on MEV. Single flat 500ms retry for transient errors only (classified per §5).
- Postgres `citext` extension adoption. We use a functional unique index instead (§4).
- Resumability / pipeline-run checkpointing. Chunk 3.
- Touching `sendEmails.js` / `checkReplies.js` / `healthCheck.js` logic. Those engines consume the integrity-layer helpers in Chunks 4/5 but nothing changes in them during Chunk 1.
- Backfilling `emailStatus` on historical rows.

### Decisions locked (questions answered during brainstorming)

| # | Decision | Choice | Rationale |
|---|---|---|---|
| Q1 | Email normalization for uniqueness | **Functional unique index on `LOWER(contact_email)`**, partial with `WHERE contact_email IS NOT NULL` | DB-enforced beats convention; partial handles null-email leads. No extension dependency. |
| Q2 | MEV retry policy | **Classified retry**: transient (network / 5xx / 429) retried once after 500ms flat; permanent (4xx non-429, unknown) not retried | Purposeful retries only; blindly retrying a bad API key wastes calls. |
| Q3 | Email regex strictness | **Shape regex + role-address rejection** (17 role prefixes) | Role addresses aren't decision-makers — filtering them is quality, not just hygiene. |
| Q4 | Existing duplicates | **Fail-fast audit**: pre-migration script lists offenders; user resolves manually | Warmup-phase data is small; automated heuristics risk silently picking the wrong survivor. |
| Q5 | Status values for new drops | **Fine-grained**: `email_malformed` and `email_verify_error` as distinct statuses | Different remediations — one points at Gemini prompt, the other at MEV reliability. |
| A  | Implementation shape | **New integrity layer module** at `src/core/leads/integrity.js` | Four utilities reused in Chunks 4/5. Writing inline now means rewriting later. |

## 4. Architecture

### 4.1 New module: `src/core/leads/integrity.js`

Pure module. No DB, no network, no side effects. Exports four utilities and one constant. Easy to unit-test exhaustively.

```js
// 1. normalizeEmail(raw: string | null | undefined) → string | null
//    Single source of truth for "how we store emails."
//    - null / undefined / empty / whitespace-only → null
//    - otherwise: trim() + toLowerCase()
//    - does NOT touch the local-part structure (preserves +tag and dots)
//    Called at every write site AND when pre-loading the dedup Set.

// 2. ROLE_ADDRESSES: Set<string>
//    Local-parts that are always rejected regardless of domain:
//      info, support, contact, hello, admin, sales, noreply, no-reply,
//      team, office, enquiry, enquiries, help, feedback, webmaster,
//      postmaster, abuse
//    (17 entries total.) Exported as a Set so tests can assert exact membership
//    and so extensions in later chunks can add via `ROLE_ADDRESSES.add(...)` if
//    needed (though schema-level changes should be preferred).

// 3. validateContactEmail(raw: string | null | undefined)
//      → { ok: true,  email: string }                                  // normalized
//      | { ok: false, reason: 'empty' | 'shape' | 'role' }
//    Composite check:
//      a) normalizeEmail(raw) → if null, return { ok: false, reason: 'empty' }
//      b) shape regex: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
//         → if no match, return { ok: false, reason: 'shape' }
//      c) split on '@', take local-part, test against ROLE_ADDRESSES
//         → if hit, return { ok: false, reason: 'role' }
//      d) else return { ok: true, email: normalized }
//    reason is machine-readable for metric/dashboard slicing.

// 4. classifyAxiosError(err) → 'transient' | 'permanent'
//    Inputs: axios error object (or thrown Error from axios rejection)
//    'transient' if:
//      - err.code === 'ECONNABORTED'   // timeout
//      - err.code === 'ECONNRESET'
//      - err.code === 'ENOTFOUND'      // DNS flap (rare but real)
//      - err.response?.status === 429  // rate-limited
//      - err.response?.status >= 500 && err.response.status < 600
//    'permanent' otherwise (including unknown / undefined err shapes — fail-safe).
//    Used by mev.js to decide whether to retry.
```

**What this module deliberately does NOT export**:
- An `atomicInsertLeadWithEmail()` helper. That abstraction would hide Prisma transaction semantics. The `prisma.$transaction` block stays inline in findLeads.js where it's used.
- A `dedupCheck()` helper. Dedup is now enforced by the DB unique index + Prisma's P2002 catch. The in-memory Set remains only as a fast-path optimization — no module extraction needed.

### 4.2 Reworked `src/core/integrations/mev.js`

Current implementation swallows all errors into `{status:'error', confidence:0}` and doesn't retry. Rework:

```js
// Pseudocode — real impl in §5

export async function verifyEmail(email) {
  if (!process.env.MEV_API_KEY) return { status: 'skipped', confidence: 0 };

  try {
    return await callMev(email);
  } catch (err1) {
    const kind = classifyAxiosError(err1);
    if (kind === 'permanent') {
      return { status: 'error', confidence: 0, errorKind: 'permanent' };
    }
    // transient → wait 500ms, retry once
    await sleep(500);
    try {
      return await callMev(email);
    } catch (err2) {
      return { status: 'error', confidence: 0, errorKind: 'transient_retried' };
    }
  }
}
```

**Contract notes**:
- `skipped` return shape is unchanged (preserves dev workflow with no API key set).
- `errorKind` is additive — existing callers that only look at `.status` continue to work.
- Cost is bumped on successful calls only (`bumpCostMetric('mevCostUsd', …)` inside `callMev` after a 200 response). Retried-but-still-failed calls do NOT bump cost (MEV shouldn't bill us for failures; if they do, that's a separate issue).
- On a successful retry, cost bumps once (for the successful call). This matches today's billing behavior.

### 4.3 `findLeads.js` touchpoints

Six edit sites. In pipeline order:

**T1. Pre-loaded dedup Sets use normalized emails** (lines ~261–282)

Every `r.contactEmail` read becomes `normalizeEmail(r.contactEmail)`. Applies to `knownEmails`, `rejectedEmails`, and the `contactEmail?.split('@')[1]` on the cooledRows mapping. Without this, the pre-check misses case-variant duplicates and the DB unique index is the only safety net (it works, but we want the fast-path to work too so most dupes are caught before the insert attempt).

**T2. New gate — email shape — at top of Stage 7 worker** (line ~366)

Before calling MEV, run `validateContactEmail(lead.contact_email)`:

- `{ ok: false, reason }` → insert a lead row with `status='email_malformed'`, `contactEmail: null` (do not persist the malformed string — we'd lose the unique-index benefit by storing junk), `emailStatus` set to `'malformed:'+reason` for dashboard slicing, bump `leadsEmailMalformed` metric, skip MEV, return null from worker.
- `{ ok: true, email }` → assign the normalized `email` back to `lead.contact_email`, proceed to MEV.

This saves `$0.00288 × (malformed-rate × daily volume)` per day in MEV credits and shaves pipeline wall-time proportionally.

**T3. MEV result branching rework** (lines ~368–398)

Replace the current three-branch structure with five explicit branches:

```js
const { status, confidence, errorKind } = await verifyEmail(lead.contact_email);
lead.email_status = status;

if (status === 'invalid' || status === 'disposable') {
  await prisma.lead.create({ data: {
    ...baseLeadFields,
    contactEmail: normalizeEmail(lead.contact_email),
    emailStatus: status,  // 'invalid' or 'disposable'
    status: 'email_invalid',
  }});
  leadsSkipped++;
  return null;
}

if (status === 'error') {
  await prisma.lead.create({ data: {
    ...baseLeadFields,
    contactEmail: normalizeEmail(lead.contact_email),
    emailStatus: `error:${errorKind}`,  // 'error:permanent' or 'error:transient_retried'
    status: 'email_verify_error',
  }});
  await logError('findLeads.mev', new Error(`MEV ${errorKind}`), {
    jobName: 'findLeads',
    errorCode: errorKind,
  });
  await bumpMetric('leadsEmailVerifyError');
  leadsSkipped++;
  return null;
}

if (status === 'skipped') {
  // No API key configured → dev-mode pass-through. Preserve lead; mark as unverified.
  lead.email_status = 'verify_skipped';
  await bumpMetric('leadsEmailValid');  // treated as valid for downstream metrics
  return lead;
}

if (status === 'unknown' && confidence < 0.5) {
  leadsSkipped++;
  return null;
}

await bumpMetric('leadsEmailValid');
return lead;
```

**T4. Atomic lead + email insert** (lines ~481–503)

Wrap the two writes in a single Prisma interactive transaction:

```js
await prisma.$transaction(async (tx) => {
  const leadInsert = await insertLead(lead, niche, 'ready', { tx });
  await tx.email.create({
    data: {
      leadId: leadInsert.id,
      sequenceStep: 0,
      subject: subjectResult.subject,
      body: bodyResult.body,
      wordCount: bodyResult.body.trim().split(/\s+/).filter(Boolean).length,
      hook: hookResult.hook,
      containsLink: false,
      isHtml: false,
      isPlainText: true,
      contentValid: true,
      status: 'pending',
      hookModel: hookResult.model,
      bodyModel: bodyResult.model,
      hookCostUsd: hookResult.costUsd,
      bodyCostUsd: bodyCost,
      totalCostUsd: hookResult.costUsd + bodyCost,
    },
  });
});
```

If `tx.email.create` throws, Prisma rolls back the `insertLead` write. No orphan leads.

**T5. `insertLead()` signature extension**

`src/engines/findLeads.js` currently calls `insertLead(lead, niche, status)`. Signature becomes:

```js
async function insertLead(lead, niche, status, { tx } = {}) {
  const client = tx ?? prisma;  // default to global Prisma client
  return client.lead.create({
    data: {
      ...existingFields,
      contactEmail: normalizeEmail(lead.contact_email),  // T6 folded in here
    },
  });
}
```

Backward compatible — existing callers (without the `{tx}` arg) continue to work.

**T6. Normalize-at-every-write-site**

Every `contactEmail:` in a `prisma.lead.create` / `insertLead` payload is piped through `normalizeEmail()`. Belt even though we're using a functional unique index (suspenders). Keeps reads and writes symmetric so an exact-match query `WHERE contactEmail = 'foo@x.com'` hits the row even though the unique index is functional.

**T7. P2002 handling** (wrap every `insertLead` call)

```js
try {
  await insertLead(/* ... */);
} catch (err) {
  if (err?.code === 'P2002' && err?.meta?.target?.includes('contact_email')) {
    // Dedup race: another worker inserted this email between our pre-check and our write.
    leadsSkipped++;
    await logError('findLeads.dedup_race', err, {
      jobName: 'findLeads',
      errorCode: 'P2002',
    });
    return;
  }
  throw err;
}
```

Applies to:
- Line ~373 (email_invalid insert)
- Line ~415 (disqualified insert)
- Line ~423 (nurture insert)
- Line ~481 (ready insert, now inside transaction)
- Plus the two new inserts for `email_malformed` and `email_verify_error`

## 5. Schema migration

### 5.1 Prisma model changes

File: `prisma/schema.prisma`. Two new counter fields on `DailyMetrics`:

```prisma
model DailyMetrics {
  // ... existing fields unchanged ...
  leadsEmailMalformed      Int @default(0) @map("leads_email_malformed")
  leadsEmailVerifyError    Int @default(0) @map("leads_email_verify_error")
  // ... rest unchanged ...
}
```

And a documenting comment on `Lead` pointing at the raw-SQL functional index (Prisma cannot model it natively):

```prisma
model Lead {
  // ...
  contactEmail  String?  @map("contact_email")
  // UNIQUE constraint enforced by functional index `leads_contact_email_lower_unique`
  // in migration `chunk1_integrity`. Not expressible in Prisma schema — do not remove
  // the raw SQL migration. All writes MUST route through normalizeEmail() in
  // src/core/leads/integrity.js.
  // ...
}
```

### 5.2 Migration SQL

File: `prisma/migrations/<timestamp>_chunk1_integrity/migration.sql`

```sql
-- Functional unique index on normalized email.
-- Partial: null emails don't collide on LOWER(NULL) — legitimate for
-- leads discovered but extraction failed to find an email.
CREATE UNIQUE INDEX leads_contact_email_lower_unique
  ON leads (LOWER(contact_email))
  WHERE contact_email IS NOT NULL;

-- New DailyMetrics counters (Prisma will also generate these; kept here
-- for migration atomicity if Prisma's migrate regen is run separately).
ALTER TABLE daily_metrics
  ADD COLUMN IF NOT EXISTS leads_email_malformed     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS leads_email_verify_error  INTEGER NOT NULL DEFAULT 0;
```

**Why `IF NOT EXISTS` on the ALTER**: `prisma migrate dev --create-only` may generate an equivalent `ALTER TABLE` for the two Prisma fields. Adding `IF NOT EXISTS` makes the hand-edited SQL idempotent with the Prisma-generated SQL, letting us merge them into a single migration file without collision.

### 5.3 Pre-migration audit script

New file: `scripts/audit_email_dupes.js`. Read-only. Takes no arguments.

```js
// Output on clean DB (exit 0):
//   ✅ 0 duplicate groups across N normalized emails. Safe to run:
//      npx prisma migrate deploy
//
// Output on dirty DB (exit 1):
//   ❌ Found K duplicate groups spanning M rows:
//
//     foo@acme.com  ×3  → ids: [42, 87, 104]
//     bar@xyz.io    ×2  → ids: [61, 118]
//     ...
//
//   Resolution options:
//     1. Manually pick survivor per group (recommended if K is small):
//          - Review the rows, delete the rows you don't want to keep.
//          - Re-run this audit until it exits 0.
//     2. Heuristic: keep row with highest icp_score, tie-break by oldest id.
//          (This script does NOT do this automatically — write a one-off
//          cleanup script if K is large and you're comfortable with the heuristic.)
```

Query:
```sql
SELECT LOWER(contact_email) AS email_lower,
       COUNT(*) AS n,
       ARRAY_AGG(id ORDER BY id) AS ids
  FROM leads
 WHERE contact_email IS NOT NULL
 GROUP BY LOWER(contact_email)
HAVING COUNT(*) > 1
 ORDER BY n DESC, email_lower ASC
 LIMIT 50;
```

Top 50 groups is enough — if there are more than 50 duplicate groups in the warmup-phase DB, the pipeline has bigger problems that a migration won't solve.

### 5.4 Operational flow

Documented in the PR description and the spec README:

```bash
# 1. Audit first
node scripts/audit_email_dupes.js

# 2a. If "✅ 0 duplicate groups" → apply migration
npx prisma migrate deploy

# 2b. If duplicates found:
#     - Review output
#     - Manually resolve (delete losers, or write a cleanup script)
#     - Re-run audit until clean
#     - Then apply migration

# 3. Verify post-migration
psql $DATABASE_URL -c "\d leads" | grep leads_contact_email_lower_unique
```

## 6. Error handling & observability

### 6.1 New metrics

Two counters in `DailyMetrics`, bumped from findLeads:

- `leadsEmailMalformed` — total leads dropped by T2 regex/role check, per day
- `leadsEmailVerifyError` — total leads dropped by T3 MEV-error branch, per day

Both are surfaced on the Email Health dashboard page (Chunk 7 will add tighter reactions; Chunk 1 just exposes the numbers).

### 6.2 Error log entries

New sources:
- `findLeads.mev` — written when MEV returns `error`, with `errorCode` = `'permanent'` or `'transient_retried'`
- `findLeads.dedup_race` — written when P2002 fires on any `insertLead` call, with `errorCode: 'P2002'`

Existing `findLeads.lead`, `findLeads.discovery`, `findLeads` sources unchanged.

### 6.3 Status state machine additions

Before Chunk 1: `discovered | email_invalid | disqualified | nurture | ready | sent | replied`

After Chunk 1 adds: `email_malformed` (T2), `email_verify_error` (T3)

Both are terminal drop states, same shape as `email_invalid` / `disqualified` — they exist solely to make failures queryable. The send engine (`sendEmails.js`) already filters on `status='ready'` only, so it won't pick these up. No changes to send-side code needed for the new statuses.

## 7. Testing strategy

### 7.1 New unit tests — `tests/core/leads/integrity.test.js`

Pure module, fast, no mocks. Target: 100% coverage (small surface).

| Function | Cases |
|---|---|
| `normalizeEmail` | `null`/`undefined`/`''`/`'   '` → `null` · `'  Foo@Bar.COM '` → `'foo@bar.com'` · preserves `foo+tag@x.com` and `first.last@x.com` |
| `validateContactEmail` | Valid well-formed → `{ok:true, email:normalized}` · empty → `reason:'empty'` · `'no-at.com'` / `'no@tld'` / `'has space@x.com'` / `'double@@x.com'` → `reason:'shape'` · all 17 role prefixes in mixed case (`Info@`, `SUPPORT@`, etc.) → `reason:'role'` |
| `ROLE_ADDRESSES` | Snapshot assertion: exact 17-entry Set |
| `classifyAxiosError` | `{code:'ECONNABORTED'}` / `'ECONNRESET'` / `'ENOTFOUND'` → `'transient'` · `{response:{status:500}}` / `502` / `503` → `'transient'` · `{response:{status:429}}` → `'transient'` · `{response:{status:400}}` / `401` / `403` / `404` → `'permanent'` · `{}` / `undefined` / `new Error('wat')` → `'permanent'` |

### 7.2 New / updated — `tests/core/integrations/mev.test.js`

Create if not present; otherwise extend.

| Scenario | Expected |
|---|---|
| No `MEV_API_KEY` in env | `{status:'skipped', confidence:0}`, zero axios calls |
| Success first try | `{status:'valid', confidence, errorKind: undefined}`, cost bumped once, one axios call |
| Transient err → retry → success | returns success, cost bumped once (not twice), two axios calls with ~500ms gap |
| Transient err → retry → still err | `{status:'error', errorKind:'transient_retried'}`, cost NOT bumped, two axios calls |
| Permanent err first try | `{status:'error', errorKind:'permanent'}`, cost NOT bumped, exactly one axios call (no retry) |

Axios mocked via `vi.spyOn` or equivalent. Timing-sensitive assertions use fake timers.

### 7.3 Extended — `tests/engines/findLeads.test.js`

New branch coverage on top of the existing integration test:

| Case | Key assertions |
|---|---|
| Gemini returns `'info@foo.com'` (role) | Lead inserted with `status='email_malformed'`, `emailStatus='malformed:role'`, `contactEmail` is `null`; `verifyEmail` mock called **zero times**; `leadsEmailMalformed` incremented |
| Gemini returns `'has space@foo.com'` (shape) | Same as above with `emailStatus='malformed:shape'` |
| Gemini returns `''` / `null` | Same as above with `emailStatus='malformed:empty'` |
| MEV returns `{status:'error', errorKind:'permanent'}` | Lead `status='email_verify_error'`, `emailStatus='error:permanent'`; error_log entry with `source='findLeads.mev'`, `errorCode='permanent'`; `leadsEmailVerifyError` incremented |
| MEV returns `{status:'error', errorKind:'transient_retried'}` | Same with `errorCode='transient_retried'` |
| MEV returns `{status:'skipped'}` (no API key mock) | Lead proceeds through pipeline to `status='ready'`, `emailStatus='verify_skipped'` |
| Atomic insert: force `tx.email.create` to throw | After pipeline, `prisma.lead.findMany({where:{contactEmail:…}})` returns zero rows — rollback verified |
| P2002 on lead insert (pre-seed a conflicting row, run pipeline) | `leadsSkipped` bumped, error_log entry with `source='findLeads.dedup_race'`, pipeline completes normally (does not crash) |
| Case-insensitive pre-check | Pre-seed lead with `'JOHN@acme.com'`; Gemini returns `'john@acme.com'` → skipped by in-memory Set (verify `verifyEmail` mock zero calls — not even the pre-check reached it, because Stage 8 dedup runs after extraction but before T2... wait, see note below) |

**Note on dedup ordering**: In the current pipeline, dedup (Stage 8) runs *after* extraction but *before* ICP scoring. Regex validation (T2) runs inside the Stage 7 worker, before MEV. So the ordering under Chunk 1 is:

```
Stage 1 Discovery → Stage 2-6 Extract → Gate 1 (tech+quality) → Stage 7 worker:
    T2 regex check → MEV call → T3 result branch → return
→ Gate 2 (confidence) → Stage 8 Dedup (Set pre-check, now normalized) → Stage 9 ICP → Stage 10/11 + T4 atomic insert
```

Dedup Set pre-check still runs after MEV, meaning malformed-email rejects don't benefit from dedup (they're dropped earlier). This is fine — dedup of malformed emails is meaningless.

### 7.4 Manual verification (documented, not automated)

| Step | Expected |
|---|---|
| `node scripts/audit_email_dupes.js` on a clean test DB | Exit 0, prints "0 duplicate groups" |
| Seed two leads with `'User@Foo.com'` + `'user@foo.com'`, run audit | Exit 1, both ids listed under same group |
| Apply migration on clean DB | Succeeds; `\d leads` shows `leads_contact_email_lower_unique` |
| Apply migration with dupes still present | Fails with Postgres unique-constraint error; no half-applied state |
| Post-migration, attempt `INSERT INTO leads (contact_email) VALUES ('DUP@x.com'), ('dup@x.com')` via psql | Second insert rejected |

### 7.5 Out of scope for Chunk 1 tests

- Load / throughput tests on Prisma `$transaction` — warmup phase does ~34 inserts/day.
- Real MEV API reliability profiling — operational, not test.
- Backfilling historical rows' `emailStatus` → not in scope; existing rows keep `NULL`.

## 8. Rollout plan

1. **Branch**: `chunk-1-data-integrity` (on top of current `main`)
2. **Commits** (targeted, each independently passing tests):
   1. Add `src/core/leads/integrity.js` + unit tests
   2. Rework `src/core/integrations/mev.js` with classified retry + unit tests
   3. Add audit script `scripts/audit_email_dupes.js`
   4. Create Prisma migration (hand-edit to add functional index + partial filter)
   5. Update `prisma/schema.prisma` (new DailyMetrics fields + Lead comment)
   6. Wire findLeads touchpoints T1–T7 + extend engine integration tests
3. **Pre-merge gates**: all tests green locally (`npm test`), `node scripts/audit_email_dupes.js` exits 0 on local / staging DB, `npx prisma migrate diff` clean.
4. **Merge → deploy**:
   1. Pull on VPS, run `node scripts/audit_email_dupes.js` against prod DB.
   2. If clean → `npx prisma migrate deploy` → `pm2 reload radar-cron radar-dashboard`.
   3. If dirty → resolve manually, re-audit, then deploy.
5. **Post-deploy verification**:
   - Trigger a manual findLeads run (or wait for the next cron fire).
   - Query: `SELECT status, COUNT(*) FROM leads WHERE DATE(discovered_at) = CURRENT_DATE GROUP BY status;` — expect to see `email_malformed` and possibly `email_verify_error` show up alongside existing statuses.
   - Query: `SELECT leads_email_malformed, leads_email_verify_error FROM daily_metrics WHERE date = CURRENT_DATE;` — non-zero only if Gemini produced malformed emails or MEV errored.
   - Tail `error_log WHERE source IN ('findLeads.mev', 'findLeads.dedup_race')` for first week — initial rate informs Chunk 2/3 priorities.

## 9. Success criteria

Chunk 1 is complete when ALL of these hold:

- [ ] `src/core/leads/integrity.js` exists with the 4 utilities + 1 constant from §4.1, 100% unit-test coverage
- [ ] `src/core/integrations/mev.js` returns `errorKind` on error; classified retry verified by unit test
- [ ] Prisma migration applied to prod; `\d leads` shows `leads_contact_email_lower_unique` functional unique index
- [ ] `findLeads.js` T1–T7 all wired, engine integration test passes every scenario in §7.3
- [ ] New `DailyMetrics` counters visible on the dashboard (or at least queryable via the existing costs / engine-status routes)
- [ ] Audit script exits 0 against prod DB post-deploy (i.e., no latent duplicates)
- [ ] No `status='ready'` lead exists without a matching pending `emails` row (one-off verification query against prod)
- [ ] First week of error_log shows sensible distribution: occasional transient MEV retries, zero dedup_race entries (if non-zero, investigate — means the in-memory Set pre-check has a bug)

## 10. Open questions / followups for later chunks

Surfaced during Chunk 1 brainstorming, explicitly deferred:

- **Disposable-email dedicated status** — today lumped into `email_invalid` with `emailStatus='disposable'`. Consider splitting in Chunk 2.
- **Role-address allowlist per niche** — some niches (legal, old-school real estate) genuinely use `office@firmname.com` as the primary contact. Chunk 6 (quality depth + per-niche persona) is a natural place to add an opt-in override.
- **Dedup at domain-granularity beyond cooldown** — current logic blocks contacted domains for 90 days. Doesn't prevent contacting multiple people at the same company in the same run. Chunk 4 (send-side hardening, per-domain weekly cap) addresses this.
- **Historical `emailStatus` backfill** — existing leads have `NULL` in this column. Not worth a backfill; just means old dashboards show less granular data before 2026-04-21.
- **MEV cost attribution on retry** — current design bumps cost once per successful call. If MEV starts billing for failures, revisit.

---

**End of Chunk 1 spec.** Subsequent chunks (2–7) will be specified in separate documents as they come up for implementation.
