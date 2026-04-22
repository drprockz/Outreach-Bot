# Pipeline Hardening — Chunk 1: Data-Integrity Foundation — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Radar lead-enrichment pipeline safe to scale by closing four load-bearing correctness gaps: non-atomic lead+email insert, missing unique constraint on `contactEmail`, silent MEV-error pass-through, and no regex/role-address validation on Gemini-guessed emails. Ship as a single PR that leaves the pipeline strictly more reliable than before and unblocks Chunks 2–7.

**Architecture:** Introduce a new pure utility module `src/core/leads/integrity.js` with 4 functions (`normalizeEmail`, `validateContactEmail`, `classifyAxiosError`) and 1 frozen Set (`ROLE_ADDRESSES`). Rework `src/core/integrations/mev.js` to classify axios errors and retry once on transient failures. Wrap `src/engines/findLeads.js` lead+email insert in a Prisma interactive transaction. Add a Postgres partial functional unique index on `LOWER(contact_email)` via a hand-edited Prisma migration. Add an audit script to detect pre-existing duplicates before migrating.

**Tech Stack:** Node.js 20 ESM, Prisma 6.19 + PostgreSQL, vitest 1.6, axios 1.7. No new runtime dependencies.

**Spec reference:** [`docs/superpowers/specs/2026-04-21-pipeline-hardening-chunk-1-data-integrity-design.md`](../specs/2026-04-21-pipeline-hardening-chunk-1-data-integrity-design.md)

**Implementation chunks (sequential, one PR total):**

| # | Chunk | Summary | Lines |
|---|---|---|---|
| A | Integrity module | New file `src/core/leads/integrity.js` + unit tests. Pure, no DB. | ~300 |
| B | MEV rework | Classified retry in `src/core/integrations/mev.js` + extended unit tests. Depends on A. | ~200 |
| C | Schema + migration + audit script | Prisma migration (functional unique index + 3 new metrics), schema.prisma edits, `scripts/audit_email_dupes.js`. | ~250 |
| D | findLeads wiring + integration tests | 7 touchpoints (T1–T7) in `src/engines/findLeads.js`, extended `tests/engines/findLeads.test.js` + `tests/engines/insertLead.test.js`. Depends on A, B, C. | ~600 |

**Commit cadence:** One commit per chunk (4 total). Within a chunk, use TDD — tests first, verify red, implement, verify green, then ONE commit that bundles tests + implementation. No "test commit, then impl commit" splits — it leaves an intermediate red-CI state.

**Global TDD rule:** Every behavior change writes the failing test first, runs to confirm failure, implements minimal code, re-runs to confirm pass. Refactors of existing test fixtures (e.g., changing the `info@betasalon.in` mock to a non-role email to stop tripping the new T2 gate) are commit-grouped with the behavior change that requires them, NOT as standalone refactor commits.

**Deploy rule:** The schema migration in Chunk C is the only irreversible piece. Run `scripts/audit_email_dupes.js` against prod BEFORE `npx prisma migrate deploy`. If the audit exits non-zero, resolve duplicates manually (delete losers or merge) and re-audit until clean. Migration must be applied outside the 09:30–17:30 IST send window (currently `DAILY_SEND_LIMIT=0` so this window is effectively dormant, but hold to the convention).

**Rollback strategy:** If the deployed code misbehaves, revert the PR via `git revert` + redeploy. The migration itself (adding a unique index and 3 counter columns) is forward-safe; rolling the index back is `DROP INDEX leads_contact_email_lower_unique;` + `ALTER TABLE daily_metrics DROP COLUMN ...` but shouldn't be needed.

---

## Chunk A: Integrity Module

**Files:**
- Create: `src/core/leads/integrity.js`
- Create: `tests/core/leads/integrity.test.js`

**Responsibility:** Pure, side-effect-free utilities for email normalization, validation, and axios error classification. Consumed by `mev.js` (Chunk B) and `findLeads.js` (Chunk D). Also slated for reuse in Chunks 4/5.

**File-size check:** Integrity module expected ~120 lines (4 small functions + a 17-entry frozen Set + JSDoc). Test file ~200 lines. Both well under any "getting unwieldy" threshold.

### Task A.1: Scaffold the test file with failing `normalizeEmail` tests

**Files:**
- Create: `tests/core/leads/integrity.test.js`

- [ ] **Step 1: Create the test file with normalizeEmail test cases**

Create `tests/core/leads/integrity.test.js` with the following content:

```js
import { describe, it, expect } from 'vitest';

describe('normalizeEmail', () => {
  it('returns null for null/undefined/empty/whitespace-only input', async () => {
    const { normalizeEmail } = await import('../../../src/core/leads/integrity.js');
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
    expect(normalizeEmail('')).toBeNull();
    expect(normalizeEmail('   ')).toBeNull();
    expect(normalizeEmail('\t\n')).toBeNull();
  });

  it('lowercases and trims', async () => {
    const { normalizeEmail } = await import('../../../src/core/leads/integrity.js');
    expect(normalizeEmail('  Foo@Bar.COM ')).toBe('foo@bar.com');
    expect(normalizeEmail('JOHN@ACME.IN')).toBe('john@acme.in');
  });

  it('preserves +tag and dots in the local-part', async () => {
    const { normalizeEmail } = await import('../../../src/core/leads/integrity.js');
    expect(normalizeEmail('foo+tag@x.com')).toBe('foo+tag@x.com');
    expect(normalizeEmail('First.Last@x.com')).toBe('first.last@x.com');
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run:
```bash
cd /Users/drprockz/Projects/Outreach/.claude/worktrees/epic-diffie-b30d39
npx vitest run tests/core/leads/integrity.test.js
```

Expected output: FAIL with "Cannot find module '../../../src/core/leads/integrity.js'" or equivalent — the module doesn't exist yet.

### Task A.2: Create `integrity.js` with `normalizeEmail`

**Files:**
- Create: `src/core/leads/integrity.js`

- [ ] **Step 1: Create the module with only `normalizeEmail`**

Create `src/core/leads/integrity.js`:

```js
/**
 * Pure utilities for lead-email integrity.
 *
 * All functions here are side-effect-free (no DB, no network, no env reads
 * beyond what callers pass in). Consumed by mev.js and findLeads.js;
 * Chunks 4/5 of the pipeline-hardening roadmap will also consume them.
 *
 * Spec: docs/superpowers/specs/2026-04-21-pipeline-hardening-chunk-1-data-integrity-design.md §4.1
 */

/**
 * Canonicalize an email for storage and comparison.
 *
 * Single source of truth for "how we store emails." Every write site MUST
 * route through this before persisting to the DB, and every read that
 * compares against a stored value should normalize the comparison operand.
 *
 * @param {string | null | undefined} raw
 * @returns {string | null} normalized email, or null for empty / whitespace-only input
 */
export function normalizeEmail(raw) {
  if (raw === null || raw === undefined) return null;
  const trimmed = String(raw).trim();
  if (trimmed.length === 0) return null;
  return trimmed.toLowerCase();
}
```

- [ ] **Step 2: Run tests to verify normalizeEmail passes**

Run:
```bash
npx vitest run tests/core/leads/integrity.test.js
```

Expected output: 3 tests pass.

### Task A.3: Add failing tests for `ROLE_ADDRESSES` + `validateContactEmail`

**Files:**
- Modify: `tests/core/leads/integrity.test.js`

- [ ] **Step 1: Append ROLE_ADDRESSES + validateContactEmail tests**

Append to `tests/core/leads/integrity.test.js`:

```js
describe('ROLE_ADDRESSES', () => {
  it('contains exactly the 17 documented role prefixes', async () => {
    const { ROLE_ADDRESSES } = await import('../../../src/core/leads/integrity.js');
    const expected = [
      'info', 'support', 'contact', 'hello', 'admin', 'sales',
      'noreply', 'no-reply', 'team', 'office', 'enquiry', 'enquiries',
      'help', 'feedback', 'webmaster', 'postmaster', 'abuse',
    ];
    expect(ROLE_ADDRESSES.size).toBe(17);
    for (const prefix of expected) {
      expect(ROLE_ADDRESSES.has(prefix)).toBe(true);
    }
  });

  it('is frozen — add() on the Set throws or is a no-op', async () => {
    const { ROLE_ADDRESSES } = await import('../../../src/core/leads/integrity.js');
    // Object.freeze on a Set makes .add() a no-op (doesn't throw in non-strict mode
    // but in strict-mode ESM this throws). Either behavior is acceptable — just
    // assert the Set cannot grow.
    try { ROLE_ADDRESSES.add('extra'); } catch { /* frozen */ }
    expect(ROLE_ADDRESSES.has('extra')).toBe(false);
    expect(ROLE_ADDRESSES.size).toBe(17);
  });
});

describe('validateContactEmail', () => {
  it('returns ok:true with normalized email for well-formed addresses', async () => {
    const { validateContactEmail } = await import('../../../src/core/leads/integrity.js');
    expect(validateContactEmail('Rajesh@Acme.In')).toEqual({ ok: true, email: 'rajesh@acme.in' });
    expect(validateContactEmail('first.last@company.co.uk')).toEqual({ ok: true, email: 'first.last@company.co.uk' });
    expect(validateContactEmail('foo+tag@x.com')).toEqual({ ok: true, email: 'foo+tag@x.com' });
  });

  it('returns reason:empty for null/undefined/empty/whitespace', async () => {
    const { validateContactEmail } = await import('../../../src/core/leads/integrity.js');
    expect(validateContactEmail(null)).toEqual({ ok: false, reason: 'empty' });
    expect(validateContactEmail(undefined)).toEqual({ ok: false, reason: 'empty' });
    expect(validateContactEmail('')).toEqual({ ok: false, reason: 'empty' });
    expect(validateContactEmail('   ')).toEqual({ ok: false, reason: 'empty' });
  });

  it('returns reason:shape for malformed addresses', async () => {
    const { validateContactEmail } = await import('../../../src/core/leads/integrity.js');
    expect(validateContactEmail('no-at.com').reason).toBe('shape');
    expect(validateContactEmail('no@tld').reason).toBe('shape');
    expect(validateContactEmail('has space@x.com').reason).toBe('shape');
    expect(validateContactEmail('double@@x.com').reason).toBe('shape');
    expect(validateContactEmail('trailing@').reason).toBe('shape');
    expect(validateContactEmail('@leading.com').reason).toBe('shape');
  });

  it('returns reason:role for role-address local parts (case-insensitive)', async () => {
    const { validateContactEmail, ROLE_ADDRESSES } = await import('../../../src/core/leads/integrity.js');
    for (const prefix of ROLE_ADDRESSES) {
      expect(validateContactEmail(`${prefix}@example.com`).reason).toBe('role');
      expect(validateContactEmail(`${prefix.toUpperCase()}@example.com`).reason).toBe('role');
    }
    // Mixed case specific cases
    expect(validateContactEmail('Info@X.com').reason).toBe('role');
    expect(validateContactEmail('SUPPORT@y.org').reason).toBe('role');
  });

  it('passes non-role local parts that happen to contain role substrings', async () => {
    const { validateContactEmail } = await import('../../../src/core/leads/integrity.js');
    // "info" is rejected, but "information" / "infoline" should pass because
    // the local-part must EXACTLY match a role prefix, not contain one
    expect(validateContactEmail('information@x.com').ok).toBe(true);
    expect(validateContactEmail('salesman@x.com').ok).toBe(true);
    expect(validateContactEmail('office123@x.com').ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to confirm new ones fail**

Run:
```bash
npx vitest run tests/core/leads/integrity.test.js
```

Expected output: normalizeEmail tests pass (3); ROLE_ADDRESSES + validateContactEmail tests fail with "ROLE_ADDRESSES is not exported" / "validateContactEmail is not a function."

### Task A.4: Implement `ROLE_ADDRESSES` and `validateContactEmail`

**Files:**
- Modify: `src/core/leads/integrity.js`

- [ ] **Step 1: Append ROLE_ADDRESSES and validateContactEmail**

Append to `src/core/leads/integrity.js`:

```js
/**
 * Local-parts that are always rejected regardless of domain. These are shared
 * inboxes where cold emails go to die, never decision-makers.
 *
 * Frozen (via Object.freeze) so tests and callers cannot mutate shared state.
 * Extension mechanics for later chunks (e.g., per-niche overrides in Chunk 6)
 * are deliberately NOT designed here — YAGNI.
 */
export const ROLE_ADDRESSES = Object.freeze(new Set([
  'info', 'support', 'contact', 'hello', 'admin', 'sales',
  'noreply', 'no-reply', 'team', 'office', 'enquiry', 'enquiries',
  'help', 'feedback', 'webmaster', 'postmaster', 'abuse',
]));

// RFC-lax shape check: exactly one @, at least one dot in the domain part,
// no whitespace anywhere. Intentionally permissive — we're filtering junk,
// not validating RFC 5322.
const EMAIL_SHAPE_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Composite validation: shape + role-address rejection.
 *
 * Order: normalize → shape → role. Short-circuits on first failure.
 *
 * @param {string | null | undefined} raw
 * @returns {{ok: true, email: string} | {ok: false, reason: 'empty' | 'shape' | 'role'}}
 */
export function validateContactEmail(raw) {
  const normalized = normalizeEmail(raw);
  if (normalized === null) return { ok: false, reason: 'empty' };
  if (!EMAIL_SHAPE_RE.test(normalized)) return { ok: false, reason: 'shape' };

  const localPart = normalized.split('@')[0];
  if (ROLE_ADDRESSES.has(localPart)) return { ok: false, reason: 'role' };

  return { ok: true, email: normalized };
}
```

- [ ] **Step 2: Run tests to verify all integrity tests pass so far**

Run:
```bash
npx vitest run tests/core/leads/integrity.test.js
```

Expected output: All tests pass (normalizeEmail: 3, ROLE_ADDRESSES: 2, validateContactEmail: 5). Total 10 green.

### Task A.5: Add failing tests for `classifyAxiosError`

**Files:**
- Modify: `tests/core/leads/integrity.test.js`

- [ ] **Step 1: Append classifyAxiosError tests**

Append to `tests/core/leads/integrity.test.js`:

```js
describe('classifyAxiosError', () => {
  it('classifies network codes as transient', async () => {
    const { classifyAxiosError } = await import('../../../src/core/leads/integrity.js');
    expect(classifyAxiosError({ code: 'ECONNABORTED' })).toBe('transient');
    expect(classifyAxiosError({ code: 'ECONNRESET' })).toBe('transient');
    expect(classifyAxiosError({ code: 'ENOTFOUND' })).toBe('transient');
  });

  it('classifies 5xx responses as transient', async () => {
    const { classifyAxiosError } = await import('../../../src/core/leads/integrity.js');
    expect(classifyAxiosError({ response: { status: 500 } })).toBe('transient');
    expect(classifyAxiosError({ response: { status: 502 } })).toBe('transient');
    expect(classifyAxiosError({ response: { status: 503 } })).toBe('transient');
    expect(classifyAxiosError({ response: { status: 504 } })).toBe('transient');
  });

  it('classifies 429 as transient', async () => {
    const { classifyAxiosError } = await import('../../../src/core/leads/integrity.js');
    expect(classifyAxiosError({ response: { status: 429 } })).toBe('transient');
  });

  it('classifies 4xx non-429 as permanent', async () => {
    const { classifyAxiosError } = await import('../../../src/core/leads/integrity.js');
    expect(classifyAxiosError({ response: { status: 400 } })).toBe('permanent');
    expect(classifyAxiosError({ response: { status: 401 } })).toBe('permanent');
    expect(classifyAxiosError({ response: { status: 403 } })).toBe('permanent');
    expect(classifyAxiosError({ response: { status: 404 } })).toBe('permanent');
  });

  it('classifies unknown error shapes as permanent (fail-safe)', async () => {
    const { classifyAxiosError } = await import('../../../src/core/leads/integrity.js');
    expect(classifyAxiosError({})).toBe('permanent');
    expect(classifyAxiosError(undefined)).toBe('permanent');
    expect(classifyAxiosError(null)).toBe('permanent');
    expect(classifyAxiosError(new Error('generic'))).toBe('permanent');
  });
});
```

- [ ] **Step 2: Run tests to confirm new ones fail**

Run:
```bash
npx vitest run tests/core/leads/integrity.test.js
```

Expected output: earlier tests pass; classifyAxiosError tests fail with "classifyAxiosError is not a function."

### Task A.6: Implement `classifyAxiosError` and commit Chunk A

**Files:**
- Modify: `src/core/leads/integrity.js`

- [ ] **Step 1: Append classifyAxiosError**

Append to `src/core/leads/integrity.js`:

```js
/**
 * Classify an axios error as transient (worth retrying) or permanent
 * (no point retrying — either misconfig or a definitive rejection).
 *
 * Fail-safe: unknown error shapes classify as 'permanent'. We'd rather
 * fail loud on config errors than spin-retry on a 401.
 *
 * @param {unknown} err
 * @returns {'transient' | 'permanent'}
 */
export function classifyAxiosError(err) {
  if (!err || typeof err !== 'object') return 'permanent';

  // Network-layer failures (no HTTP response received)
  const code = err.code;
  if (code === 'ECONNABORTED' || code === 'ECONNRESET' || code === 'ENOTFOUND') {
    return 'transient';
  }

  // HTTP-layer failures
  const status = err.response?.status;
  if (typeof status === 'number') {
    if (status === 429) return 'transient';              // rate-limited
    if (status >= 500 && status < 600) return 'transient'; // server error
    return 'permanent';                                   // 4xx non-429, 3xx, 1xx
  }

  return 'permanent';
}
```

- [ ] **Step 2: Run all integrity tests to verify complete module**

Run:
```bash
npx vitest run tests/core/leads/integrity.test.js
```

Expected output: All tests pass. Total 15 green across 4 describe blocks.

- [ ] **Step 3: Run the full test suite to confirm no regressions**

Run:
```bash
npm test
```

Expected output: All existing tests still pass (pre-existing count + 15 new from integrity). Note no existing code imports `integrity.js` yet — this chunk is purely additive.

- [ ] **Step 4: Commit Chunk A**

Run:
```bash
git add src/core/leads/integrity.js tests/core/leads/integrity.test.js
git commit -m "$(cat <<'EOF'
feat(integrity): add pure utility module for email + error classification

Introduces src/core/leads/integrity.js with:
- normalizeEmail(raw) — single source of truth for email storage shape
- validateContactEmail(raw) — composite shape + role-address gate
- ROLE_ADDRESSES — frozen Set of 17 rejected local-parts
- classifyAxiosError(err) — transient vs permanent for retry decisions

Pure module, no side effects. Will be consumed by mev.js (next) and
findLeads.js (Chunk D). 15 unit tests, 100% covered.

Spec: docs/superpowers/specs/2026-04-21-pipeline-hardening-chunk-1-data-integrity-design.md §4.1
EOF
)"
```

Expected output: commit succeeds, 2 files changed.

---

## Chunk B: MEV Rework

**Files:**
- Modify: `src/core/integrations/mev.js`
- Modify: `tests/core/integrations/mev.test.js`

**Responsibility:** Rework the MEV axios wrapper to classify errors, retry once on transient failures, and return an `errorKind` discriminator. The existing `{status:'error', confidence:0}` silent pass-through is replaced with explicit classified returns so findLeads can gate on them.

**File-size check:** `mev.js` today is 34 lines; post-rework ~60 lines. Test file grows from 26 lines to ~150. Both focused on a single integration.

### Task B.1: Extend `mev.test.js` with the new behavior contract

**Files:**
- Modify: `tests/core/integrations/mev.test.js`

- [ ] **Step 1: Replace the existing test file with the extended version**

Overwrite `tests/core/integrations/mev.test.js` with:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

// We'll reconfigure the axios mock per-test via vi.doMock
vi.mock('axios', () => ({ default: { get: vi.fn() } }));
vi.mock('../../../src/core/db/index.js', () => ({
  bumpCostMetric: vi.fn(async () => {}),
}));

beforeEach(() => {
  vi.resetModules();
});

describe('verifyEmail', () => {
  it('returns skipped when no API key (unchanged behavior)', async () => {
    delete process.env.MEV_API_KEY;
    const axios = (await import('axios')).default;
    const { verifyEmail } = await import('../../../src/core/integrations/mev.js');
    const result = await verifyEmail('test@example.com');
    expect(result).toEqual({ status: 'skipped', confidence: 0 });
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('returns valid + confidence on successful first call', async () => {
    process.env.MEV_API_KEY = 'test-key';
    const axios = (await import('axios')).default;
    axios.get.mockResolvedValueOnce({ data: { status: 'valid', score: 0.95 } });

    const { verifyEmail } = await import('../../../src/core/integrations/mev.js');
    const result = await verifyEmail('good@example.com');
    expect(result.status).toBe('valid');
    expect(result.confidence).toBe(0.95);
    expect(axios.get).toHaveBeenCalledTimes(1);
    expect(result.errorKind).toBeUndefined();
  });

  it('passes through successful invalid/disposable/unknown verdicts WITHOUT retry', async () => {
    process.env.MEV_API_KEY = 'test-key';
    const axios = (await import('axios')).default;
    axios.get.mockResolvedValueOnce({ data: { status: 'invalid', score: 0 } });

    const { verifyEmail } = await import('../../../src/core/integrations/mev.js');
    const result = await verifyEmail('bad@example.com');
    expect(result.status).toBe('invalid');
    expect(axios.get).toHaveBeenCalledTimes(1);   // NO retry on verdict
    expect(result.errorKind).toBeUndefined();
  });

  it('retries once on transient error then succeeds', async () => {
    process.env.MEV_API_KEY = 'test-key';
    const axios = (await import('axios')).default;
    axios.get
      .mockRejectedValueOnce({ code: 'ECONNABORTED' })
      .mockResolvedValueOnce({ data: { status: 'valid', score: 0.9 } });

    const { verifyEmail } = await import('../../../src/core/integrations/mev.js');
    const result = await verifyEmail('flaky@example.com');
    expect(result.status).toBe('valid');
    expect(axios.get).toHaveBeenCalledTimes(2);
    expect(result.errorKind).toBeUndefined();
  });

  it('returns error:transient_retried when retry also fails', async () => {
    process.env.MEV_API_KEY = 'test-key';
    const axios = (await import('axios')).default;
    axios.get.mockRejectedValue({ code: 'ECONNRESET' });

    const { verifyEmail } = await import('../../../src/core/integrations/mev.js');
    const result = await verifyEmail('dead@example.com');
    expect(result).toEqual({ status: 'error', confidence: 0, errorKind: 'transient_retried' });
    expect(axios.get).toHaveBeenCalledTimes(2);
  });

  it('returns error:permanent WITHOUT retry on permanent error', async () => {
    process.env.MEV_API_KEY = 'test-key';
    const axios = (await import('axios')).default;
    axios.get.mockRejectedValue({ response: { status: 401 } });

    const { verifyEmail } = await import('../../../src/core/integrations/mev.js');
    const result = await verifyEmail('whatever@example.com');
    expect(result).toEqual({ status: 'error', confidence: 0, errorKind: 'permanent' });
    expect(axios.get).toHaveBeenCalledTimes(1);   // NO retry
  });

  it('bumps cost exactly once on successful call (no double-charge on retry)', async () => {
    process.env.MEV_API_KEY = 'test-key';
    const axios = (await import('axios')).default;
    axios.get
      .mockRejectedValueOnce({ code: 'ECONNABORTED' })
      .mockResolvedValueOnce({ data: { status: 'valid', score: 0.9 } });

    const { bumpCostMetric } = await import('../../../src/core/db/index.js');
    const { verifyEmail } = await import('../../../src/core/integrations/mev.js');
    await verifyEmail('flaky@example.com');
    expect(bumpCostMetric).toHaveBeenCalledTimes(1);
  });

  it('does not bump cost when both attempts fail', async () => {
    process.env.MEV_API_KEY = 'test-key';
    const axios = (await import('axios')).default;
    axios.get.mockRejectedValue({ code: 'ECONNABORTED' });

    const { bumpCostMetric } = await import('../../../src/core/db/index.js');
    const { verifyEmail } = await import('../../../src/core/integrations/mev.js');
    await verifyEmail('dead@example.com');
    expect(bumpCostMetric).not.toHaveBeenCalled();
  });

  it('does not bump cost on permanent error', async () => {
    process.env.MEV_API_KEY = 'test-key';
    const axios = (await import('axios')).default;
    axios.get.mockRejectedValue({ response: { status: 403 } });

    const { bumpCostMetric } = await import('../../../src/core/db/index.js');
    const { verifyEmail } = await import('../../../src/core/integrations/mev.js');
    await verifyEmail('whatever@example.com');
    expect(bumpCostMetric).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to confirm tests fail**

Run:
```bash
npx vitest run tests/core/integrations/mev.test.js
```

Expected output: The 2 original-style tests still pass (skipped + valid-on-success are preserved contracts). The 7 new tests fail — either the `errorKind` field is missing, or retry behavior is absent, or cost bumping is wrong.

### Task B.2: Rework `mev.js` to match the new contract

**Files:**
- Modify: `src/core/integrations/mev.js`

- [ ] **Step 1: Replace mev.js contents**

Overwrite `src/core/integrations/mev.js` with:

```js
import axios from 'axios';
import 'dotenv/config';
import { bumpCostMetric } from '../db/index.js';
import { classifyAxiosError } from '../leads/integrity.js';

const MEV_BASE = 'https://api.myemailverifier.com/verify';

// MEV PAYG cost: $0.00288 per verification
const MEV_COST_PER_VERIFY = 0.00288;

// Retry backoff for transient errors — single flat delay, no exponential.
// Sized against MEV's p99 latency (~1s) so retries land after transient glitches clear.
const RETRY_DELAY_MS = 500;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function callMev(email) {
  const { data } = await axios.get(MEV_BASE, {
    params: { secret: process.env.MEV_API_KEY, email },
    timeout: 10000,
  });
  // Best-effort cost bump — DB errors must not break verification.
  try {
    await bumpCostMetric('mevCostUsd', MEV_COST_PER_VERIFY);
  } catch { /* swallow; Chunk 3 will add proper observability */ }
  const confidence = data.score ?? (data.status === 'valid' ? 0.9 : 0);
  return { status: data.status, confidence };
}

/**
 * Verify an email via MyEmailVerifier with classified retry.
 *
 * Return shapes:
 *   - { status: 'skipped',  confidence: 0 }                             // no API key
 *   - { status: 'valid' | 'invalid' | 'disposable' | 'unknown', confidence }  // MEV verdict
 *   - { status: 'error', confidence: 0, errorKind: 'permanent' }        // 4xx non-429, unknown err shape
 *   - { status: 'error', confidence: 0, errorKind: 'transient_retried' } // transient err + retry also failed
 *
 * Retry rules:
 *   - Only thrown exceptions (network / 5xx / 429) trigger retry.
 *   - A successful HTTP 200 returning { status: 'invalid' } is a verdict, NOT an error.
 *   - Single retry, 500ms flat delay. No exponential backoff.
 *   - Cost is bumped only on 200 success (either first try or retry).
 *
 * Spec: docs/superpowers/specs/2026-04-21-pipeline-hardening-chunk-1-data-integrity-design.md §4.2
 *
 * @param {string} email
 * @returns {Promise<{status: string, confidence: number, errorKind?: 'permanent'|'transient_retried'}>}
 */
export async function verifyEmail(email) {
  if (!process.env.MEV_API_KEY) {
    return { status: 'skipped', confidence: 0 };
  }

  try {
    return await callMev(email);
  } catch (err1) {
    const kind = classifyAxiosError(err1);
    if (kind === 'permanent') {
      return { status: 'error', confidence: 0, errorKind: 'permanent' };
    }
    // transient — wait 500ms, retry once
    await sleep(RETRY_DELAY_MS);
    try {
      return await callMev(email);
    } catch {
      return { status: 'error', confidence: 0, errorKind: 'transient_retried' };
    }
  }
}
```

- [ ] **Step 2: Run MEV tests to verify**

Run:
```bash
npx vitest run tests/core/integrations/mev.test.js
```

Expected output: All 9 tests pass (2 preserved contracts + 7 new).

- [ ] **Step 3: Run full test suite to confirm no regressions elsewhere**

Run:
```bash
npm test
```

Expected output: All existing tests pass. `findLeads.test.js` still uses the `verifyEmail` mock at `vi.mock('../../src/core/integrations/mev.js', ...)` so it's unaffected by the real mev.js rework.

- [ ] **Step 4: Commit Chunk B**

Run:
```bash
git add src/core/integrations/mev.js tests/core/integrations/mev.test.js
git commit -m "$(cat <<'EOF'
feat(mev): classified retry — distinguish transient vs permanent errors

Reworks src/core/integrations/mev.js to use classifyAxiosError() from the
integrity module. Transient errors (network / 5xx / 429) get a single
500ms-delayed retry; permanent errors (4xx non-429, unknown shapes) are
not retried. Returns errorKind as a discriminator on error results.

Cost ledger bumps only on HTTP-200 success, not on retries that fail.
Successful "invalid"/"disposable"/"unknown" verdicts pass through with
NO retry — a verdict is not an error.

9 unit tests cover all branches. Existing findLeads integration test
is unaffected (it mocks verifyEmail directly).

Spec: docs/superpowers/specs/2026-04-21-pipeline-hardening-chunk-1-data-integrity-design.md §4.2
EOF
)"
```

Expected output: commit succeeds, 2 files changed.

---

## Chunk C: Schema Migration + Audit Script

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_chunk1_integrity/migration.sql`
- Create: `scripts/audit_email_dupes.js`
- (No new test file — audit script is manually verified per spec §7.4)

**Responsibility:** DB-side enforcement of the uniqueness invariant. Introduces a functional partial unique index on `LOWER(contact_email)`. Adds 3 new `DailyMetrics` counters. Ships a pre-migration audit script so operator can catch latent duplicates before the migration fails.

**File-size check:** Schema diff ~12 lines. Migration SQL ~15 lines. Audit script ~80 lines. All small, single-purpose.

### Task C.1: Update `prisma/schema.prisma`

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add 3 new DailyMetrics fields**

Find the `DailyMetrics` model block. Add these three lines inside it, immediately after `leadsEmailValid` (~line 211) to keep all `leadsEmail*` counters grouped together:

```prisma
  leadsEmailMalformed       Int      @default(0) @map("leads_email_malformed")
  leadsEmailVerifyError     Int      @default(0) @map("leads_email_verify_error")
  leadsEmailVerifySkipped   Int      @default(0) @map("leads_email_verify_skipped")
```

- [ ] **Step 2: Add documenting comment on `Lead.contactEmail`**

Find the `Lead` model block. Replace the line:

```prisma
  contactEmail          String?   @map("contact_email")
```

With:

```prisma
  contactEmail          String?   @map("contact_email")
  // UNIQUE constraint enforced by partial functional index
  // `leads_contact_email_lower_unique` defined in migration
  // `chunk1_integrity`. Not expressible in Prisma schema — do not remove
  // the raw SQL migration. All writes MUST route through normalizeEmail()
  // in src/core/leads/integrity.js.
```

- [ ] **Step 3: Run `prisma format` and confirm no unexpected diff**

Run:
```bash
npx prisma format
git diff prisma/schema.prisma
```

Expected: only the intended additions show up (3 fields + comment). No other changes.

### Task C.2: Generate and hand-edit the migration

**Files:**
- Create: `prisma/migrations/<timestamp>_chunk1_integrity/migration.sql`

- [ ] **Step 1: Create the migration (without applying)**

Run:
```bash
npx prisma migrate dev --create-only --name chunk1_integrity
```

Expected: Prisma generates a new `prisma/migrations/<timestamp>_chunk1_integrity/migration.sql` containing ONLY the `ALTER TABLE daily_metrics ADD COLUMN ...` for the 3 new fields. The Lead comment change is comment-only; no SQL generated for it.

- [ ] **Step 2: Hand-edit the migration to add the functional unique index**

Open the generated `prisma/migrations/<timestamp>_chunk1_integrity/migration.sql`. **Fully replace its contents** (Prisma's auto-generated `ALTER TABLE` for the 3 new columns gets replaced by our idempotent `ADD COLUMN IF NOT EXISTS` version, and the functional index block is appended — Prisma cannot generate this) with:

```sql
-- Chunk 1 of pipeline-hardening roadmap.
-- Spec: docs/superpowers/specs/2026-04-21-pipeline-hardening-chunk-1-data-integrity-design.md

-- 1. Partial functional unique index on normalized contact_email.
-- Partial (`WHERE contact_email IS NOT NULL`) so that rows with NULL email
-- don't collide on LOWER(NULL). Intentional — legitimate use case (extraction
-- failed to find an email). Not expressible in Prisma schema.
CREATE UNIQUE INDEX leads_contact_email_lower_unique
  ON leads (LOWER(contact_email))
  WHERE contact_email IS NOT NULL;

-- 2. New DailyMetrics counters.
-- IF NOT EXISTS so this file is idempotent with Prisma's own generated
-- ALTER TABLE (in case someone runs `prisma migrate dev` and regens).
ALTER TABLE daily_metrics
  ADD COLUMN IF NOT EXISTS leads_email_malformed        INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS leads_email_verify_error     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS leads_email_verify_skipped   INTEGER NOT NULL DEFAULT 0;
```

- [ ] **Step 3: Verify the file content**

Run:
```bash
cat prisma/migrations/*chunk1_integrity*/migration.sql
```

Expected: matches the content above.

### Task C.3: Write the audit script

**Files:**
- Create: `scripts/audit_email_dupes.js`

- [ ] **Step 1: Create the audit script**

Create `scripts/audit_email_dupes.js`:

```js
#!/usr/bin/env node
/**
 * Pre-migration audit: find duplicate contact_email values (case-insensitive)
 * in the `leads` table that would prevent the functional unique index from
 * being created.
 *
 * Exit codes:
 *   0 — clean (no duplicates); safe to run `npx prisma migrate deploy`
 *   1 — duplicates found; resolve manually before migrating
 *   2 — script error (DB unreachable, etc.)
 *
 * Usage:
 *   node scripts/audit_email_dupes.js
 *
 * Spec: docs/superpowers/specs/2026-04-21-pipeline-hardening-chunk-1-data-integrity-design.md §5.3
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Count total distinct normalized emails for context, and find duplicate groups.
  const [{ total }] = await prisma.$queryRaw`
    SELECT COUNT(DISTINCT LOWER(contact_email))::int AS total
      FROM leads
     WHERE contact_email IS NOT NULL
  `;

  const dupes = await prisma.$queryRaw`
    SELECT LOWER(contact_email) AS email_lower,
           COUNT(*)::int AS n,
           ARRAY_AGG(id ORDER BY id) AS ids
      FROM leads
     WHERE contact_email IS NOT NULL
     GROUP BY LOWER(contact_email)
    HAVING COUNT(*) > 1
     ORDER BY n DESC, email_lower ASC
     LIMIT 50
  `;

  if (dupes.length === 0) {
    console.log(`✅ 0 duplicate groups across ${total} normalized emails.`);
    console.log(`   Safe to run: npx prisma migrate deploy`);
    return 0;
  }

  const totalDupeRows = dupes.reduce((sum, g) => sum + g.n, 0);
  console.error(`❌ Found ${dupes.length} duplicate groups spanning ${totalDupeRows} rows (showing top 50):\n`);
  for (const g of dupes) {
    const idsStr = `[${g.ids.join(', ')}]`;
    console.error(`   ${g.email_lower.padEnd(40)} ×${g.n}  → ids: ${idsStr}`);
  }
  console.error(`\nResolution options:`);
  console.error(`  1. Manually resolve each group (recommended if count is small):`);
  console.error(`       - Review the rows in each group (SELECT * FROM leads WHERE id IN (...))`);
  console.error(`       - Delete the rows you don't want to keep, or merge data between them`);
  console.error(`       - Re-run this audit until it exits 0`);
  console.error(`  2. Heuristic cleanup (if count is large):`);
  console.error(`       - Write a one-off script: keep row with highest icp_score, tiebreak by oldest id`);
  console.error(`       - This script does NOT do this automatically — you are picking survivors by hand`);
  console.error(`\nMigration cannot proceed until duplicates are resolved.`);
  return 1;
}

main()
  .then(code => process.exit(code))
  .catch(err => {
    console.error('Audit script failed:', err);
    process.exit(2);
  })
  .finally(async () => { await prisma.$disconnect(); });
```

- [ ] **Step 2: Make the script executable (optional convenience)**

Run:
```bash
chmod +x scripts/audit_email_dupes.js
```

Expected: no output; file becomes executable.

### Task C.4: Manually verify migration + audit end-to-end locally

**Files:** (no code changes; verification only)

- [ ] **Step 1: Ensure test DB is clean (no leftover duplicates from prior runs)**

Run:
```bash
npm run test:db:reset
```

Expected output: Prisma resets the test DB schema to the pre-Chunk-1 state (no unique index yet; no new counters).

- [ ] **Step 2: Run the audit against the clean test DB**

Run:
```bash
DATABASE_URL="$DATABASE_URL_TEST" node scripts/audit_email_dupes.js
```

Expected: exit 0, prints "✅ 0 duplicate groups across 0 normalized emails." (No leads in a freshly-reset DB.)

- [ ] **Step 3: Seed two duplicate rows and re-run the audit**

Run:
```bash
DATABASE_URL="$DATABASE_URL_TEST" psql "$DATABASE_URL_TEST" -c "INSERT INTO leads (contact_email, status) VALUES ('Dup@Foo.com', 'discovered'), ('dup@foo.com', 'discovered');"
DATABASE_URL="$DATABASE_URL_TEST" node scripts/audit_email_dupes.js
echo "exit: $?"
```

Expected: exit 1, prints "❌ Found 1 duplicate groups spanning 2 rows", shows `dup@foo.com ×2 → ids: [1, 2]`.

- [ ] **Step 4: Apply the migration against the dirty DB — verify Postgres rejects it**

Run:
```bash
DATABASE_URL="$DATABASE_URL_TEST" npx prisma migrate deploy
```

Expected: Postgres fails with a unique constraint violation when trying to create the functional index. Migration does not apply.

- [ ] **Step 5: Clear the failed-migration marker, clean up the duplicate, re-audit, re-migrate**

When a migration fails mid-flight in Step 4, Prisma records it as "failed" in the `_prisma_migrations` table. Subsequent `prisma migrate deploy` calls will refuse to proceed until we tell Prisma the failed migration has been rolled back.

First, find the migration directory name:
```bash
ls prisma/migrations | grep chunk1_integrity
```
(Should output something like `20260421120000_chunk1_integrity`.)

Then run (substituting the actual directory name):
```bash
DATABASE_URL="$DATABASE_URL_TEST" npx prisma migrate resolve --rolled-back 20260421120000_chunk1_integrity
DATABASE_URL="$DATABASE_URL_TEST" psql "$DATABASE_URL_TEST" -c "DELETE FROM leads WHERE id = 2;"
DATABASE_URL="$DATABASE_URL_TEST" node scripts/audit_email_dupes.js
echo "exit: $?"
DATABASE_URL="$DATABASE_URL_TEST" npx prisma migrate deploy
```

Expected: `migrate resolve` succeeds silently; `DELETE` removes the duplicate; audit exits 0; migration applies cleanly.

**Nuclear cleanup option** (only if this sequence fails in some unanticipated way — e.g., leftover state from a manual `\watch` or Ctrl-C):
```bash
DATABASE_URL="$DATABASE_URL_TEST" npm run test:db:reset
# then re-run from Step 1
```
This resets the test DB to a pristine post-migration state. Safe because test DB has no real data.

- [ ] **Step 6: Verify the index exists**

Run:
```bash
DATABASE_URL="$DATABASE_URL_TEST" psql "$DATABASE_URL_TEST" -c "\d leads" | grep leads_contact_email_lower_unique
```

Expected: one row of output showing the unique index definition with `LOWER(contact_email)` and `WHERE contact_email IS NOT NULL`.

- [ ] **Step 7: Verify the new counters exist**

Run:
```bash
DATABASE_URL="$DATABASE_URL_TEST" psql "$DATABASE_URL_TEST" -c "\d daily_metrics" | grep -E "leads_email_(malformed|verify_error|verify_skipped)"
```

Expected: 3 matching rows.

- [ ] **Step 8: Clean up the test lead**

Run:
```bash
DATABASE_URL="$DATABASE_URL_TEST" psql "$DATABASE_URL_TEST" -c "DELETE FROM leads;"
```

Expected: no output; test DB is clean.

### Task C.5: Commit Chunk C

- [ ] **Step 1: Regenerate the Prisma client, then run the unit test suite**

The schema gained 3 new `DailyMetrics` fields, so the generated Prisma client is guaranteed to be stale until we regenerate. Subsequent chunks (specifically Chunk D) will reference these fields and fail to compile otherwise.

Run:
```bash
npx prisma generate
npm test
```

Expected: `prisma generate` outputs "Generated Prisma Client (v…)". `npm test`: all existing tests pass. The schema change is additive — nothing breaks.

- [ ] **Step 2: Commit**

Run:
```bash
git add prisma/schema.prisma prisma/migrations scripts/audit_email_dupes.js
git commit -m "$(cat <<'EOF'
feat(db): partial functional unique index on LOWER(contact_email) + audit

Adds DB-level enforcement of case-insensitive email uniqueness in the
leads table via a partial functional unique index (Postgres-specific,
not expressible in Prisma schema — lives in the migration's raw SQL).

Also adds 3 new DailyMetrics counters for observability:
- leadsEmailMalformed     (regex/role rejects from Chunk D)
- leadsEmailVerifyError   (MEV errors after retry from Chunk B)
- leadsEmailVerifySkipped (no-API-key pass-through, config-drift canary)

Introduces scripts/audit_email_dupes.js — pre-migration safety net that
lists latent duplicates and exits non-zero if any exist. Deploy docs
require running this before `prisma migrate deploy` in prod.

Spec: docs/superpowers/specs/2026-04-21-pipeline-hardening-chunk-1-data-integrity-design.md §4.1, §5
EOF
)"
```

Expected: commit succeeds, 3 files changed (+ the migration directory).

---

## Chunk D: findLeads Wiring + Integration Tests

**Files:**
- Modify: `src/engines/findLeads.js`
- Modify: `tests/engines/findLeads.test.js`
- Modify: `tests/engines/insertLead.test.js` (extend for `{tx}` arg)

**Responsibility:** Wire the integrity module + MEV rework into the pipeline via 7 code edits (T1–T7 from spec §4.3). Extend integration tests to cover every new branch. This is the biggest chunk; it's also where all the previously-hidden correctness invariants become enforced.

**File-size check:** `findLeads.js` today is ~520 lines. Chunk D adds ~110 lines (new branches + `safeInsertLead` helper + integrity import) and modifies ~50 lines (insertLead signature, dedup block rewrite, null-drop removal). Post-chunk ~580 lines — not ideal but in line with the existing file's responsibility as the pipeline orchestrator. A refactor to split the 11 stages into a `src/engines/findLeads/` directory is a good follow-up but is deliberately out of Chunk 1's scope. The integration test file grows by ~260 lines to ~510 total.

**Pre-chunk test fixture issue:** The existing integration test at [tests/engines/findLeads.test.js:27](tests/engines/findLeads.test.js:27) mocks Gemini to return `contact_email: 'info@betasalon.in'` for one of its two test leads. Under the new T2 regex gate, `info@` is a role address and gets dropped as `email_malformed` — which will break every existing assertion that expects `betasalon` to flow through. **Fix as part of this chunk:** change the mock to use a non-role email like `anya@betasalon.in`.

### Task D.1: Extend `insertLead()` signature with optional `{tx}` arg

**Files:**
- Modify: `src/engines/findLeads.js:25-66`
- Modify: `tests/engines/insertLead.test.js`

- [ ] **Step 1: Add failing test for the `{tx}` param**

Append to `tests/engines/insertLead.test.js` (inside the `describe('insertLead')` block):

```js
  it('uses the provided tx client when passed {tx}', async () => {
    const { insertLead } = await import('../../src/engines/findLeads.js');
    const prisma = getTestPrisma();

    // Wrap in a transaction that always rolls back — if insertLead uses `tx`,
    // no row should exist after the $transaction returns.
    try {
      await prisma.$transaction(async (tx) => {
        await insertLead(baseLead, { query: 'q' }, 'ready', { tx });
        throw new Error('forced rollback');
      });
    } catch (e) {
      expect(e.message).toBe('forced rollback');
    }

    const rows = await prisma.lead.findMany();
    expect(rows.length).toBe(0);
  });

  it('normalizes contact_email on insert', async () => {
    const { insertLead } = await import('../../src/engines/findLeads.js');
    await insertLead({ ...baseLead, contact_email: 'MixedCase@Example.COM' }, { query: 'q' }, 'ready');
    const prisma = getTestPrisma();
    const row = await prisma.lead.findFirst();
    expect(row.contactEmail).toBe('mixedcase@example.com');
  });
```

- [ ] **Step 2: Run the new tests to confirm they fail**

Run:
```bash
npx vitest run tests/engines/insertLead.test.js
```

Expected: the two new tests fail. `{tx}` arg is ignored (no rollback happens because default `prisma` is used), and normalization doesn't happen (row stores `'MixedCase@Example.COM'` verbatim).

- [ ] **Step 3: Update insertLead to accept `{tx}` and normalize email**

In `src/engines/findLeads.js`, replace the `insertLead` function at lines 25–66 with:

```js
// Exported for unit testing
export async function insertLead(lead, niche, status, { tx } = {}) {
  const client = tx ?? prisma;
  return client.lead.create({
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
      contactEmail: normalizeEmail(lead.contact_email),
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

- [ ] **Step 4: Add the integrity import at the top of findLeads.js**

In `src/engines/findLeads.js`, modify the import block (lines 1–8) to add the integrity import. Insert after line 7 (after `icpScorer` import):

```js
import { normalizeEmail, validateContactEmail } from '../core/leads/integrity.js';
```

The resulting import block should now include 9 imports instead of 8.

- [ ] **Step 5: Run the insertLead tests again**

Run:
```bash
npx vitest run tests/engines/insertLead.test.js
```

Expected: all tests pass (the 4 original + the 2 new = 6 green).

### Task D.2: Update the findLeads integration test fixture

**Files:**
- Modify: `tests/engines/findLeads.test.js`

- [ ] **Step 1: Pre-check — find every place the role-address mock is referenced**

Run:
```bash
grep -n "info@betasalon\|betasalon" tests/engines/findLeads.test.js
```

Expected: at least two hits that use the full `info@betasalon.in` string (the Gemini mock around line 26 and the reject-list test around line 210). Additional `betasalon` mentions in assertion-adjacent comments (like line 204's `// pre-existing + betasalon (acme is deduplicated)`) are fine — they don't need updating, the comment still reads sensibly.

- [ ] **Step 2: Replace role-address mock email**

In `tests/engines/findLeads.test.js`, find the block:

```js
contact_email: prompt.includes('acme-restaurant')
  ? 'john@acme-restaurant.com'
  : 'info@betasalon.in',
```

Replace `info@betasalon.in` with `anya@betasalon.in` so the mock lead survives the new T2 role-address gate.

- [ ] **Step 3: Update the reject-list test accordingly**

In the same file, find the `'skips leads in reject list'` test. Update the second `addToRejectList` call to match:

```js
await addToRejectList('anya@betasalon.in', 'hard_bounce');
```

- [ ] **Step 4: Run integration tests to confirm no *new* failures from the mock change**

Run:
```bash
npx vitest run tests/engines/findLeads.test.js
```

Expected: the tests that depended on the `info@betasalon.in` mock now use `anya@betasalon.in` and still pass at this point (before we wire T2, there's no role-address gate yet — `info@` would have passed too, so this change is purely forward-compatibility with the behavior we're about to add). **If any test regresses here, it's because the assertion depended on a specific email string — fix the assertion to match `anya@betasalon.in` before proceeding.**

### Task D.3: Add failing integration tests for T1 + T2 + T3 branches

**Files:**
- Modify: `tests/engines/findLeads.test.js`

- [ ] **Step 1: Add T2 + T3 branch tests at the bottom of the `describe('findLeads', ...)` block**

Append inside the main `describe('findLeads', ...)` block:

```js
  describe('email regex gate (T2)', () => {
    it('drops leads with role-address emails as email_malformed', async () => {
      const { callGemini } = await import('../../src/core/ai/gemini.js');
      const originalImpl = callGemini.getMockImplementation();
      callGemini.mockImplementation(async (prompt, opts) => {
        if (prompt.includes('Analyze this business')) {
          return {
            text: JSON.stringify({
              owner_name: 'John', owner_role: 'Founder',
              contact_email: 'info@example.com',  // ROLE ADDRESS
              contact_confidence: 'medium', contact_source: 'guess',
              tech_stack: [], website_problems: [], business_signals: [],
              has_ssl: 1, has_analytics: 0, social_active: 0,
              website_quality_score: 5, judge_reason: 'meh',
              employees_estimate: '1-10', business_stage: 'owner-operated',
            }),
            costUsd: 0.001, inputTokens: 100, outputTokens: 50,
          };
        }
        return originalImpl(prompt, opts);
      });

      const { verifyEmail } = await import('../../src/core/integrations/mev.js');
      verifyEmail.mockClear();

      const { default: findLeads } = await import('../../src/engines/findLeads.js');
      await findLeads();

      const prisma = getTestPrisma();
      const malformed = await prisma.lead.findMany({ where: { status: 'email_malformed' } });
      expect(malformed.length).toBeGreaterThan(0);
      // email_status records the reason for dashboard slicing
      expect(malformed[0].emailStatus).toMatch(/^malformed:(role|shape|empty)$/);
      expect(malformed[0].emailStatus).toBe('malformed:role');
      // contact_email is nulled out to avoid persisting junk
      expect(malformed[0].contactEmail).toBeNull();
      // MEV should NOT be called for malformed leads
      expect(verifyEmail).not.toHaveBeenCalled();
      // Metric bumped
      const m = await prisma.dailyMetrics.findFirst();
      expect(m.leadsEmailMalformed).toBeGreaterThan(0);
    });

    it('drops leads with shape-invalid emails as email_malformed:shape', async () => {
      const { callGemini } = await import('../../src/core/ai/gemini.js');
      const originalImpl = callGemini.getMockImplementation();
      callGemini.mockImplementation(async (prompt, opts) => {
        if (prompt.includes('Analyze this business')) {
          return {
            text: JSON.stringify({
              owner_name: 'John', owner_role: 'Founder',
              contact_email: 'no at sign com',  // SHAPE FAIL
              contact_confidence: 'medium', contact_source: 'guess',
              tech_stack: [], website_problems: [], business_signals: [],
              has_ssl: 1, has_analytics: 0, social_active: 0,
              website_quality_score: 5, judge_reason: 'meh',
              employees_estimate: '1-10', business_stage: 'owner-operated',
            }),
            costUsd: 0.001, inputTokens: 100, outputTokens: 50,
          };
        }
        return originalImpl(prompt, opts);
      });

      const { default: findLeads } = await import('../../src/engines/findLeads.js');
      await findLeads();

      const prisma = getTestPrisma();
      const malformed = await prisma.lead.findMany({ where: { status: 'email_malformed' } });
      expect(malformed.length).toBeGreaterThan(0);
      expect(malformed[0].emailStatus).toBe('malformed:shape');
    });

    it('drops leads with null/empty emails as email_malformed:empty', async () => {
      // Requires the D.4-Step-2 removal of the line-335 early-drop;
      // otherwise null-email leads are dropped silently before Stage 7
      // and the `malformed:empty` branch is unreachable.
      const { callGemini } = await import('../../src/core/ai/gemini.js');
      const originalImpl = callGemini.getMockImplementation();
      callGemini.mockImplementation(async (prompt, opts) => {
        if (prompt.includes('Analyze this business')) {
          return {
            text: JSON.stringify({
              owner_name: 'John', owner_role: 'Founder',
              contact_email: null,  // Gemini failed to find an email
              contact_confidence: 'low', contact_source: 'not_found',
              tech_stack: [], website_problems: [], business_signals: [],
              has_ssl: 1, has_analytics: 0, social_active: 0,
              website_quality_score: 5, judge_reason: 'meh',
              employees_estimate: '1-10', business_stage: 'owner-operated',
            }),
            costUsd: 0.001, inputTokens: 100, outputTokens: 50,
          };
        }
        return originalImpl(prompt, opts);
      });

      const { verifyEmail } = await import('../../src/core/integrations/mev.js');
      verifyEmail.mockClear();

      const { default: findLeads } = await import('../../src/engines/findLeads.js');
      await findLeads();

      const prisma = getTestPrisma();
      const malformed = await prisma.lead.findMany({ where: { status: 'email_malformed' } });
      expect(malformed.length).toBeGreaterThan(0);
      expect(malformed[0].emailStatus).toBe('malformed:empty');
      expect(malformed[0].contactEmail).toBeNull();
      expect(verifyEmail).not.toHaveBeenCalled();
    });
  });

  describe('MEV error branching (T3)', () => {
    it('drops leads with permanent MEV errors as email_verify_error', async () => {
      const { verifyEmail } = await import('../../src/core/integrations/mev.js');
      verifyEmail.mockResolvedValue({ status: 'error', confidence: 0, errorKind: 'permanent' });

      const { default: findLeads } = await import('../../src/engines/findLeads.js');
      await findLeads();

      const prisma = getTestPrisma();
      const errored = await prisma.lead.findMany({ where: { status: 'email_verify_error' } });
      expect(errored.length).toBeGreaterThan(0);
      expect(errored[0].emailStatus).toBe('error:permanent');
      // error_log entry with errorKind as errorCode
      const errs = await prisma.errorLog.findMany({ where: { source: 'findLeads.mev' } });
      expect(errs.length).toBeGreaterThan(0);
      expect(errs[0].errorCode).toBe('permanent');
      // Metric bumped
      const m = await prisma.dailyMetrics.findFirst();
      expect(m.leadsEmailVerifyError).toBeGreaterThan(0);
    });

    it('drops leads with transient-retried MEV errors', async () => {
      const { verifyEmail } = await import('../../src/core/integrations/mev.js');
      verifyEmail.mockResolvedValue({ status: 'error', confidence: 0, errorKind: 'transient_retried' });

      const { default: findLeads } = await import('../../src/engines/findLeads.js');
      await findLeads();

      const prisma = getTestPrisma();
      const errored = await prisma.lead.findMany({ where: { status: 'email_verify_error' } });
      expect(errored.length).toBeGreaterThan(0);
      expect(errored[0].emailStatus).toBe('error:transient_retried');
      const errs = await prisma.errorLog.findMany({ where: { source: 'findLeads.mev' } });
      expect(errs[0].errorCode).toBe('transient_retried');
    });

    it('passes leads through with verify_skipped when no API key (MEV skipped)', async () => {
      const { verifyEmail } = await import('../../src/core/integrations/mev.js');
      verifyEmail.mockResolvedValue({ status: 'skipped', confidence: 0 });

      const { default: findLeads } = await import('../../src/engines/findLeads.js');
      await findLeads();

      const prisma = getTestPrisma();
      // Skipped leads proceed to ready; they're not a drop
      const ready = await prisma.lead.findMany({ where: { status: 'ready' } });
      expect(ready.length).toBeGreaterThan(0);
      expect(ready[0].emailStatus).toBe('verify_skipped');
      // Separate metric bumped (config-drift canary)
      const m = await prisma.dailyMetrics.findFirst();
      expect(m.leadsEmailVerifySkipped).toBeGreaterThan(0);
    });
  });
```

- [ ] **Step 2: Run the new tests to confirm they fail**

Run:
```bash
npx vitest run tests/engines/findLeads.test.js
```

Expected: the new tests fail. T2 doesn't exist yet (no `email_malformed` branch), and T3 treats `error` / `skipped` as unhandled → silent pass-through. Existing tests should still pass.

### Task D.4: Wire T1 + T2 + T3 + T6 + T7 into findLeads

**Files:**
- Modify: `src/engines/findLeads.js`

This task wires most of the pipeline edits. It's a single task (not one-per-touchpoint) because the changes are tightly coupled and splitting them leaves red intermediate states.

- [ ] **Step 1: Normalize dedup Sets (T1) — lines ~261-282**

Find the block that pre-loads the dedup Sets:

```js
    const knownEmailRows = await prisma.lead.findMany({
      where: { contactEmail: { not: null } },
      select: { contactEmail: true },
    });
    const knownEmails = new Set(knownEmailRows.map(r => r.contactEmail));

    const rejectedRows = await prisma.rejectList.findMany({ select: { email: true } });
    const rejectedEmails = new Set(rejectedRows.map(r => r.email));

    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const cooledRows = await prisma.lead.findMany({
      where: {
        status: { in: ['sent', 'replied'] },
        domainLastContacted: { gte: ninetyDaysAgo },
        contactEmail: { not: null },
      },
      select: { contactEmail: true },
    });
    const cooledDomains = new Set(
      cooledRows.map(r => r.contactEmail?.split('@')[1]).filter(Boolean)
    );
```

Replace with (normalizing every email read):

```js
    const knownEmailRows = await prisma.lead.findMany({
      where: { contactEmail: { not: null } },
      select: { contactEmail: true },
    });
    const knownEmails = new Set(
      knownEmailRows.map(r => normalizeEmail(r.contactEmail)).filter(Boolean)
    );

    const rejectedRows = await prisma.rejectList.findMany({ select: { email: true } });
    const rejectedEmails = new Set(
      rejectedRows.map(r => normalizeEmail(r.email)).filter(Boolean)
    );

    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const cooledRows = await prisma.lead.findMany({
      where: {
        status: { in: ['sent', 'replied'] },
        domainLastContacted: { gte: ninetyDaysAgo },
        contactEmail: { not: null },
      },
      select: { contactEmail: true },
    });
    const cooledDomains = new Set(
      cooledRows
        .map(r => normalizeEmail(r.contactEmail)?.split('@')[1])
        .filter(Boolean)
    );
```

- [ ] **Step 2: Remove the null-email early-drop + guard the Gate 1 dedup block (make `malformed:empty` reachable)**

The current code at [findLeads.js:335-338](src/engines/findLeads.js:335) silently drops leads whose `contact_email` is null, BEFORE Stage 7. That makes T2's `reason:'empty'` branch unreachable — nulls never get to Stage 7 to be validated. Spec §6.3 lists `malformed:empty` as a first-class status, so we want T2 to own it. We also need to guard the in-flight dedup block so it doesn't crash on null (`null.split('@')` would throw).

Find the block at roughly line 335–354:

```js
        if (!lead.contact_email) {
          leadsSkipped++;
          return null;
        }

        await bumpMetric('leadsEmailFound');

        // Stage 8: Dedup — all three checks use pre-loaded Sets (no DB query, race-free)
        // .has() and .add() are synchronous — JS event loop guarantees no interleave
        const emailDomain = lead.contact_email.split('@')[1];
        if (
          rejectedEmails.has(lead.contact_email) ||
          knownEmails.has(lead.contact_email) ||
          cooledDomains.has(emailDomain)
        ) {
          leadsSkipped++;
          return null;
        }
        knownEmails.add(lead.contact_email);
        cooledDomains.add(emailDomain);
```

Replace with:

```js
        // Null-email handling is delegated to T2 (top of Stage 7 worker) so
        // the resulting lead persists with status='email_malformed' and
        // emailStatus='malformed:empty' for dashboard visibility, rather than
        // vanishing silently. See spec §4.3 T2 + §6.3.

        await bumpMetric('leadsEmailFound');

        // Stage 8: Dedup — pre-loaded Sets now store NORMALIZED emails (T1).
        // Normalize the read side too so case-variant hits match. Guard on null
        // (T2 will drop null emails in Stage 7).
        const normalizedForDedup = normalizeEmail(lead.contact_email);
        if (normalizedForDedup) {
          const emailDomain = normalizedForDedup.split('@')[1];
          if (
            rejectedEmails.has(normalizedForDedup) ||
            knownEmails.has(normalizedForDedup) ||
            cooledDomains.has(emailDomain)
          ) {
            leadsSkipped++;
            return null;
          }
          knownEmails.add(normalizedForDedup);
          if (emailDomain) cooledDomains.add(emailDomain);
        }
```

This change does three things:
1. **Removes the silent null drop** — nulls now flow through to Stage 7 T2.
2. **Normalizes the read side** of the dedup check — the pre-loaded Sets are already normalized (from Step 1), so comparing against a non-normalized `lead.contact_email` would miss case-variant dupes. This is the other half of T1.
3. **Guards dedup on null** — prevents `null.split('@')` crash for leads T2 will later reject.

- [ ] **Step 3: Rework Stage 7 worker with T2 + T3 (lines ~365-401)**

Find the block:

```js
    // ── Stage 7: Email verification (MEV) ────────────────────────────────
    const verifiedLeads = await withConcurrency(gate1Passed, 20, async (lead) => {
      try {
        const { status: verifyStatus, confidence } = await verifyEmail(lead.contact_email);
        lead.email_status = verifyStatus;

        if (verifyStatus === 'invalid' || verifyStatus === 'disposable') {
          leadsSkipped++;
          await prisma.lead.create({
            data: {
              businessName: lead.business_name,
              websiteUrl: lead.website_url,
              category: lead.category,
              city: lead.city,
              contactEmail: lead.contact_email,
              emailStatus: verifyStatus,
              status: 'email_invalid',
            },
          });
          return null;
        }

        // Gate 2: unknown + low confidence = skip
        if (verifyStatus === 'unknown' && confidence < 0.5) {
          leadsSkipped++;
          return null;
        }

        await bumpMetric('leadsEmailValid');
        return lead;
      } catch (err) {
        await logError('findLeads.lead', err, { jobName: 'findLeads' });
        leadsSkipped++;
        return null;
      }
    });
    const gate2Passed = verifiedLeads.filter(Boolean);
```

Replace with:

```js
    // ── Stage 7: Email regex gate (T2) + MEV verification (T3) ───────────
    const verifiedLeads = await withConcurrency(gate1Passed, 20, async (lead) => {
      try {
        // T2: regex + role-address gate — runs BEFORE MEV to save credits
        const shapeResult = validateContactEmail(lead.contact_email);
        if (!shapeResult.ok) {
          lead.contact_email = null;                                // don't persist junk
          lead.email_status = `malformed:${shapeResult.reason}`;    // 'malformed:empty|shape|role'
          await insertLead(lead, niche, 'email_malformed');
          await bumpMetric('leadsEmailMalformed');
          leadsSkipped++;
          return null;
        }
        lead.contact_email = shapeResult.email;   // use normalized form downstream

        // T3: MEV verification with explicit branching
        const { status: verifyStatus, confidence, errorKind } = await verifyEmail(lead.contact_email);
        lead.email_status = verifyStatus;

        if (verifyStatus === 'invalid' || verifyStatus === 'disposable') {
          await insertLead(lead, niche, 'email_invalid');
          leadsSkipped++;
          return null;
        }

        if (verifyStatus === 'error') {
          lead.email_status = `error:${errorKind}`;                 // 'error:permanent' | 'error:transient_retried'
          await insertLead(lead, niche, 'email_verify_error');
          await logError('findLeads.mev', new Error(`MEV ${errorKind}`), {
            jobName: 'findLeads',
            errorCode: errorKind,
          });
          await bumpMetric('leadsEmailVerifyError');
          leadsSkipped++;
          return null;
        }

        if (verifyStatus === 'skipped') {
          // No API key configured (dev mode). Preserve lead, mark as unverified.
          lead.email_status = 'verify_skipped';
          await bumpMetric('leadsEmailVerifySkipped');
          return lead;
        }

        // Gate 2: unknown + low confidence = skip
        if (verifyStatus === 'unknown' && confidence < 0.5) {
          leadsSkipped++;
          return null;
        }

        await bumpMetric('leadsEmailValid');
        return lead;
      } catch (err) {
        await logError('findLeads.lead', err, { jobName: 'findLeads' });
        leadsSkipped++;
        return null;
      }
    });
    const gate2Passed = verifiedLeads.filter(Boolean);
```

- [ ] **Step 4: Wire T4 (atomic transaction) + T7 (P2002 handler) in Stage 10/11 block (~lines 459-511)**

Find the concurrency block for Stage 10/11 that contains `insertLead(lead, niche, 'ready')` and `await prisma.email.create(...)`. Replace the inner try block contents so the insert pair is atomic and wrapped in a P2002 handler.

Find:

```js
    await withConcurrency(abLeads, 10, async (lead) => {
      try {
        // Stage 10: Hook
        const hookResult = await stage10_hook(lead, persona);
        totalCost += hookResult.costUsd;

        // Stage 11: Body + subject in parallel
        const [bodyResult, subjectResult] = await Promise.all([
          stage11_body(lead, hookResult.hook, persona),
          stage11_subject(lead)
        ]);
        const bodyCost = bodyResult.costUsd + subjectResult.costUsd;
        totalCost += bodyCost;
        if (ANTHROPIC_DISABLED) {
          await bumpMetric('geminiCostUsd', hookResult.costUsd + bodyCost);
        } else {
          await bumpMetric('sonnetCostUsd', hookResult.costUsd);
          await bumpMetric('haikuCostUsd', bodyCost);
        }
        await bumpMetric('totalApiCostUsd', hookResult.costUsd + bodyCost);

        // Insert lead
        const leadInsert = await insertLead(lead, niche, 'ready');

        // Insert pre-generated email
        await prisma.email.create({
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

        await bumpMetric('leadsReady');
        leadsReady++;
      } catch (err) {
        await logError('findLeads.lead', err, { jobName: 'findLeads' });
        leadsSkipped++;
      }
    });
```

Replace with:

```js
    await withConcurrency(abLeads, 10, async (lead) => {
      try {
        // Stage 10: Hook
        const hookResult = await stage10_hook(lead, persona);
        totalCost += hookResult.costUsd;

        // Stage 11: Body + subject in parallel
        const [bodyResult, subjectResult] = await Promise.all([
          stage11_body(lead, hookResult.hook, persona),
          stage11_subject(lead)
        ]);
        const bodyCost = bodyResult.costUsd + subjectResult.costUsd;
        totalCost += bodyCost;
        if (ANTHROPIC_DISABLED) {
          await bumpMetric('geminiCostUsd', hookResult.costUsd + bodyCost);
        } else {
          await bumpMetric('sonnetCostUsd', hookResult.costUsd);
          await bumpMetric('haikuCostUsd', bodyCost);
        }
        await bumpMetric('totalApiCostUsd', hookResult.costUsd + bodyCost);

        // T4: Atomic lead + email insert. If either throws, Prisma rolls back both.
        // T7: P2002 catch wraps the entire $transaction — not inside the callback —
        // so rollback completes before our handler fires.
        try {
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
          await bumpMetric('leadsReady');
          leadsReady++;
        } catch (txErr) {
          // Functional unique index error — Prisma's meta.target shape is version-dependent
          const isP2002 = txErr?.code === 'P2002'
            && (txErr?.meta?.target?.some?.(t => String(t).includes('contact_email')) ?? false);
          if (isP2002) {
            leadsSkipped++;
            await logError('findLeads.dedup_race', txErr, {
              jobName: 'findLeads',
              errorCode: 'P2002',
            });
            return;
          }
          throw txErr;   // let outer catch log + skip
        }
      } catch (err) {
        await logError('findLeads.lead', err, { jobName: 'findLeads' });
        leadsSkipped++;
      }
    });
```

- [ ] **Step 5: Extract `safeInsertLead()` helper and apply it at all five non-transactional call sites (T7)**

**Mandatory, not optional.** The P2002 predicate (`err?.meta?.target?.some?.(t => String(t).includes('contact_email'))`) lives at five insert sites (`email_invalid`, `email_malformed`, `email_verify_error`, `disqualified`, `nurture`). Copy-pasting the same predicate five times means five places that silently drift if Prisma's `meta.target` shape changes in a future version. The spec §4.3 T7 note is explicit: "the predicate is the one line to adjust" — which only holds if there IS one line.

Extract a helper at the top of `src/engines/findLeads.js` (after `insertLead`, before the SIZE_PROMPTS constant):

```js
/**
 * Wraps insertLead() with standardized handling for P2002 unique-constraint
 * violations originating from the functional index on LOWER(contact_email).
 *
 * If P2002 fires on contact_email, we log a 'findLeads.dedup_race' error
 * and return null (letting the caller continue its loop). Any other error
 * re-throws so the outer catch sees it.
 *
 * The `meta.target` shape is Prisma-version-dependent for functional indexes
 * — the `.some?.(t => String(t).includes(...))` predicate defensively
 * handles both string-array and object forms. If Prisma changes the shape
 * in a future version, update THIS ONE LINE.
 */
async function safeInsertLead(lead, niche, status, options = {}) {
  try {
    return await insertLead(lead, niche, status, options);
  } catch (err) {
    const isContactEmailDupe = err?.code === 'P2002'
      && (err?.meta?.target?.some?.(t => String(t).includes('contact_email')) ?? false);
    if (isContactEmailDupe) {
      await logError('findLeads.dedup_race', err, {
        jobName: 'findLeads',
        errorCode: 'P2002',
      });
      return null;
    }
    throw err;
  }
}
```

Then update the five call sites:

1. `insertLead(lead, niche, 'email_invalid')` → `const inserted = await safeInsertLead(lead, niche, 'email_invalid'); if (inserted === null) { leadsSkipped++; return null; }` — the dupe-race case still increments `leadsSkipped` so the metric reflects the drop.
2. `insertLead(lead, niche, 'email_malformed')` → same pattern
3. `insertLead(lead, niche, 'email_verify_error')` → same pattern
4. `insertLead(lead, niche, 'disqualified')` → same pattern
5. `insertLead(lead, niche, 'nurture')` → same pattern

**Example** for the `disqualified` branch. Find:
```js
        // Hard disqualifiers override score
        if (icp.icp_disqualifiers.length > 0) {
          await insertLead(lead, niche, 'disqualified');
          await bumpMetric('leadsDisqualified');
          leadsSkipped++;
          return null;
        }
```

Replace with:
```js
        // Hard disqualifiers override score
        if (icp.icp_disqualifiers.length > 0) {
          const inserted = await safeInsertLead(lead, niche, 'disqualified');
          if (inserted !== null) {
            await bumpMetric('leadsDisqualified');
          }
          leadsSkipped++;
          return null;
        }
```

(Note: if the insert dup-raced, we skip the `leadsDisqualified` metric bump — the lead wasn't actually newly disqualified, it was a dedup. `leadsSkipped` is still incremented to keep the "did not advance through pipeline" counter accurate.)

Apply the analogous pattern at the other four sites. The transactional site from Step 4 keeps its inline try/catch (it needs to wrap `$transaction`, not `insertLead` — `safeInsertLead` wouldn't help there since it doesn't see the full transaction).

### Task D.5: Add failing integration tests for T4 atomicity + P2002

**Files:**
- Modify: `tests/engines/findLeads.test.js`

- [ ] **Step 1: Append atomicity + P2002 tests**

Append inside the `describe('findLeads', ...)` block (after the T2/T3 tests from D.3):

```js
  describe('atomic lead+email insert (T4)', () => {
    it('rolls back lead creation when email insert fails inside the transaction', async () => {
      // Why `prisma.$use` middleware and not monkey-patching prisma.email.create?
      // Prisma's interactive-transaction proxy (`tx`) creates its own dispatcher
      // that does NOT delegate to the top-level model objects — so monkey-patching
      // `prisma.email.create` would not intercept `tx.email.create` inside the
      // $transaction. Middleware registered via $use runs for ALL model calls
      // (both `prisma.*` and `tx.*`) because it's at the request-pipeline layer.

      const prisma = getTestPrisma();

      // Install a one-shot middleware that throws on the first email.create.
      // We store a flag in the middleware's closure so subsequent calls pass through.
      let thrownOnce = false;
      const middleware = async (params, next) => {
        if (params.model === 'Email' && params.action === 'create' && !thrownOnce) {
          thrownOnce = true;
          throw new Error('simulated email.create failure inside tx');
        }
        return next(params);
      };
      prisma.$use(middleware);

      try {
        const { default: findLeads } = await import('../../src/engines/findLeads.js');
        await findLeads();
      } finally {
        // Prisma's $use API doesn't expose a remove hook in current versions — but
        // we only need the middleware to fire once (thrownOnce gates it), so after
        // the test it becomes a pass-through no-op. truncateAll() in the next
        // beforeEach resets the test DB regardless of middleware state.
      }

      // The lead whose email creation failed must NOT exist as 'ready'.
      // The atomicity contract: `status='ready'` implies a matching emails row.
      const orphans = await prisma.$queryRaw`
        SELECT l.id FROM leads l
          LEFT JOIN emails e ON e.lead_id = l.id AND e.sequence_step = 0
         WHERE l.status = 'ready' AND e.id IS NULL
      `;
      expect(orphans.length).toBe(0);

      // Confirm the middleware actually fired (otherwise the test is vacuous)
      expect(thrownOnce).toBe(true);
    });
  });

  describe('dedup race handling (T7)', () => {
    it('DB-level P2002: fires when the in-memory Set pre-check is bypassed', async () => {
      // This test exercises the actual DB unique index path — NOT the in-memory
      // Set pre-check. We simulate a race where the pipeline pre-loaded its
      // dedup Set with `knownEmails = {}` (before any duplicate existed), then
      // a concurrent writer (or lagging replication) slipped a row in, and only
      // the DB constraint catches it.
      //
      // Implementation: use middleware to intercept Prisma `lead.findMany` ONLY
      // during the pre-load phase (when `select.contactEmail` is requested) and
      // force it to return [], so `knownEmails` starts empty. Then pre-seed the
      // conflicting row AFTER that findMany but BEFORE Gemini's extraction runs.
      //
      // Easier implementation (used here): monkey-patch `prisma.lead.findMany`
      // on its first call to return empty, then let the pipeline discover
      // + extract, and the DB's LOWER() unique index catches the P2002 at
      // insertLead time (Gate-1 worker's email_invalid branch, or Stage-10/11
      // $transaction, depending on the mock MEV response).

      const prisma = getTestPrisma();

      // Override Gemini to produce a lead that'll reach an `insertLead` call
      // (either email_invalid via MEV invalid, or ready via the happy path).
      // We choose email_invalid for simplicity — mock MEV to return 'invalid'
      // so the lead hits the email_invalid insert branch.
      const { verifyEmail } = await import('../../src/core/integrations/mev.js');
      verifyEmail.mockResolvedValue({ status: 'invalid', confidence: 0 });

      // Swap prisma.lead.findMany to return [] on first call (pre-load phase),
      // then restore for subsequent calls.
      const origFindMany = prisma.lead.findMany.bind(prisma.lead);
      let preloadCallsRemaining = 2;  // pre-loads: knownEmails + cooledRows
      prisma.lead.findMany = async (args) => {
        if (preloadCallsRemaining > 0) {
          preloadCallsRemaining--;
          return [];
        }
        return origFindMany(args);
      };

      try {
        // Pre-seed AFTER the stub is installed, so the pre-load sees [] but
        // the DB has a row that'll collide on insert.
        await prisma.lead.create({
          data: { businessName: 'Pre-existing', contactEmail: 'john@acme-restaurant.com', status: 'email_invalid' },
        });

        const { default: findLeads } = await import('../../src/engines/findLeads.js');
        await findLeads();
      } finally {
        prisma.lead.findMany = origFindMany;
      }

      // Pipeline didn't crash. The P2002 handler logged a 'findLeads.dedup_race' error.
      const dedupErrs = await prisma.errorLog.findMany({ where: { source: 'findLeads.dedup_race' } });
      expect(dedupErrs.length).toBeGreaterThan(0);
      expect(dedupErrs[0].errorCode).toBe('P2002');

      // Exactly one row for that email — the pre-seeded one.
      const count = await prisma.$queryRaw`SELECT COUNT(*)::int AS n FROM leads WHERE LOWER(contact_email) = 'john@acme-restaurant.com'`;
      expect(count[0].n).toBe(1);
    });

    it('in-memory Set dedup: case-insensitive pre-existing row blocks new lead', async () => {
      // Pre-seed with unnormalized casing — simulates pre-Chunk-1 historical data.
      // Pipeline pre-loads knownEmails, normalizes via T1, so the Set contains
      // the lowercased version and the check fires at Stage 8 (post-MEV).
      const prisma = getTestPrisma();
      await prisma.lead.create({
        data: { businessName: 'Old Acme', contactEmail: 'JOHN@acme-restaurant.com', status: 'sent' },
      });

      const { verifyEmail } = await import('../../src/core/integrations/mev.js');
      verifyEmail.mockClear();
      verifyEmail.mockResolvedValue({ status: 'valid', confidence: 0.9 });

      const { default: findLeads } = await import('../../src/engines/findLeads.js');
      await findLeads();

      // Exactly one row across both casings, by functional-index-aware count:
      const count = await prisma.$queryRaw`SELECT COUNT(*)::int AS n FROM leads WHERE LOWER(contact_email) = 'john@acme-restaurant.com'`;
      expect(count[0].n).toBe(1);
      // Pre-existing row's casing is preserved (no backfill in Chunk 1)
      const row = await prisma.lead.findFirst({ where: { businessName: 'Old Acme' } });
      expect(row.contactEmail).toBe('JOHN@acme-restaurant.com');
      // MEV was called for the duplicate (dedup runs post-MEV per spec §7.3 "Implication" note).
      expect(verifyEmail).toHaveBeenCalled();
    });
  });
```

- [ ] **Step 2: Run to confirm — T2/T3 tests should now pass; atomicity + P2002 may still fail if not wired**

Run:
```bash
npx vitest run tests/engines/findLeads.test.js
```

Expected: T2/T3 tests pass (D.4 wired them). Atomicity + P2002 tests may pass (D.4 also wired T4 and T7). If any fail, debug based on the assertion message before proceeding.

### Task D.6: Fix any remaining failures and run the full suite

**Files:** (bug-fix only, in whichever file the test reveals)

- [ ] **Step 1: Run the full integration test suite**

Run:
```bash
npx vitest run tests/engines/findLeads.test.js
```

Expected: all tests pass. If anything fails:
- Read the failure message and the relevant test code
- Check the corresponding wiring in `src/engines/findLeads.js`
- Common issues:
  - Forgot to normalize email before using it in the in-memory dedup check (compare normalized-vs-stored mismatch)
  - Missed a `bumpMetric` call for the new counters
  - P2002 handler pattern mismatched on Prisma's actual `meta.target` shape — adjust the predicate
- Fix and re-run until all green.

- [ ] **Step 2: Run the whole test suite**

Run:
```bash
npm test
```

Expected: every test passes — integrity (15), mev (9), insertLead (6), findLeads integration (original + 9 new: 3 for T2 regex gate, 3 for T3 MEV branches, 1 for T4 atomic rollback, 2 for T7 dedup race paths), plus all other pre-existing tests untouched.

- [ ] **Step 3: Run the audit script against the test DB to confirm post-run cleanliness**

First, confirm the `DATABASE_URL_TEST` env var is set. If it's missing, the script falls back to `DATABASE_URL` (dev DB) per `tests/helpers/testDb.js:5`, which we don't want to audit here:

```bash
echo "DATABASE_URL_TEST=${DATABASE_URL_TEST:-<unset>}"
```

If unset, set it (e.g., in a `.env.test` file or inline for the command) before proceeding.

Then run:
```bash
DATABASE_URL="$DATABASE_URL_TEST" node scripts/audit_email_dupes.js
echo "exit: $?"
```

Expected: exit 0 ("0 duplicate groups"). If the tests left any dupes, that's a test-teardown bug — investigate before committing.

### Task D.7: Commit Chunk D

- [ ] **Step 1: Stage and commit**

Run:
```bash
git add src/engines/findLeads.js tests/engines/findLeads.test.js tests/engines/insertLead.test.js
git commit -m "$(cat <<'EOF'
feat(findLeads): wire integrity + atomic insert + P2002 handling

Implements spec §4.3 touchpoints T1–T7:
- T1: pre-loaded dedup Sets (knownEmails, rejectedEmails, cooledDomains)
      now normalized via normalizeEmail()
- T2: new regex + role-address gate at top of Stage 7 worker. Drops
      with status='email_malformed' and emailStatus='malformed:empty|shape|role'.
      Saves an MEV credit per drop.
- T3: MEV branching rework — explicit handling of 'error' (drop as
      email_verify_error + log), 'skipped' (pass-through + separate metric),
      and preserved invalid/disposable/unknown behavior
- T4: lead + email insert wrapped in prisma.$transaction for atomicity.
      No more orphan ready-leads on email create failure.
- T5: insertLead() accepts optional {tx} arg. Backwards compatible.
- T6: normalizeEmail() folded into insertLead so every write is symmetric
      with the functional unique index.
- T7: P2002 handler wraps every insertLead() call and the $transaction —
      outside the callback, so Prisma rolls back before we handle.

Integration tests extended with 9 new cases: role-address rejection,
shape-invalid rejection, empty-email rejection, permanent/transient
MEV errors, skipped MEV, atomic rollback (via prisma.$use middleware
to intercept tx.email.create), DB-level P2002 race (via findMany
stub), and in-memory case-insensitive Set dedup. Existing mock updated
(info@betasalon.in → anya@betasalon.in) so it doesn't trip T2.

Also removes the old line-335 early-drop for null contact_email so T2
at Stage 7 can own the 'malformed:empty' status. Dedup block in Gate 1
is guarded against null and normalizes read-side comparisons (T1).

Spec: docs/superpowers/specs/2026-04-21-pipeline-hardening-chunk-1-data-integrity-design.md §4.3
EOF
)"
```

Expected: commit succeeds, 3 files changed.

---

## Post-chunk verification (before pushing the PR)

- [ ] **Step 1: Full test suite green**

Run:
```bash
npm test
```

Expected: 100% green.

- [ ] **Step 2: Prisma migrate status clean (no pending drift)**

Run:
```bash
npx prisma migrate status
```

Expected: "Database schema is up to date!" and "X migrations found in prisma/migrations" where X includes `chunk1_integrity`. If drift is reported, investigate before shipping — the schema change should have been captured by the migration in Chunk C.

(Historical note: `prisma migrate diff` can be used for the same check, but its directional flags are easy to get backwards — `migrate status` is the clearer invocation for "is my dev DB in sync with committed migrations?")

- [ ] **Step 3: Audit script exits 0 on the dev DB**

Run:
```bash
node scripts/audit_email_dupes.js
```

Expected: exit 0, "0 duplicate groups".

- [ ] **Step 4: Push the branch and open PR with deploy checklist**

Run:
```bash
git push -u origin claude/epic-diffie-b30d39
```

Then open a PR that includes, in the description:

```markdown
## Deploy Checklist (per spec §8)

On the VPS, **in this order**:

1. `git pull`
2. `node scripts/audit_email_dupes.js`
3. If exit ≠ 0: resolve dupes manually, re-audit until clean. Do NOT proceed.
4. `npx prisma migrate deploy`
5. `pm2 reload radar-cron radar-dashboard`
6. Verify (psql):
   - `\d leads | grep leads_contact_email_lower_unique` — index exists
   - `SELECT leads_email_malformed, leads_email_verify_error, leads_email_verify_skipped FROM daily_metrics WHERE date = CURRENT_DATE;` — rows exist, counters at 0
7. Trigger a manual findLeads run or wait for next cron fire
8. Check `error_log` for any `findLeads.dedup_race` or `findLeads.mev` entries — low counts OK, sustained >5/day needs investigation
```

---

## Reference — spec anchors

| Spec section | What it covers | Implementation task |
|---|---|---|
| §3 | Goals / non-goals, decisions locked | — |
| §4.1 | integrity.js module contract | Chunk A |
| §4.2 | mev.js classified retry | Chunk B |
| §4.3 T1 | Normalize dedup Sets (pre-load + read-side) | D.4 Step 1 + Step 2 |
| §4.3 T2 | Email shape gate (reachable for `empty` after line-335 removal) | D.4 Step 2 + Step 3 |
| §4.3 T3 | MEV branching rework | D.4 Step 3 |
| §4.3 T4 | Atomic transaction | D.4 Step 4 |
| §4.3 T5 | insertLead signature | D.1 Step 3 |
| §4.3 T6 | Normalize at every write | D.1 Step 3 |
| §4.3 T7 | P2002 handler (`safeInsertLead` + tx-wrap catch) | D.4 Step 4 + Step 5 |
| §5.1 | Schema diff | C.1 |
| §5.2 | Migration SQL | C.2 |
| §5.3 | Audit script | C.3 |
| §6.1 | New metrics | C.1 (field), D.4 (bumps) |
| §6.3 | Status + emailStatus enums | D.4 (emit sites) |
| §7 | Test strategy | Tests woven into each chunk |
| §8 | Rollout plan | Post-chunk verification |
| §9 | Success criteria | Verification via audit + psql queries |
