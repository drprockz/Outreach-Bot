# Dashboard Tidy — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reshape the Radar dashboard into a 4-section nav with 13 pages (down from 18), unify `EngineRunner` + `EngineConfig` into one Engines page with a `Guardrails` tab, kill the ICP v1 scoring system, move 6 orphan settings from `.env`/hardcoded code into the `config` KV table with dashboard editors, and standardize API response envelopes on the settings routes touched.

**Architecture:** Frontend reshape + surgical backend cleanup. Existing Prisma schema trimmed (drop `IcpRule`, `Lead.icpPriority`); existing `config` KV table grown by 6 keys; one new route `/api/engines/:engineName/guardrails`; one new aggregate `/api/engines` endpoint. No new DB tables, no TypeScript, no test framework added for frontend.

**Tech Stack:** Node.js 20 ESM, Express 4, Prisma + Postgres, vitest, React 18 + Vite, nodemailer, imapflow. No new runtime dependencies (ships without `react-hook-form`, without `zod`, without tooltip libraries).

**Spec reference:** [`docs/superpowers/specs/2026-04-21-dashboard-tidy-design.md`](../specs/2026-04-21-dashboard-tidy-design.md)

**Chunks (one per PR):**

1. Delete ICP v1 (Prisma migration + route + page + engine branch)
2. Orphan settings → config table (6 new keys, guardrails route, fallback safety-belt, startup warning)
3. 4-section nav + page renames (Sidebar.jsx rewrite, git mv pages, 301 redirect map)
4. Unified Engines page (new `Engines.jsx` with master/detail, aggregate `/api/engines`, `<EngineStatusPill>`)
5. Setup skeleton + Offer & ICP merge (`<SettingsPage>` + `useSettingsField` + envelope standardization)
6. Today page + tooltip glossary (`<TechTerm>`, `glossary.js`, new `Today.jsx`)

**Dependencies:** Chunks must ship in order. Chunks 1 and 2 are backend + small frontend removals (independent of each other in code, but both must land before Chunk 4 which depends on them). Chunk 3 is a pure nav reshuffle that assumes ICP v1 is gone. Chunk 4 consumes the guardrails route from Chunk 2 and the 4-section nav from Chunk 3. Chunk 5 layers the shared settings skeleton on top. Chunk 6 is polish.

**Commit/PR cadence:** Each chunk is one PR against `main`. Within a chunk, commit after each green test block (typical: 3–6 commits per chunk). Never commit a failing test suite.

**Global TDD rule:** Every behavior change writes the failing test first, runs to confirm failure, implements minimal code, re-runs to confirm pass, then commits. Pure renames (no behavior change) skip TDD and commit as a single `refactor:` commit.

**VPS deploy rule (from spec §9):** Every PR that changes server-side behavior (1, 2, 4, 5) runs `prisma migrate deploy` (if migration exists) → PM2 restart → 10-min log tail. Column-drop migrations (PR 1) run outside the 09:30–17:30 IST send window. PR 3 and PR 6 are frontend-only and deploy via nginx static without PM2 restart.

---

## Chunk 1: Delete ICP v1

**Files:**
- Create: `prisma/migrations/<timestamp>_drop_icp_v1/migration.sql`
- Modify: `prisma/schema.prisma` (remove `IcpRule` model, drop `icpPriority` field from `Lead`)
- Delete: `src/api/routes/icpRules.js`
- Modify: `src/api/server.js` (remove import + mount)
- Modify: `src/core/db/index.js` (remove `icpRule.createMany` block from `seedNichesAndIcpRules`)
- Modify: `src/engines/findLeads.js` (stop writing `icpPriority`)
- Delete: `web/src/pages/IcpRules.jsx`
- Modify: `web/src/api.js` (remove `getIcpRules`, `updateIcpRules`)
- Modify: `web/src/components/Sidebar.jsx` (remove ICP Rubric entry)
- Modify: `web/src/App.jsx` (remove `/settings/icp` route)
- Test (modify): `tests/engines/findLeads.test.js` (nurture-routing test, strip `icpPriority` assertions)
- Test (delete): `tests/api/icpRules.test.js` (if present)

**Commit cadence:** 4 commits — (a) Prisma schema + migration, (b) backend code removal + engine branch update with its test, (c) frontend removal, (d) seed cleanup.

### Task 1.1: Audit remaining `icpPriority` / `icp-rules` call sites

**Context:** Before deleting the field, find every place that reads or writes it so the migration doesn't surprise us in prod.

- [ ] **Step 1: Grep for all call sites**

Run:
```bash
cd /home/darshanparmar/Projects/Outreach-Bot
grep -rn "icpPriority\|icp-rules\|icpRule\b\|getIcpRules\|updateIcpRules\|IcpRules" --include="*.js" --include="*.jsx" --include="*.prisma" --include="*.sql" .
```

Expected: hits only in files listed under "Files" above. If hits appear elsewhere, add them to the modify list in this chunk before continuing.

### Task 1.2: Write failing test — `findLeads` routes ICP-C lead to `status='nurture'` without writing `icpPriority`

**Context:** `findLeads.js` currently writes both `status` and `icpPriority` for leads below threshold B. After the change, only `status` is written; the field itself is gone.

- [ ] **Step 1: Open `tests/engines/findLeads.test.js`** and locate the Gate 3 / nurture test. Add or update a test block:

```js
it('routes ICP-C leads (score < icp_threshold_b) to status="nurture" with no icpPriority reference', async () => {
  const inserted = await runFindLeadsWithMockScore(25); // score below threshold B (default 40)
  expect(inserted.status).toBe('nurture');
  // Post-migration: the field itself is removed from the model
  expect('icpPriority' in inserted).toBe(false);
});
```

If `runFindLeadsWithMockScore` doesn't exist, wire it via the test helpers already present in `tests/helpers/testDb.js` (model a Lead with fixed scoring inputs; run the `stage9_icpScore` + insert branch directly).

- [ ] **Step 2: Run and verify fail**

```bash
npm test -- engines/findLeads.test.js 2>&1 | tail -40
```

Expected: FAIL — the lead row still exposes `icpPriority` (prisma model still has it).

### Task 1.3: Remove `IcpRule` model and `Lead.icpPriority` from Prisma schema

- [ ] **Step 1: Edit `prisma/schema.prisma`** — delete the entire `model IcpRule { ... }` block and remove the line `icpPriority String? @map("icp_priority")` from `model Lead`.

- [ ] **Step 2: Generate the migration**

```bash
npx prisma migrate dev --name drop_icp_v1 --create-only
```

This creates `prisma/migrations/<timestamp>_drop_icp_v1/migration.sql`. Inspect it; it should contain `DROP TABLE "icp_rules"` and `ALTER TABLE "leads" DROP COLUMN "icp_priority"` and nothing else.

- [ ] **Step 3: Apply the migration**

```bash
npx prisma migrate deploy
npx prisma generate
```

- [ ] **Step 4: Re-run test, confirm pass**

```bash
npm test -- engines/findLeads.test.js 2>&1 | tail -20
```

Expected: PASS.

### Task 1.4: Remove `icpPriority` write from `findLeads.js`

**Context:** `findLeads.js` has a branch around stage 9 or the insert helper that sets `icpPriority: 'hot' | 'warm' | 'cold'` alongside `status`. That write will start failing at runtime once the Prisma client regenerates without the field.

- [ ] **Step 1: Locate the write**

```bash
grep -n "icpPriority" src/engines/findLeads.js
```

- [ ] **Step 2: Remove the assignment**. In the lead-creation payload, delete the `icpPriority: ...` line. Leave surrounding `status: 'nurture' | 'ready'` logic unchanged.

- [ ] **Step 3: Run full engine test suite**

```bash
npm test -- engines 2>&1 | tail -40
```

Expected: all engine tests pass.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/*_drop_icp_v1 src/engines/findLeads.js tests/engines/findLeads.test.js
git commit -m "feat(schema): drop ICP v1 model and icpPriority column; route nurture via status only"
```

### Task 1.5: Remove backend route + frontend page for ICP v1

- [ ] **Step 1: Delete backend route file**

```bash
git rm src/api/routes/icpRules.js
```

- [ ] **Step 2: Remove the mount in `src/api/server.js`**. Delete the import line and the `app.use('/api/icp-rules', icpRulesRoutes);` line.

- [ ] **Step 3: Delete frontend page**

```bash
git rm web/src/pages/IcpRules.jsx
```

- [ ] **Step 4: Remove `api.js` methods**. In `web/src/api.js`, delete the `getIcpRules` and `updateIcpRules` methods and any helpers they use.

- [ ] **Step 5: Remove the nav entry and route**
- In `web/src/components/Sidebar.jsx`, delete the `{ path: '/settings/icp', label: 'ICP Rubric (legacy)' }` entry from `settingsItems`.
- In `web/src/App.jsx`, delete the `<Route path="/settings/icp" element={<IcpRules />} />` line and remove the `IcpRules` import.

- [ ] **Step 6: Verify no dangling imports**

```bash
grep -rn "IcpRules\|icp-rules\|getIcpRules\|updateIcpRules" web/src src/api
```

Expected: no hits.

- [ ] **Step 7: Sanity check the dashboard boots**

```bash
node src/api/server.js &
SERVER_PID=$!
sleep 3
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3001/api/overview
# Expect 401 (auth-gated) — confirms server booted and routing works
kill $SERVER_PID
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(api,web): remove ICP v1 route and page; scoring goes through ICP v2 only"
```

### Task 1.6: Remove the `icpRule` seed block from `seedNichesAndIcpRules`

**Context:** `src/core/db/index.js` still seeds `icpRule` rows on every boot — that call will throw once the model is gone.

- [ ] **Step 1: Edit `src/core/db/index.js`**. In `seedNichesAndIcpRules`, delete the entire `if ((await prisma.icpRule.count()) === 0) { await prisma.icpRule.createMany(...) }` block.

- [ ] **Step 2: Rename the function** to `seedNichesAndDefaults` (it no longer touches ICP rules). Update the call site in `src/api/server.js`.

- [ ] **Step 3: Boot-time smoke test**

```bash
node src/api/server.js &
SERVER_PID=$!
sleep 3
# Expect no error in output; seedNichesAndDefaults succeeded
kill $SERVER_PID
```

- [ ] **Step 4: Commit**

```bash
git add src/core/db/index.js src/api/server.js
git commit -m "refactor(db): rename seedNichesAndIcpRules → seedNichesAndDefaults; drop ICP v1 seed"
```

### Task 1.7: Full test suite + migration log check

- [ ] **Step 1: Run all tests**

```bash
npm test 2>&1 | tail -30
```

Expected: all pass.

- [ ] **Step 2: Confirm migration is applied on staging/VPS**

On the VPS (via SSH): `cd /home/radar && npx prisma migrate deploy`. Deploy outside 09:30–17:30 IST per spec §9.

---

## Chunk 2: Orphan settings → config table

**Files:**
- Modify: `src/core/db/index.js` (add 6 keys to `seedConfigDefaults`)
- Modify: `src/core/email/contentValidator.js` (read `email_min_words`, `email_max_words`, `spam_words` from config; fallback to `.env`)
- Modify: `src/engines/sendEmails.js` (read `send_holidays` from config; fallback to hardcoded)
- Modify: `src/engines/findLeads.js` (read `findleads_size_prompts` from config; fallback to hardcoded)
- Modify: `src/scheduler/cron.js` (read `check_replies_interval_minutes` from config; fallback to hardcoded)
- Modify: `src/api/server.js` (startup warning listing keys still in fallback mode)
- Create: `src/api/routes/engineGuardrails.js` (`GET`/`PUT /api/engines/:engineName/guardrails`)
- Modify: `src/api/server.js` (mount guardrails router)
- Create: `src/core/config/guardrailsSchema.js` (defines which keys belong to which engine + validators)
- Test: `tests/core/email/contentValidator.test.js` (fallback-first behavior)
- Test: `tests/engines/sendEmails.test.js` (holidays from config)
- Test: `tests/api/engineGuardrails.test.js` (GET + PUT + validation)
- Test: `tests/core/config/guardrailsSchema.test.js` (schema shape + validators)

**Commit cadence:** 5 commits — (a) seed defaults, (b) guardrails schema + its test, (c) engine/consumer reads with fallback + their tests, (d) guardrails route + test, (e) startup warning.

### Task 2.1: Add the 6 new config keys to `seedConfigDefaults`

- [ ] **Step 1: Read current `.env`** to capture the values we need to mirror

```bash
grep -E '^SPAM_WORDS|^MIN_EMAIL_WORDS|^MAX_EMAIL_WORDS' /home/darshanparmar/Projects/Outreach-Bot/.env
```

Note the values. (Do not paste them back into chat; they're already in `.env`.)

- [ ] **Step 2: Capture current hardcoded values** by reading `src/engines/sendEmails.js:15-22` (the `HOLIDAYS` constant) and `src/engines/findLeads.js:74-78` (the `SIZE_PROMPTS` object) and the interval cron schedule in `src/scheduler/cron.js`.

- [ ] **Step 3: Edit `src/core/db/index.js`**. In `seedConfigDefaults`, append 6 rows to the `defaults` array (before `createMany`):

```js
// Orphan settings migrated from .env/hardcoded in PR 2 (see spec §5.2)
['spam_words', JSON.stringify(
  (process.env.SPAM_WORDS || '').split(',').map(s => s.trim()).filter(Boolean)
)],
['email_min_words', process.env.MIN_EMAIL_WORDS || '40'],
['email_max_words', process.env.MAX_EMAIL_WORDS || '90'],
['send_holidays', JSON.stringify([
  // Mirror the current hardcoded list in sendEmails.js:15-22
  '2026-01-26', '2026-03-06', '2026-08-15', '2026-10-02',
  '2026-11-01', '2026-12-25',
])],
['findleads_size_prompts', JSON.stringify({
  msme: 'business with 1-10 employees, revenue under ₹5 crore',
  sme: 'business with 10-250 employees, revenue ₹5-500 crore',
  enterprise: 'business with 250+ employees, revenue over ₹500 crore',
})],
['check_replies_interval_minutes', '120'], // current cron fires at 14:00, 16:00, 20:00 — 2-hour average
```

(Replace the hardcoded arrays above with whatever the current codebase actually holds — take the values verbatim from the files you read in Step 2.)

- [ ] **Step 4: Write failing test** — seed includes new keys. In `tests/core/db/db.test.js` (or create one), add:

```js
it('seedConfigDefaults seeds 6 new orphan-migration keys', async () => {
  await seedConfigDefaults();
  const keys = await prisma.config.findMany({
    where: { key: { in: [
      'spam_words', 'email_min_words', 'email_max_words',
      'send_holidays', 'findleads_size_prompts', 'check_replies_interval_minutes',
    ] } },
  });
  expect(keys).toHaveLength(6);
  expect(JSON.parse(keys.find(k => k.key === 'spam_words').value)).toBeInstanceOf(Array);
  expect(JSON.parse(keys.find(k => k.key === 'send_holidays').value)).toBeInstanceOf(Array);
  expect(JSON.parse(keys.find(k => k.key === 'findleads_size_prompts').value)).toHaveProperty('msme');
});
```

- [ ] **Step 5: Run test**

```bash
npm test -- core/db/db.test.js 2>&1 | tail -20
```

Expected: PASS (assuming seed defaults were edited correctly).

- [ ] **Step 6: Commit**

```bash
git add src/core/db/index.js tests/core/db/db.test.js
git commit -m "feat(config): seed 6 orphan settings (spam_words, email word limits, holidays, size prompts, check-replies interval)"
```

### Task 2.2: Create `guardrailsSchema.js` — single source of truth for per-engine keys

**Context:** We want one place that answers "which config keys is engine X allowed to edit via the guardrails tab?" and "what's the validator for each key?". This module is imported by both the route handler and (later) the frontend via a `/api/engines/guardrails-schema` endpoint if needed. For now, backend-only.

- [ ] **Step 1: Write failing test** — `tests/core/config/guardrailsSchema.test.js`

```js
import { describe, it, expect } from 'vitest';
import {
  guardrailKeysFor, validateGuardrail, validateGuardrailPayload,
} from '../../../src/core/config/guardrailsSchema.js';

describe('guardrailsSchema', () => {
  it('returns the sendEmails key set', () => {
    expect(guardrailKeysFor('sendEmails').sort()).toEqual([
      'email_max_words', 'email_min_words', 'send_holidays', 'spam_words',
    ]);
  });
  it('returns the findLeads key set', () => {
    expect(guardrailKeysFor('findLeads')).toEqual(['findleads_size_prompts']);
  });
  it('returns [] for engines without guardrails', () => {
    expect(guardrailKeysFor('healthCheck')).toEqual([]);
    expect(guardrailKeysFor('dailyReport')).toEqual([]);
    expect(guardrailKeysFor('checkReplies')).toEqual([]);
    expect(guardrailKeysFor('sendFollowups')).toEqual([]);
  });
  it('validateGuardrail("spam_words", ...) rejects empty array', () => {
    expect(() => validateGuardrail('spam_words', [])).toThrow(/non-empty/);
  });
  it('validateGuardrail("email_min_words", ...) rejects non-integer', () => {
    expect(() => validateGuardrail('email_min_words', 12.5)).toThrow(/integer/);
  });
  it('validateGuardrail("send_holidays", ...) rejects bad dates', () => {
    expect(() => validateGuardrail('send_holidays', ['2026-99-01'])).toThrow(/date/i);
  });
  it('validateGuardrailPayload rejects min >= max', () => {
    expect(() => validateGuardrailPayload('sendEmails', {
      email_min_words: 90, email_max_words: 40,
    })).toThrow(/min.*max/i);
  });
});
```

- [ ] **Step 2: Run test to confirm fail**

```bash
npm test -- core/config/guardrailsSchema.test.js 2>&1 | tail -20
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `src/core/config/guardrailsSchema.js`**

```js
// One source of truth: which config keys each engine's Guardrails tab controls,
// and how to validate each key. Imported by src/api/routes/engineGuardrails.js.

const SCHEMA = {
  findLeads: {
    findleads_size_prompts: {
      parse: (raw) => typeof raw === 'string' ? JSON.parse(raw) : raw,
      validate: (v) => {
        if (!v || typeof v !== 'object' || Array.isArray(v)) {
          throw new Error('findleads_size_prompts must be an object');
        }
        for (const k of ['msme', 'sme', 'enterprise']) {
          if (typeof v[k] !== 'string' || !v[k].trim()) {
            throw new Error(`findleads_size_prompts.${k} must be a non-empty string`);
          }
        }
      },
    },
  },
  sendEmails: {
    spam_words: {
      parse: (raw) => typeof raw === 'string' ? JSON.parse(raw) : raw,
      validate: (v) => {
        if (!Array.isArray(v) || v.length === 0) throw new Error('spam_words must be a non-empty array');
        if (!v.every(x => typeof x === 'string' && x.trim())) {
          throw new Error('spam_words entries must be non-empty strings');
        }
      },
    },
    email_min_words: {
      parse: (raw) => typeof raw === 'number' ? raw : parseInt(raw, 10),
      validate: (v) => {
        if (!Number.isInteger(v) || v < 1) throw new Error('email_min_words must be a positive integer');
      },
    },
    email_max_words: {
      parse: (raw) => typeof raw === 'number' ? raw : parseInt(raw, 10),
      validate: (v) => {
        if (!Number.isInteger(v) || v < 1) throw new Error('email_max_words must be a positive integer');
      },
    },
    send_holidays: {
      parse: (raw) => typeof raw === 'string' ? JSON.parse(raw) : raw,
      validate: (v) => {
        if (!Array.isArray(v)) throw new Error('send_holidays must be an array');
        const bad = v.find(s => !/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s)));
        if (bad !== undefined) throw new Error(`send_holidays: invalid date "${bad}"`);
      },
    },
  },
  // Other engines have no guardrail surface.
};

export function guardrailKeysFor(engineName) {
  return Object.keys(SCHEMA[engineName] || {}).sort();
}

export function validateGuardrail(key, value) {
  for (const engine of Object.values(SCHEMA)) {
    if (engine[key]) {
      engine[key].validate(value);
      return;
    }
  }
  throw new Error(`Unknown guardrail key: ${key}`);
}

export function validateGuardrailPayload(engineName, payload) {
  const engineSchema = SCHEMA[engineName] || {};
  for (const [key, value] of Object.entries(payload)) {
    if (!engineSchema[key]) {
      throw Object.assign(new Error(`${key} is not a guardrail for ${engineName}`), { field: key });
    }
    try {
      engineSchema[key].validate(value);
    } catch (err) {
      throw Object.assign(err, { field: key });
    }
  }
  // Cross-field: email_min_words must be < email_max_words
  if ('email_min_words' in payload && 'email_max_words' in payload) {
    if (payload.email_min_words >= payload.email_max_words) {
      throw Object.assign(new Error('email_min_words must be less than email_max_words'),
        { field: 'email_min_words' });
    }
  }
}

export function parseStoredValue(key, storedString) {
  for (const engine of Object.values(SCHEMA)) {
    if (engine[key]) return engine[key].parse(storedString);
  }
  return storedString; // unknown key — return as-is
}
```

- [ ] **Step 4: Run test, confirm pass**

```bash
npm test -- core/config/guardrailsSchema.test.js 2>&1 | tail -20
```

- [ ] **Step 5: Commit**

```bash
git add src/core/config/guardrailsSchema.js tests/core/config/guardrailsSchema.test.js
git commit -m "feat(config): add guardrailsSchema — per-engine key map + validators"
```

### Task 2.3: `contentValidator.js` reads from config with .env fallback

- [ ] **Step 1: Write failing test** — `tests/core/email/contentValidator.test.js`

```js
import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../../../src/core/db/index.js';

describe('contentValidator — config-first with env fallback', () => {
  beforeEach(async () => {
    await prisma.config.deleteMany({
      where: { key: { in: ['spam_words', 'email_min_words', 'email_max_words'] } },
    });
  });

  it('reads word limits from config when present', async () => {
    await prisma.config.createMany({
      data: [
        { key: 'email_min_words', value: '30' },
        { key: 'email_max_words', value: '50' },
        { key: 'spam_words', value: JSON.stringify(['crypto', 'bitcoin']) },
      ],
    });
    const { validate } = await import('../../../src/core/email/contentValidator.js');
    const shortBody = 'one two three four five'; // 5 words, below min=30
    const result = await validate('Subject', shortBody, 0);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/below.*minimum/i);
  });

  it('falls back to .env when config keys missing', async () => {
    // config rows were deleted in beforeEach
    const { validate } = await import('../../../src/core/email/contentValidator.js?_=fallback');
    const body = 'lorem '.repeat(100); // 100 words, well above default max=90
    const result = await validate('Subject', body, 0);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/above.*maximum/i);
  });
});
```

- [ ] **Step 2: Run test, confirm fail**

```bash
npm test -- core/email/contentValidator.test.js 2>&1 | tail -20
```

- [ ] **Step 3: Refactor `src/core/email/contentValidator.js`** — switch `validate` to async, read config first, fall back.

```js
import 'dotenv/config';
import { getConfigMap, getConfigInt } from '../db/index.js';

let _fellBackKeys = new Set(); // for startup warning (see Task 2.7)

function envSpamWords() {
  return (process.env.SPAM_WORDS || '').split(',').map(s => s.trim()).filter(Boolean);
}

async function loadLimits() {
  const cfg = await getConfigMap();
  const min = getConfigInt(cfg, 'email_min_words', NaN);
  const max = getConfigInt(cfg, 'email_max_words', NaN);

  let spam;
  try {
    spam = cfg.spam_words ? JSON.parse(cfg.spam_words) : null;
    if (!Array.isArray(spam) || spam.length === 0) spam = null;
  } catch { spam = null; }

  if (!Number.isFinite(min)) { _fellBackKeys.add('email_min_words'); }
  if (!Number.isFinite(max)) { _fellBackKeys.add('email_max_words'); }
  if (!spam) { _fellBackKeys.add('spam_words'); }

  return {
    min: Number.isFinite(min) ? min : parseInt(process.env.MIN_EMAIL_WORDS || '40', 10),
    max: Number.isFinite(max) ? max : parseInt(process.env.MAX_EMAIL_WORDS || '90', 10),
    spamWords: spam || envSpamWords(),
  };
}

export function getFellBackKeys() {
  return Array.from(_fellBackKeys);
}

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export async function validate(subject, body, step) {
  const { min, max, spamWords } = await loadLimits();
  // … existing HTML / URL / word-count / spam-words checks, but using `min`/`max`/`spamWords`
}
```

(Preserve every existing rule — HTML detection, URL-in-step-0-or-1, spam-words regex, subject checks — just swap constants for the values returned by `loadLimits`.)

- [ ] **Step 4: Run test, confirm pass**

```bash
npm test -- core/email 2>&1 | tail -30
```

- [ ] **Step 5: Run downstream consumers' tests**

```bash
npm test -- engines/sendEmails 2>&1 | tail -20
```

Any callers that expected a sync `validate()` return now need `await`. Grep and update:

```bash
grep -rn "contentValidator" src tests
```

Update each call site to `await validate(...)`. Usually there's only one in `sendEmails.js`.

- [ ] **Step 6: Commit**

```bash
git add src/core/email/contentValidator.js tests/core/email/contentValidator.test.js src/engines/sendEmails.js
git commit -m "feat(validator): read word limits + spam words from config with .env fallback"
```

### Task 2.4: `sendEmails.js` reads holidays from config with hardcoded fallback

- [ ] **Step 1: Write failing test** — in `tests/engines/sendEmails.test.js`, add:

```js
it('treats send_holidays from config as the authoritative holiday list', async () => {
  await prisma.config.upsert({
    where: { key: 'send_holidays' },
    create: { key: 'send_holidays', value: JSON.stringify(['2026-04-21']) },
    update: { value: JSON.stringify(['2026-04-21']) },
  });
  const { isSendWindowOpen } = await import('../../src/engines/sendEmails.js?_=holidays');
  // 2026-04-21 in IST → should be blocked even at 10:00 IST weekday
  const tueMorning = new Date('2026-04-21T04:30:00Z'); // 10:00 IST
  expect(await isSendWindowOpen(tueMorning)).toBe(false);
});
```

(If `isSendWindowOpen` isn't already exported, export it as part of this change. It's the right seam for this test.)

- [ ] **Step 2: Confirm fail**

```bash
npm test -- engines/sendEmails.test.js 2>&1 | tail -30
```

- [ ] **Step 3: Edit `src/engines/sendEmails.js`**. Replace the `HOLIDAYS` constant at lines 15-22 with an async reader:

```js
import { getConfigMap } from '../core/db/index.js';

const HARDCODED_HOLIDAYS = [
  '2026-01-26', '2026-03-06', '2026-08-15', '2026-10-02',
  '2026-11-01', '2026-12-25',
]; // fallback if config missing/malformed

let _fellBackHolidays = false;
export function didFallbackHolidays() { return _fellBackHolidays; }

async function loadHolidays() {
  const cfg = await getConfigMap();
  try {
    const parsed = JSON.parse(cfg.send_holidays || 'null');
    if (Array.isArray(parsed) && parsed.every(d => /^\d{4}-\d{2}-\d{2}$/.test(d))) {
      _fellBackHolidays = false;
      return parsed;
    }
  } catch { /* noop */ }
  _fellBackHolidays = true;
  return HARDCODED_HOLIDAYS;
}
```

Update the existing send-window function to `await loadHolidays()` instead of reading the constant.

- [ ] **Step 4: Confirm test passes**

```bash
npm test -- engines/sendEmails.test.js 2>&1 | tail -20
```

- [ ] **Step 5: Commit**

```bash
git add src/engines/sendEmails.js tests/engines/sendEmails.test.js
git commit -m "feat(sendEmails): read send_holidays from config with hardcoded fallback"
```

### Task 2.5: `findLeads.js` reads size prompts from config with fallback

- [ ] **Step 1: Write failing test** — in `tests/engines/findLeads.test.js`:

```js
it('uses findleads_size_prompts from config for size-filter prompt', async () => {
  await prisma.config.upsert({
    where: { key: 'findleads_size_prompts' },
    create: { key: 'findleads_size_prompts', value: JSON.stringify({
      msme: 'custom msme prompt', sme: 'custom sme', enterprise: 'custom ent',
    }) },
    update: { value: JSON.stringify({
      msme: 'custom msme prompt', sme: 'custom sme', enterprise: 'custom ent',
    }) },
  });
  const { getSizePrompt } = await import('../../src/engines/findLeads.js?_=sizeprompts');
  expect(await getSizePrompt('msme')).toBe('custom msme prompt');
});
```

- [ ] **Step 2: Confirm fail, then implement** in `src/engines/findLeads.js` — replace `SIZE_PROMPTS` constant at lines 74-78 with an async loader; export `getSizePrompt(size)`. Fall back to a local `HARDCODED_SIZE_PROMPTS` when config missing.

- [ ] **Step 3: Confirm pass, commit**

```bash
git add src/engines/findLeads.js tests/engines/findLeads.test.js
git commit -m "feat(findLeads): read size prompts from config with hardcoded fallback"
```

### Task 2.6: `cron.js` reads check-replies interval from config

- [ ] **Step 1: Test — new `tests/scheduler/cron.test.js`**

```js
it('buildCheckRepliesSchedule returns cron string derived from check_replies_interval_minutes', async () => {
  await prisma.config.upsert({
    where: { key: 'check_replies_interval_minutes' },
    create: { key: 'check_replies_interval_minutes', value: '30' },
    update: { value: '30' },
  });
  const { buildCheckRepliesSchedule } = await import('../../src/scheduler/cron.js?_=interval');
  expect(await buildCheckRepliesSchedule()).toBe('*/30 * * * *');
});
```

- [ ] **Step 2: Confirm fail, then in `src/scheduler/cron.js`** refactor the fixed cron string for `checkReplies` into an async builder reading `check_replies_interval_minutes`. Fall back to the previous fixed schedule (`'0 14,16,20 * * *'`) if the key is missing or non-numeric.

- [ ] **Step 3: Confirm pass, commit**

```bash
git add src/scheduler/cron.js tests/scheduler/cron.test.js
git commit -m "feat(scheduler): read check_replies interval from config with fixed-schedule fallback"
```

### Task 2.7: Startup warning listing keys still in fallback

**Context:** The spec's 7-silent-days rule (§10 risk row) depends on a warning printed on server boot whenever any consumer is still falling back. Each consumer exposes its fallback set (`getFellBackKeys`, `didFallbackHolidays`, similar). The warning runs after seeds.

- [ ] **Step 1: Write failing test** — `tests/api/startupWarning.test.js`

```js
it('prints a warning listing keys still falling back to .env/hardcoded', async () => {
  await prisma.config.deleteMany({ where: { key: 'spam_words' } });
  const logs = [];
  const origWarn = console.warn;
  console.warn = (...args) => logs.push(args.join(' '));
  try {
    const { reportConfigFallbacks } = await import('../../src/api/server.js?_=warn');
    await reportConfigFallbacks();
    expect(logs.some(l => l.includes('spam_words'))).toBe(true);
  } finally {
    console.warn = origWarn;
  }
});
```

- [ ] **Step 2: Confirm fail, then in `src/api/server.js`** add:

```js
export async function reportConfigFallbacks() {
  // Trigger a load so each consumer populates its fallback set
  const { validate } = await import('../core/email/contentValidator.js');
  await validate('probe', 'one two three four', 0).catch(() => {});
  const { didFallbackHolidays } = await import('../engines/sendEmails.js');
  const { didFallbackSizePrompts } = await import('../engines/findLeads.js');
  const { didFallbackCheckRepliesInterval } = await import('../scheduler/cron.js');

  const fallbacks = [
    ...(await (await import('../core/email/contentValidator.js')).getFellBackKeys()),
    ...(didFallbackHolidays() ? ['send_holidays'] : []),
    ...(didFallbackSizePrompts() ? ['findleads_size_prompts'] : []),
    ...(didFallbackCheckRepliesInterval() ? ['check_replies_interval_minutes'] : []),
  ];
  if (fallbacks.length > 0) {
    console.warn(`[config fallback] Still reading from .env/hardcoded for: ${fallbacks.join(', ')}`);
  }
}

// In the boot block:
if (process.env.NODE_ENV !== 'test') {
  (async () => {
    try {
      await seedConfigDefaults();
      await seedNichesAndDefaults();
      await reportConfigFallbacks();
    } catch (err) {
      console.error('seed failed:', err);
    }
  })();
}
```

- [ ] **Step 3: Confirm pass, commit**

```bash
git add src/api/server.js tests/api/startupWarning.test.js
git commit -m "feat(server): warn on boot for any config key still falling back to .env/hardcoded"
```

### Task 2.8: New route `/api/engines/:engineName/guardrails`

- [ ] **Step 1: Write failing tests** — `tests/api/engineGuardrails.test.js`

```js
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/api/server.js';
import { prisma } from '../../src/core/db/index.js';
import { signTestToken } from '../helpers/auth.js';

const auth = { Authorization: `Bearer ${signTestToken()}` };

describe('/api/engines/:engineName/guardrails', () => {
  beforeEach(async () => {
    await prisma.config.upsert({
      where: { key: 'email_min_words' },
      create: { key: 'email_min_words', value: '40' }, update: { value: '40' },
    });
    await prisma.config.upsert({
      where: { key: 'email_max_words' },
      create: { key: 'email_max_words', value: '90' }, update: { value: '90' },
    });
  });

  it('GET sendEmails returns flat keyed object', async () => {
    const res = await request(app).get('/api/engines/sendEmails/guardrails').set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('email_min_words');
    expect(res.body).toHaveProperty('email_max_words');
    expect(res.body).toHaveProperty('spam_words');
    expect(res.body).toHaveProperty('send_holidays');
  });

  it('GET healthCheck returns empty object (200)', async () => {
    const res = await request(app).get('/api/engines/healthCheck/guardrails').set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });

  it('PUT validates email_min_words < email_max_words', async () => {
    const res = await request(app).put('/api/engines/sendEmails/guardrails')
      .set(auth).send({ email_min_words: 90, email_max_words: 40 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/min.*max/i);
    expect(res.body.field).toBe('email_min_words');
  });

  it('PUT persists valid update, returns { ok: true, data }', async () => {
    const res = await request(app).put('/api/engines/sendEmails/guardrails')
      .set(auth).send({ email_min_words: 30 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, data: expect.objectContaining({ email_min_words: 30 }) });
    const stored = await prisma.config.findUnique({ where: { key: 'email_min_words' } });
    expect(stored.value).toBe('30');
  });

  it('PUT rejects unknown key for engine', async () => {
    const res = await request(app).put('/api/engines/sendEmails/guardrails')
      .set(auth).send({ findleads_size_prompts: { msme: 'x', sme: 'y', enterprise: 'z' } });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('findleads_size_prompts');
  });
});
```

- [ ] **Step 2: Confirm fail, then create `src/api/routes/engineGuardrails.js`**

```js
import { Router } from 'express';
import { prisma } from '../../core/db/index.js';
import {
  guardrailKeysFor, validateGuardrailPayload, parseStoredValue,
} from '../../core/config/guardrailsSchema.js';

const router = Router();

router.get('/:engineName/guardrails', async (req, res) => {
  const keys = guardrailKeysFor(req.params.engineName);
  if (keys.length === 0) return res.json({});
  const rows = await prisma.config.findMany({ where: { key: { in: keys } } });
  const out = {};
  for (const row of rows) {
    out[row.key] = parseStoredValue(row.key, row.value);
  }
  res.json(out);
});

router.put('/:engineName/guardrails', async (req, res) => {
  const { engineName } = req.params;
  try {
    validateGuardrailPayload(engineName, req.body || {});
  } catch (err) {
    return res.status(400).json({ error: err.message, field: err.field });
  }
  for (const [key, value] of Object.entries(req.body)) {
    const stored = typeof value === 'string' || typeof value === 'number' ? String(value) : JSON.stringify(value);
    await prisma.config.upsert({
      where: { key }, create: { key, value: stored }, update: { value: stored },
    });
  }
  // Return updated flat object
  const keys = guardrailKeysFor(engineName);
  const rows = await prisma.config.findMany({ where: { key: { in: keys } } });
  const data = {};
  for (const row of rows) data[row.key] = parseStoredValue(row.key, row.value);
  res.json({ ok: true, data });
});

export default router;
```

- [ ] **Step 3: Mount the route** in `src/api/server.js`:

```js
import engineGuardrailsRoutes from './routes/engineGuardrails.js';
// after other app.use(...) lines:
app.use('/api/engines', engineGuardrailsRoutes);
```

- [ ] **Step 4: Confirm tests pass**

```bash
npm test -- api/engineGuardrails.test.js 2>&1 | tail -30
```

- [ ] **Step 5: Commit**

```bash
git add src/api/routes/engineGuardrails.js src/api/server.js tests/api/engineGuardrails.test.js
git commit -m "feat(api): add /api/engines/:engineName/guardrails — flat GET, validated PUT"
```

### Task 2.9: Deploy + verify on VPS

- [ ] **Step 1: Run full test suite**

```bash
npm test 2>&1 | tail -30
```

Expected: all pass (~109 existing + ~10 new).

- [ ] **Step 2: Deploy to VPS** — SSH, `git pull`, `npx prisma migrate deploy` (no-op for this PR; PR 1 already applied), `pm2 restart radar-cron radar-dashboard`, tail logs for 10 minutes.

- [ ] **Step 3: Confirm startup warning**. First boot, expect the warning to list keys if env still holds them and config is empty. Edit one key via dashboard (once PR 4 lands) or directly in DB to confirm the warning disappears.

---

## Chunk 3: 4-section nav + page renames

**Files:**
- Modify: `web/src/components/Sidebar.jsx` (4-group structure)
- Create: `web/src/redirects.js` (central old-path → new-path map)
- Modify: `web/src/App.jsx` (routes + redirect handling + import map)
- Rename: `web/src/pages/LeadPipeline.jsx` → `Leads.jsx`
- Rename: `web/src/pages/SendLog.jsx` → `SentEmails.jsx`
- Rename: `web/src/pages/SequenceTracker.jsx` → `Followups.jsx`
- Rename: `web/src/pages/ReplyFeed.jsx` → `Replies.jsx`
- Rename: `web/src/pages/FunnelAnalytics.jsx` → `Funnel.jsx`
- Rename: `web/src/pages/NicheManager.jsx` → `Niches.jsx`
- Rename: `web/src/pages/EmailPersona.jsx` → `EmailVoice.jsx`
- Rename: `web/src/pages/CostTracker.jsx` → `Spend.jsx`
- Rename: `web/src/pages/HealthMonitor.jsx` → `EmailHealth.jsx`
- Rename: `web/src/pages/ErrorLog.jsx` → `Errors.jsx`
- Rename: `web/src/pages/CronStatus.jsx` → `ScheduleLogs.jsx`
- Test: `web/src/redirects.test.js` (vitest)
- Modify: `web/package.json` (add vitest if absent; wire `test` script)

**Commit cadence:** 3 commits — (a) pure `git mv` page renames + import updates, (b) Sidebar + App route reshape, (c) redirect map + test.

### Task 3.1: Set up vitest in `web/` (if not already)

- [ ] **Step 1: Check for existing test config**

```bash
cat web/package.json | grep -E '"test"|"vitest"'
```

If `vitest` is absent:

- [ ] **Step 2: Install dev deps**

```bash
cd web && npm install --save-dev vitest @testing-library/react @testing-library/jest-dom jsdom
cd ..
```

- [ ] **Step 3: Add `vitest.config.js`** at `web/vitest.config.js`:

```js
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: { environment: 'jsdom', globals: true },
});
```

- [ ] **Step 4: Add script to `web/package.json`**

```json
"scripts": {
  "test": "vitest run"
}
```

- [ ] **Step 5: Commit**

```bash
git add web/package.json web/package-lock.json web/vitest.config.js
git commit -m "chore(web): wire vitest for frontend unit tests"
```

### Task 3.2: Rename pages with `git mv` (no code changes)

- [ ] **Step 1: Run renames**

```bash
cd web/src/pages
git mv LeadPipeline.jsx Leads.jsx
git mv SendLog.jsx SentEmails.jsx
git mv SequenceTracker.jsx Followups.jsx
git mv ReplyFeed.jsx Replies.jsx
git mv FunnelAnalytics.jsx Funnel.jsx
git mv NicheManager.jsx Niches.jsx
git mv EmailPersona.jsx EmailVoice.jsx
git mv CostTracker.jsx Spend.jsx
git mv HealthMonitor.jsx EmailHealth.jsx
git mv ErrorLog.jsx Errors.jsx
git mv CronStatus.jsx ScheduleLogs.jsx
cd ../../..
```

- [ ] **Step 2: Update default export component names** in each renamed file. For each file, change `export default function LeadPipeline() {` to `export default function Leads() {` and similar for the rest.

- [ ] **Step 3: Commit**

```bash
git add web/src/pages
git commit -m "refactor(web): rename 11 pages to user-facing labels (preserving git history via mv)"
```

### Task 3.3: Create `redirects.js` and test

- [ ] **Step 1: Write failing test** — `web/src/redirects.test.js`

```js
import { describe, it, expect } from 'vitest';
import { REDIRECTS } from './redirects.js';

describe('REDIRECTS', () => {
  const OLD_PATHS = [
    '/', '/run', '/leads', '/funnel', '/send-log', '/replies',
    '/sequences', '/cron', '/health', '/costs', '/errors',
    '/settings/niches', '/settings/engines', '/settings/offer',
    '/settings/icp-profile', '/settings/persona',
  ];

  it('covers every pre-existing top-level path', () => {
    for (const p of OLD_PATHS) {
      expect(REDIRECTS[p], `missing redirect for ${p}`).toBeDefined();
    }
  });

  it('every redirect target matches a known current route', () => {
    const VALID = new Set([
      '/', '/outreach/engines', '/outreach/leads', '/outreach/sent',
      '/outreach/followups', '/outreach/replies', '/outreach/funnel',
      '/setup/niches', '/setup/offer-icp', '/setup/voice',
      '/system/spend', '/system/email-health', '/system/errors', '/system/logs',
    ]);
    for (const target of Object.values(REDIRECTS)) {
      expect(VALID.has(target), `unknown target ${target}`).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Confirm fail**

```bash
cd web && npm test 2>&1 | tail -20
```

- [ ] **Step 3: Create `web/src/redirects.js`**

```js
// Redirect map for the 2026-04-21 dashboard tidy. Every pre-reshape path maps
// to its new home so bookmarks keep working. Wire-up is in App.jsx.
export const REDIRECTS = {
  '/':                     '/',                     // Today now lives at root
  '/run':                  '/outreach/engines',
  '/leads':                '/outreach/leads',
  '/funnel':               '/outreach/funnel',
  '/send-log':             '/outreach/sent',
  '/replies':              '/outreach/replies',
  '/sequences':            '/outreach/followups',
  '/cron':                 '/system/logs',
  '/health':               '/system/email-health',
  '/costs':                '/system/spend',
  '/errors':               '/system/errors',
  '/settings/niches':      '/setup/niches',
  '/settings/engines':     '/outreach/engines',
  '/settings/offer':       '/setup/offer-icp',
  '/settings/icp-profile': '/setup/offer-icp',
  '/settings/persona':     '/setup/voice',
};
```

- [ ] **Step 4: Confirm test passes, commit**

```bash
cd web && npm test && cd ..
git add web/src/redirects.js web/src/redirects.test.js
git commit -m "feat(web): central REDIRECTS map with coverage test"
```

### Task 3.4: Rewrite `Sidebar.jsx` — 4 sections, new labels

- [ ] **Step 1: Replace `web/src/components/Sidebar.jsx`** — full rewrite

```jsx
import React, { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { api } from '../api';

const SECTIONS = [
  {
    label: 'Home',
    items: [
      { path: '/', label: 'Today', icon: '⌂' },
    ],
  },
  {
    label: 'Outreach',
    items: [
      { path: '/outreach/engines',   label: 'Engines',    icon: '⚡' },
      { path: '/outreach/leads',     label: 'Leads',      icon: '◎' },
      { path: '/outreach/sent',      label: 'Sent Emails',icon: '✉' },
      { path: '/outreach/followups', label: 'Follow-ups', icon: '→' },
      { path: '/outreach/replies',   label: 'Replies',    icon: '↩' },
      { path: '/outreach/funnel',    label: 'Funnel',     icon: '▽' },
    ],
  },
  {
    label: 'Setup',
    items: [
      { path: '/setup/niches',   label: 'Niches & Schedule', icon: '🏷' },
      { path: '/setup/offer-icp',label: 'Offer & ICP',       icon: '🎯' },
      { path: '/setup/voice',    label: 'Email Voice',       icon: '✍' },
    ],
  },
  {
    label: 'System',
    items: [
      { path: '/system/spend',        label: 'Spend',            icon: '¤' },
      { path: '/system/email-health', label: 'Email Health',     icon: '♥' },
      { path: '/system/errors',       label: 'Errors',           icon: '⚠', showBadge: true },
      { path: '/system/logs',         label: 'Schedule & Logs',  icon: '⏱' },
    ],
  },
];

export default function Sidebar() {
  const navigate = useNavigate();
  const [unresolvedErrors, setUnresolvedErrors] = useState(0);

  useEffect(() => {
    api.errors('?resolved=0').then(d => {
      setUnresolvedErrors(d?.unresolvedCount || 0);
    }).catch(() => {});
  }, []);

  function handleLogout() {
    localStorage.removeItem('radar_token');
    navigate('/login');
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <h1>RADAR</h1>
        <span>by Simple Inc</span>
      </div>
      <nav className="sidebar-nav">
        {SECTIONS.map(section => (
          <div className="sidebar-section" key={section.label}>
            <div className="sidebar-section-label">{section.label}</div>
            {section.items.map(item => (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === '/'}
                className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
              >
                <span className="icon">{item.icon}</span>
                {item.label}
                {item.showBadge && unresolvedErrors > 0 && (
                  <span className="sidebar-badge">{unresolvedErrors}</span>
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <div className="sidebar-footer">
        <button className="sidebar-logout" onClick={handleLogout}>Logout</button>
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Add `.sidebar-section-label` style** in `web/src/index.css` (small uppercase label; match existing section style):

```css
.sidebar-section-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-muted, #888);
  padding: 10px 14px 6px;
}
```

### Task 3.5: Rewrite `App.jsx` — new routes + redirect handling

- [ ] **Step 1: Edit `web/src/App.jsx`** — update imports to new page filenames, add new routes under section prefixes, and add a catch-all that looks up `REDIRECTS` for bookmarked old paths.

```jsx
import { Navigate } from 'react-router-dom';
import { REDIRECTS } from './redirects';
// ... other imports, renamed to match new filenames:
import Today from './pages/Today';  // will be created in PR 6; for now use Overview placeholder
import Engines from './pages/EngineRunner'; // temporary until PR 4
import Leads from './pages/Leads';
// ... and so on

function OldPathRedirect() {
  const path = window.location.pathname;
  const target = REDIRECTS[path];
  return target ? <Navigate to={target} replace /> : <Navigate to="/" replace />;
}

<Routes>
  <Route path="/login" element={<Login />} />
  <Route path="/" element={<RequireAuth><Layout /></RequireAuth>}>
    <Route index element={<Today />} />
    <Route path="outreach/engines"   element={<Engines />} />
    <Route path="outreach/leads"     element={<Leads />} />
    <Route path="outreach/sent"      element={<SentEmails />} />
    <Route path="outreach/followups" element={<Followups />} />
    <Route path="outreach/replies"   element={<Replies />} />
    <Route path="outreach/funnel"    element={<Funnel />} />
    <Route path="setup/niches"       element={<Niches />} />
    <Route path="setup/offer-icp"    element={<OfferAndIcp />} />  {/* placeholder until PR 5 */}
    <Route path="setup/voice"        element={<EmailVoice />} />
    <Route path="system/spend"       element={<Spend />} />
    <Route path="system/email-health" element={<EmailHealth />} />
    <Route path="system/errors"      element={<Errors />} />
    <Route path="system/logs"        element={<ScheduleLogs />} />
    <Route path="*" element={<OldPathRedirect />} />
  </Route>
</Routes>
```

**Important:** `Today`, `Engines` (unified), and `OfferAndIcp` don't exist yet. For PR 3, wire `Today` → current `Overview` page (temporary), `Engines` → current `EngineRunner` page (temporary), and `OfferAndIcp` → current `Offer` page. PR 4, 5, 6 replace these targets.

- [ ] **Step 2: Delete the top-of-file `import EngineRunner from './pages/EngineRunner'` line once PR 4 lands** — tracked as a followup in PR 4's task list.

- [ ] **Step 3: Manual smoke test**

```bash
# terminal 1
./scripts/db-tunnel.sh up && node src/api/server.js
# terminal 2
cd web && npm run dev
```

Open http://localhost:5173 (or whatever Vite prints). Click each sidebar entry. Hit an old URL like `/leads` in the address bar — should 301 to `/outreach/leads`. Log in first.

- [ ] **Step 4: Commit**

```bash
git add web/src/App.jsx web/src/components/Sidebar.jsx web/src/index.css
git commit -m "feat(web): 4-section sidebar + routed under /outreach /setup /system; old paths redirected"
```

---

## Chunk 4: Unified Engines page

**Files:**
- Create: `src/api/routes/engines.js` (aggregate `GET /api/engines`)
- Modify: `src/api/server.js` (mount `/api/engines` — note: distinct from the guardrails sub-route mounted in PR 2)
- Delete: `web/src/pages/EngineRunner.jsx`
- Delete: `web/src/pages/EngineConfig.jsx`
- Create: `web/src/pages/Engines.jsx`
- Create: `web/src/components/EngineStatusPill.jsx`
- Move: `web/src/components/RunConfig.jsx` → reused inside Engines' Status tab (no change to component itself)
- Modify: `web/src/api.js` (add `getEngines`, remove `engineStatus`/`engineLatest`/`engineStats` if redundant; keep `runEngine`)
- Modify: `web/src/App.jsx` (swap the temporary `Engines → EngineRunner` import for the real `Engines`)
- Test: `tests/api/engines.test.js`
- Test: `web/src/pages/Engines.test.jsx` (render + tab switching smoke test)

**Commit cadence:** 3 commits — (a) aggregate `/api/engines` endpoint + test, (b) new `Engines.jsx` page + `<EngineStatusPill>`, (c) remove old EngineRunner/EngineConfig + api.js cleanup.

### Task 4.1: Aggregate `GET /api/engines` endpoint

- [ ] **Step 1: Write failing test** — `tests/api/engines.test.js`

```js
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../../src/api/server.js';
import { signTestToken } from '../helpers/auth.js';

const auth = { Authorization: `Bearer ${signTestToken()}` };

describe('GET /api/engines', () => {
  it('returns items for all 6 engines', async () => {
    const res = await request(app).get('/api/engines').set(auth);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(6);
    const names = res.body.items.map(i => i.name);
    expect(names).toEqual(expect.arrayContaining([
      'findLeads', 'sendEmails', 'checkReplies',
      'sendFollowups', 'healthCheck', 'dailyReport',
    ]));
  });

  it('each item carries enabled, lastRun, schedule, costToday', async () => {
    const res = await request(app).get('/api/engines').set(auth);
    const item = res.body.items[0];
    expect(item).toHaveProperty('enabled');
    expect(item).toHaveProperty('lastRun');
    expect(item).toHaveProperty('schedule');
    expect(item).toHaveProperty('costToday');
  });
});
```

- [ ] **Step 2: Create `src/api/routes/engines.js`**

```js
import { Router } from 'express';
import { prisma, today } from '../../core/db/index.js';

const ENGINES = [
  { name: 'findLeads',     schedule: '0 9 * * 1-6',   enabledKey: 'find_leads_enabled' },
  { name: 'sendEmails',    schedule: '30 9 * * 1-6',  enabledKey: 'send_emails_enabled' },
  { name: 'checkReplies',  schedule: 'dynamic',       enabledKey: 'check_replies_enabled' },
  { name: 'sendFollowups', schedule: '0 18 * * *',    enabledKey: 'send_followups_enabled' },
  { name: 'healthCheck',   schedule: '0 2 * * 0',     enabledKey: null },
  { name: 'dailyReport',   schedule: '30 20 * * *',   enabledKey: 'daily_report_enabled' },
];

const router = Router();

router.get('/', async (req, res) => {
  const cfg = Object.fromEntries(
    (await prisma.config.findMany()).map(r => [r.key, r.value])
  );
  const items = await Promise.all(ENGINES.map(async def => {
    const last = await prisma.cronLog.findFirst({
      where: { jobName: def.name },
      orderBy: { startedAt: 'desc' },
      select: {
        status: true, startedAt: true, durationMs: true,
        recordsProcessed: true, costUsd: true,
      },
    });
    const todaysCost = await prisma.cronLog.aggregate({
      where: { jobName: def.name, startedAt: { gte: new Date(today()) } },
      _sum: { costUsd: true },
    });
    return {
      name: def.name,
      enabled: def.enabledKey ? cfg[def.enabledKey] !== '0' : true,
      lastRun: last ? {
        status: last.status,
        startedAt: last.startedAt,
        durationMs: last.durationMs,
        primaryCount: last.recordsProcessed,
      } : null,
      schedule: def.schedule,
      costToday: todaysCost._sum.costUsd || 0,
    };
  }));
  res.json({ items });
});

export default router;
```

- [ ] **Step 3: Mount at `/api/engines` in `src/api/server.js`** — before the existing `/api/engines` guardrails mount, so the aggregate handler matches `GET /api/engines` exactly while the guardrails router keeps handling `/api/engines/:engineName/guardrails`. (Express matches routers in registration order; register the aggregate router first.)

Check the mount order is:
```js
app.use('/api/engines', enginesRoutes);           // aggregate — GET /
app.use('/api/engines', engineGuardrailsRoutes);  // GET/PUT /:engineName/guardrails
```

- [ ] **Step 4: Confirm tests pass**

```bash
npm test -- api/engines.test.js 2>&1 | tail -20
```

- [ ] **Step 5: Commit**

```bash
git add src/api/routes/engines.js src/api/server.js tests/api/engines.test.js
git commit -m "feat(api): GET /api/engines — aggregate status for all 6 engines"
```

### Task 4.2: `<EngineStatusPill>` component

- [ ] **Step 1: Create `web/src/components/EngineStatusPill.jsx`**

```jsx
import React from 'react';
import { formatRelative } from '../lib/time'; // existing helper if present; else inline

export default function EngineStatusPill({ engine, selected, onSelect }) {
  const dot = engine.enabled
    ? (engine.lastRun?.status === 'success' ? '🟢'
      : engine.lastRun?.status === 'failed' ? '🔴' : '🟡')
    : '⚪';

  return (
    <button
      type="button"
      onClick={() => onSelect(engine.name)}
      className={`engine-pill ${selected ? 'selected' : ''}`}
      aria-pressed={selected}
    >
      <div className="engine-pill-name">{engine.name}</div>
      <div className="engine-pill-meta">
        {dot} {engine.enabled ? 'on' : 'off'}
        {engine.lastRun && <> · {formatRelative(engine.lastRun.startedAt)} · {engine.lastRun.primaryCount ?? 0}</>}
      </div>
    </button>
  );
}
```

- [ ] **Step 2: Add minimal styles in `web/src/index.css`**

```css
.engine-pill { width: 100%; text-align: left; padding: 10px; border-radius: 6px;
  border: 0; background: transparent; color: inherit; cursor: pointer; margin-bottom: 4px; }
.engine-pill.selected { background: var(--color-bg-elev, #1a1d25);
  border-left: 3px solid var(--color-accent, #4a8); padding-left: 7px; }
.engine-pill-name { font-weight: 600; font-size: 13px; }
.engine-pill-meta { color: var(--color-muted, #888); font-size: 11px; margin-top: 2px; }
```

### Task 4.3: `Engines.jsx` — master/detail with 4 tabs

- [ ] **Step 1: Create `web/src/pages/Engines.jsx`**

```jsx
import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import EngineStatusPill from '../components/EngineStatusPill';
import RunConfig from '../components/RunConfig';

const GUARDRAIL_ENGINES = new Set(['findLeads', 'sendEmails']);
const CONFIG_ENGINES    = new Set(['findLeads', 'sendEmails', 'checkReplies', 'sendFollowups', 'dailyReport']);
const TAB_ORDER = ['status', 'config', 'guardrails', 'history'];

export default function Engines() {
  const { hash } = useLocation();
  const navigate = useNavigate();
  const [engines, setEngines] = useState([]);
  const [selected, setSelected] = useState(null);

  const activeTab = (hash.replace('#', '') || 'status');

  useEffect(() => {
    api.getEngines().then(d => {
      setEngines(d.items);
      if (!selected && d.items[0]) setSelected(d.items[0].name);
    });
  }, []);

  const engine = useMemo(() => engines.find(e => e.name === selected), [engines, selected]);

  function setTab(tab) {
    navigate({ hash: tab }, { replace: true });
  }

  if (!engine) return <div className="page-loading">Loading engines…</div>;

  const availableTabs = TAB_ORDER.filter(t =>
    t === 'status' || t === 'history'
      || (t === 'config'     && CONFIG_ENGINES.has(engine.name))
      || (t === 'guardrails' && GUARDRAIL_ENGINES.has(engine.name))
  );

  return (
    <div className="engines-page">
      <aside className="engines-master">
        <div className="sidebar-section-label">Engines</div>
        {engines.map(e => (
          <EngineStatusPill
            key={e.name}
            engine={e}
            selected={e.name === selected}
            onSelect={setSelected}
          />
        ))}
      </aside>
      <section className="engines-detail">
        <EngineHeader engine={engine} onRun={() => api.runEngine(engine.name).then(() => refresh(setEngines))} />
        <div className="engines-tabs">
          {availableTabs.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`engines-tab ${activeTab === t ? 'active' : ''}`}
            >
              {tabLabel(t)}
            </button>
          ))}
        </div>
        <div className="engines-tabpanel">
          {activeTab === 'status'     && <StatusTab engine={engine} />}
          {activeTab === 'config'     && <ConfigTab engine={engine} />}
          {activeTab === 'guardrails' && <GuardrailsTab engine={engine} />}
          {activeTab === 'history'    && <HistoryTab engine={engine} />}
        </div>
      </section>
    </div>
  );
}

function tabLabel(t) {
  return { status: 'Status', config: 'Config', guardrails: 'Guardrails', history: 'History' }[t];
}

async function refresh(setEngines) {
  const d = await api.getEngines();
  setEngines(d.items);
}

function EngineHeader({ engine, onRun }) { /* header + Run-now + Enabled toggle */ }
function StatusTab({ engine })     { /* 3 KPI cards + findLeads pipeline + RunConfig override */ }
function ConfigTab({ engine })     { /* form bound to /api/config (subset) per spec §4.3 */ }
function GuardrailsTab({ engine }) { /* form bound to /api/engines/:name/guardrails */ }
function HistoryTab({ engine })    { /* recent CronLog rows */ }
```

**This is a skeleton** — the `StatusTab`, `ConfigTab`, `GuardrailsTab`, `HistoryTab` components need filling in. Each is its own sub-task.

- [ ] **Step 2: Implement `StatusTab`** — read 3 KPIs from `engine.lastRun` + `engine.costToday`. Reuse `<RunConfig>` inside the Run-now panel. For `findLeads`, add the 11-stage pipeline row (needs a new lightweight API endpoint `/api/engines/findLeads/last-pipeline` or inline the breakdown from `/api/overview`).

- [ ] **Step 3: Implement `ConfigTab`** — form that reads `/api/config` and writes a subset via `api.updateConfig({...})`. Field set per engine from spec §4.3.

- [ ] **Step 4: Implement `GuardrailsTab`** — fetches `GET /api/engines/:engineName/guardrails` via a new `api.getGuardrails(name)` method; on save, `api.saveGuardrails(name, payload)` → `PUT`. On 400 response, surface `{error, field}` next to the offending field.

- [ ] **Step 5: Implement `HistoryTab`** — fetch `GET /api/cron-status/:engineName/history?limit=20`. Render as a table of start/status/duration/records. Row click opens `Errors` page filtered to that job+timestamp.

- [ ] **Step 6: Wire new `api.js` methods**

```js
getEngines:      () => fetchJson('/api/engines'),
getGuardrails:   (name) => fetchJson(`/api/engines/${name}/guardrails`),
saveGuardrails:  (name, payload) => fetchJson(`/api/engines/${name}/guardrails`, { method: 'PUT', body: JSON.stringify(payload) }),
```

Remove `engineStatus`, `engineLatest`, `engineStats` if no other page uses them (grep first).

- [ ] **Step 7: Manual smoke test**

```bash
./scripts/db-tunnel.sh up && node src/api/server.js &
cd web && npm run dev
```

Open the Engines page. Click each engine. Switch tabs. Run now on `checkReplies` (safest). Edit a Guardrail field, save, confirm the DB row changed.

- [ ] **Step 8: Frontend render test** — `web/src/pages/Engines.test.jsx`

```jsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Engines from './Engines';
import { vi } from 'vitest';

vi.mock('../api', () => ({
  api: {
    getEngines: () => Promise.resolve({ items: [
      { name: 'findLeads', enabled: true, lastRun: { status: 'success', startedAt: new Date(), durationMs: 1000, primaryCount: 28 }, schedule: '0 9 * * 1-6', costToday: 0.42 },
      { name: 'sendEmails', enabled: true, lastRun: null, schedule: '30 9 * * 1-6', costToday: 0 },
    ]}),
    runEngine: vi.fn(),
  },
}));

it('renders engines list and default engine detail', async () => {
  render(<MemoryRouter><Engines /></MemoryRouter>);
  expect(await screen.findByText('findLeads')).toBeInTheDocument();
  expect(screen.getByText('sendEmails')).toBeInTheDocument();
});
```

- [ ] **Step 9: Commit**

```bash
git add src/api/routes/engines.js web/src/pages/Engines.jsx \
  web/src/components/EngineStatusPill.jsx web/src/api.js web/src/App.jsx \
  web/src/pages/Engines.test.jsx tests/api/engines.test.js
git commit -m "feat(web): unified Engines page (master/detail, 4 tabs) replaces EngineRunner + EngineConfig"
```

### Task 4.4: Delete old `EngineRunner.jsx` + `EngineConfig.jsx`

- [ ] **Step 1: Confirm no imports remain**

```bash
grep -rn "EngineRunner\|EngineConfig" web/src
```

Expected: zero hits.

- [ ] **Step 2: Delete**

```bash
git rm web/src/pages/EngineRunner.jsx web/src/pages/EngineConfig.jsx
git commit -m "chore(web): remove old EngineRunner and EngineConfig pages"
```

---

## Chunk 5: Setup skeleton + Offer & ICP merge

**Files:**
- Create: `web/src/components/SettingsPage.jsx` (skeleton with `SettingsFormContext`)
- Create: `web/src/components/useSettingsField.js` (hook — separate file for testability)
- Modify: `web/src/pages/Niches.jsx` (adopt skeleton)
- Modify: `web/src/pages/EmailVoice.jsx` (adopt skeleton)
- Delete: `web/src/pages/Offer.jsx`
- Delete: `web/src/pages/IcpProfile.jsx`
- Create: `web/src/pages/OfferAndIcp.jsx` (two internal tabs)
- Modify: `src/api/routes/niches.js` (envelope `{items: [...]}`)
- Modify: `src/api/routes/offer.js` (flat singleton on GET, `{ok, data}` on PUT)
- Modify: `src/api/routes/icpProfile.js` (same)
- Modify: `web/src/api.js` (normalize envelope in helpers; adjust callers' expectations)
- Modify: `web/src/App.jsx` (swap `OfferAndIcp` import from temp `Offer` to real)
- Test: `web/src/components/SettingsPage.test.jsx`
- Test: `web/src/components/useSettingsField.test.jsx`
- Test: `tests/api/niches.test.js` (envelope)
- Test: `tests/api/offer.test.js` (envelope — or extend existing)
- Test: `tests/api/icpProfile.test.js` (envelope)

**Commit cadence:** 4 commits — (a) `<SettingsPage>` + hook + tests, (b) envelope changes on 3 routes + their tests, (c) `OfferAndIcp` merged page, (d) `Niches` + `EmailVoice` migrated to skeleton.

### Task 5.1: `<SettingsPage>` skeleton + `useSettingsField` hook

- [ ] **Step 1: Write failing test for the hook** — `web/src/components/useSettingsField.test.jsx`

```jsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import SettingsPage from './SettingsPage';
import { useSettingsField } from './useSettingsField';

function Input({ name }) {
  const { value, onChange, error } = useSettingsField(name);
  return <>
    <input aria-label={name} value={value || ''} onChange={e => onChange(e.target.value)} />
    {error && <span role="alert">{error}</span>}
  </>;
}

describe('useSettingsField', () => {
  it('reads and writes values through SettingsPage context', () => {
    const onSave = vi.fn();
    render(
      <SettingsPage title="t" description="d" initialValues={{ foo: 'bar' }} onSave={onSave}>
        <Input name="foo" />
      </SettingsPage>
    );
    const input = screen.getByLabelText('foo');
    expect(input).toHaveValue('bar');
    fireEvent.change(input, { target: { value: 'baz' } });
    expect(input).toHaveValue('baz');
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(onSave).toHaveBeenCalledWith({ foo: 'baz' });
  });

  it('throws a clear error when used outside a SettingsPage', () => {
    // React 18 error boundary escape hatch
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Input name="foo" />)).toThrow(/inside.*SettingsPage/);
    err.mockRestore();
  });
});
```

- [ ] **Step 2: Confirm fail, then implement** `web/src/components/SettingsPage.jsx`

```jsx
import React, { createContext, useContext, useMemo, useState, useCallback } from 'react';

const Ctx = createContext(null);

export default function SettingsPage({ title, description, initialValues, onSave, onValidate, children }) {
  const [values, setValues] = useState(initialValues || {});
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState(null);

  const dirty = useMemo(
    () => JSON.stringify(values) !== JSON.stringify(initialValues || {}),
    [values, initialValues]
  );

  const setField = useCallback((name, val) => {
    setValues(v => ({ ...v, [name]: val }));
  }, []);

  const handleSave = async () => {
    if (onValidate) {
      const e = onValidate(values) || {};
      setErrors(e);
      if (Object.keys(e).length) return;
    }
    setSaving(true);
    try {
      await onSave(values);
      setLastSavedAt(new Date());
    } finally { setSaving(false); }
  };

  const handleReset = () => { setValues(initialValues || {}); setErrors({}); };

  return (
    <Ctx.Provider value={{ values, setField, errors }}>
      <div className="settings-page">
        <header className="settings-page-header">
          <h1>{title}</h1>
          <p>{description}</p>
        </header>
        <main className="settings-page-body">{children}</main>
        <footer className="settings-page-footer">
          <button onClick={handleReset} disabled={!dirty || saving}>Reset</button>
          <button onClick={handleSave} disabled={!dirty || saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          {lastSavedAt && <span className="settings-page-saved">Last saved {timeAgo(lastSavedAt)}</span>}
        </footer>
      </div>
    </Ctx.Provider>
  );
}

export function useSettingsContext() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSettingsField/useSettingsContext must be used inside a SettingsPage');
  return ctx;
}

function timeAgo(d) {
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s/60)}m ago`;
  return d.toLocaleTimeString();
}
```

And `web/src/components/useSettingsField.js`:

```js
import { useSettingsContext } from './SettingsPage';

export function useSettingsField(name) {
  const { values, setField, errors } = useSettingsContext();
  return {
    value: values[name],
    onChange: (v) => setField(name, v),
    error: errors[name],
  };
}
```

- [ ] **Step 3: Confirm test passes, commit**

```bash
cd web && npm test && cd ..
git add web/src/components/SettingsPage.jsx web/src/components/useSettingsField.js \
  web/src/components/useSettingsField.test.jsx
git commit -m "feat(web): <SettingsPage> skeleton + useSettingsField hook (shared settings form infra)"
```

### Task 5.2: Standardize envelope on `/api/niches`, `/api/offer`, `/api/icp-profile`

- [ ] **Step 1: Write failing test** for niches envelope — `tests/api/niches.test.js`

```js
it('GET /api/niches returns { items: [...] }', async () => {
  const res = await request(app).get('/api/niches').set(auth);
  expect(res.body).toHaveProperty('items');
  expect(Array.isArray(res.body.items)).toBe(true);
});

it('POST /api/niches returns { ok: true, data: <niche> }', async () => {
  const res = await request(app).post('/api/niches').set(auth).send({ label: 'x', query: 'y', dayOfWeek: 1 });
  expect(res.body).toEqual({ ok: true, data: expect.objectContaining({ label: 'x' }) });
});
```

- [ ] **Step 2: Update `src/api/routes/niches.js`** — change GET to `res.json({ items: rows })`, change POST/PUT/DELETE to `res.json({ ok: true, data: <record> })`, change validation errors to `res.status(400).json({ error, field })`.

- [ ] **Step 3: Update `/api/offer`** — GET returns the offer fields flat (was `{ offer: {...} }`), PUT returns `{ ok: true, data: <offer> }`.

- [ ] **Step 4: Update `/api/icp-profile`** — same pattern.

- [ ] **Step 5: Update `web/src/api.js`** — adjust `getNiches` (pull `items`), `getOffer` (no unwrap), `getIcpProfile` (no unwrap), `updateOffer` + `updateIcpProfile` + niche mutations (expect `{ok, data}`).

- [ ] **Step 6: Confirm existing pages still load** — Niches, Offer, IcpProfile pages all render with new shapes. Fix any caller that still destructured the old wrapper.

- [ ] **Step 7: Commit**

```bash
git add src/api/routes/niches.js src/api/routes/offer.js src/api/routes/icpProfile.js \
  web/src/api.js tests/api/niches.test.js tests/api/offer.test.js tests/api/icpProfile.test.js
git commit -m "feat(api): standardize envelope on /api/niches /api/offer /api/icp-profile (items + ok/data)"
```

### Task 5.3: `OfferAndIcp.jsx` merged page

- [ ] **Step 1: Create `web/src/pages/OfferAndIcp.jsx`**

```jsx
import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import SettingsPage from '../components/SettingsPage';
import OfferForm from './OfferForm';     // split off current Offer.jsx body
import IcpProfileForm from './IcpProfileForm'; // split off current IcpProfile.jsx body
import { api } from '../api';

const TABS = ['offer', 'icp'];

export default function OfferAndIcp() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.includes(params.get('tab')) ? params.get('tab') : 'offer';
  const [offer, setOffer] = useState(null);
  const [icp, setIcp] = useState(null);

  useEffect(() => {
    api.getOffer().then(setOffer);
    api.getIcpProfile().then(setIcp);
  }, []);

  if (!offer || !icp) return <div>Loading…</div>;

  return (
    <div className="offer-and-icp">
      <nav className="subtabs">
        <button className={tab === 'offer' ? 'active' : ''} onClick={() => setParams({ tab: 'offer' })}>Offer</button>
        <button className={tab === 'icp' ? 'active' : ''} onClick={() => setParams({ tab: 'icp' })}>ICP Profile</button>
      </nav>

      {tab === 'offer' ? (
        <SettingsPage
          title="Offer" description="What you sell. Used across all outreach copy."
          initialValues={offer}
          onSave={(v) => api.updateOffer(v).then(r => setOffer(r))}
        >
          <OfferForm />
        </SettingsPage>
      ) : (
        <SettingsPage
          title="ICP Profile" description="Who you're targeting. Used by the ICP scorer."
          initialValues={icp}
          onSave={(v) => api.updateIcpProfile(v).then(r => setIcp(r))}
        >
          <IcpProfileForm />
        </SettingsPage>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Extract `OfferForm.jsx` and `IcpProfileForm.jsx`** from the existing `Offer.jsx` and `IcpProfile.jsx` bodies, wiring each field via `useSettingsField('fieldName')`.

- [ ] **Step 3: Delete the old pages**

```bash
git rm web/src/pages/Offer.jsx web/src/pages/IcpProfile.jsx
```

- [ ] **Step 4: Update `web/src/App.jsx`** — import `OfferAndIcp`, delete `Offer`/`IcpProfile` imports, keep the `/setup/offer-icp` route pointing at `OfferAndIcp` (replacing the PR 3 placeholder).

- [ ] **Step 5: Smoke test**. `/setup/offer-icp?tab=offer` and `?tab=icp` render correctly, edit + save round-trips, dirty/reset/saving states work.

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/OfferAndIcp.jsx web/src/pages/OfferForm.jsx web/src/pages/IcpProfileForm.jsx web/src/App.jsx
git commit -m "feat(web): merge Offer + IcpProfile into OfferAndIcp page on SettingsPage skeleton"
```

### Task 5.4: Migrate `Niches.jsx` and `EmailVoice.jsx` to `<SettingsPage>`

- [ ] **Step 1: Rewrite `Niches.jsx`** — `<SettingsPage>` at the top level with `initialValues = { niches: [...] }`. The niche list UI (add/edit/delete/day-toggle) lives inside as children, using `useSettingsField('niches')`. Save calls a custom `api.saveNiches(list)` that diffs against server state and issues the right CREATE/UPDATE/DELETE calls — or, simpler for PR 5, keep per-niche mutations inline and bypass SettingsPage's onSave for this page (document as an exception in the file header).

- [ ] **Step 2: Rewrite `EmailVoice.jsx`** — `<SettingsPage>` wrapping the persona fields, each field via `useSettingsField`. Save calls `api.updateConfig(values)` since persona fields live in the flat config KV table.

- [ ] **Step 3: Smoke test** each page. Dirty/Save/Reset work identically across all three Setup pages.

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/Niches.jsx web/src/pages/EmailVoice.jsx
git commit -m "feat(web): Niches and EmailVoice adopt <SettingsPage> skeleton"
```

---

## Chunk 6: Today page + tooltip glossary

**Files:**
- Create: `web/src/content/glossary.js`
- Create: `web/src/components/TechTerm.jsx`
- Create: `web/src/components/TechTerm.test.jsx`
- Create: `web/src/pages/Today.jsx`
- Modify: `web/src/App.jsx` (swap Today import from temp Overview to real)
- Modify: `web/src/components/Sidebar.jsx` (add section-label tooltips)
- Modify: many pages to wrap technical terms in `<TechTerm>` — inventoried below
- Delete: `web/src/pages/Overview.jsx` (moved into Today)

**Commit cadence:** 4 commits — (a) glossary + `<TechTerm>` + test, (b) apply `<TechTerm>` across pages, (c) `Today.jsx`, (d) sidebar section tooltips.

### Task 6.1: Glossary + `<TechTerm>` component

- [ ] **Step 1: Create `web/src/content/glossary.js`**

```js
// Central glossary for the dashboard. Keyed by id (stable) so labels can change
// without breaking tooltips. Each entry: { label, short, long? }.
// - short: shown in the ⓘ tooltip (under 12 words, a statement)
// - long (optional): anchor/docs link for the eventual help page

export const GLOSSARY = {
  bounceRate:     { label: 'bounce rate',     short: 'Emails that could not be delivered. Keep under 2% or sending auto-pauses.' },
  spamRate:       { label: 'spam rate',       short: 'Recipients marking your mail as junk. Under 0.1% is healthy.' },
  dmarc:          { label: 'DMARC',           short: 'Email authentication policy — who can send on your behalf.' },
  spf:            { label: 'SPF',             short: 'DNS record listing servers allowed to send mail for your domain.' },
  dkim:           { label: 'DKIM',            short: 'Cryptographic signature that proves mail came from your domain.' },
  icp:            { label: 'ICP',             short: 'Ideal Customer Profile — the kind of lead you want most.' },
  warmup:         { label: 'warmup',          short: 'Gradual ramp of daily sends to build a new domain\'s reputation.' },
  imap:           { label: 'IMAP',            short: 'Protocol used to read replies from an inbox.' },
  grounding:      { label: 'grounding',       short: 'Gemini feature that pulls live search results into prompts.' },
  mev:            { label: 'MEV',             short: 'MyEmailVerifier — paid service that checks email deliverability.' },
  rblZone:        { label: 'RBL zone',        short: 'Public blocklist. If your IP is listed, mail gets rejected.' },
  cron:           { label: 'cron',            short: 'Scheduled job that runs on a fixed clock.' },
  throttle:       { label: 'throttle',        short: 'Deliberate slowdown between sends to look human.' },
  deliverability: { label: 'deliverability',  short: 'How often your mail lands in the primary inbox (vs. spam).' },
};
```

- [ ] **Step 2: Write failing test** — `web/src/components/TechTerm.test.jsx`

```jsx
import { render, screen } from '@testing-library/react';
import TechTerm from './TechTerm';

it('wraps a term with tooltip content from the glossary', () => {
  render(<TechTerm id="bounceRate">bounce rate</TechTerm>);
  const term = screen.getByText('bounce rate');
  expect(term).toBeInTheDocument();
  // The info glyph should be present
  expect(screen.getByText('ⓘ')).toBeInTheDocument();
  // The tooltip text should be in the title attribute for a11y
  const wrapper = term.closest('[data-techterm]');
  expect(wrapper).toHaveAttribute('title', expect.stringContaining('under 2%'));
});

it('throws a clear error when id is missing from the glossary', () => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  expect(() => render(<TechTerm id="notAGlossaryEntry">x</TechTerm>))
    .toThrow(/glossary/i);
  err.mockRestore();
});
```

- [ ] **Step 3: Implement `web/src/components/TechTerm.jsx`**

```jsx
import React from 'react';
import { GLOSSARY } from '../content/glossary';

export default function TechTerm({ id, children }) {
  const entry = GLOSSARY[id];
  if (!entry) throw new Error(`TechTerm: glossary entry "${id}" not found`);
  return (
    <span data-techterm={id} title={entry.short} className="techterm">
      {children}
      <span aria-hidden="true" className="techterm-info">ⓘ</span>
    </span>
  );
}
```

Style in `web/src/index.css`:

```css
.techterm { border-bottom: 1px dotted var(--color-muted, #888); cursor: help; }
.techterm-info { color: var(--color-muted, #888); font-size: 0.85em; margin-left: 2px; }
```

- [ ] **Step 4: Confirm test passes, commit**

```bash
cd web && npm test && cd ..
git add web/src/content/glossary.js web/src/components/TechTerm.jsx web/src/components/TechTerm.test.jsx web/src/index.css
git commit -m "feat(web): <TechTerm> component + initial 14-entry glossary"
```

### Task 6.2: Apply `<TechTerm>` across existing pages

**Target pages (in priority order):** `EmailHealth`, `Engines` (Status tab), `Spend`, `OfferAndIcp`, `Today`. Other pages get it in a follow-up if needed.

- [ ] **Step 1: For each target page, grep for jargon** and wrap each first occurrence on the page:

```bash
grep -rn "Bounce Rate\|Spam Rate\|DMARC\|SPF\|DKIM\|IMAP\|ICP\|MEV\|RBL\|deliverability" web/src/pages
```

For each hit, replace `Bounce Rate` with `<TechTerm id="bounceRate">Bounce Rate</TechTerm>` and so on. Keep `id` → lowercase-camel. Add new glossary entries if a term doesn't have one (extend `glossary.js` and the 14-entry list in spec §6.2's growth note).

- [ ] **Step 2: Smoke test** — open the dashboard, hover each wrapped term, confirm a tooltip appears.

- [ ] **Step 3: Commit**

```bash
git add web/src/pages web/src/content/glossary.js
git commit -m "feat(web): apply <TechTerm> tooltips across EmailHealth, Engines, Spend, OfferAndIcp"
```

### Task 6.3: Create `Today.jsx` — Overview KPIs + reply action tile

- [ ] **Step 1: Create `web/src/pages/Today.jsx`**

```jsx
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import StatCard from '../components/StatCard';
import TechTerm from '../components/TechTerm';

export default function Today() {
  const [overview, setOverview] = useState(null);
  const [replies, setReplies] = useState([]);

  useEffect(() => {
    api.overview().then(setOverview);
    api.replies('?status=needs_action&limit=5').then(d => setReplies(d.replies || []));
  }, []);

  if (!overview) return <div>Loading…</div>;

  return (
    <div className="today-page">
      <header>
        <h1>Today</h1>
        <p>Pipeline at a glance plus anything waiting on you.</p>
      </header>

      <section className="today-kpis">
        <StatCard label="Leads today" value={overview.leadsDiscoveredToday} />
        <StatCard label="Sent today"  value={overview.emailsSentToday} />
        <StatCard
          label={<><TechTerm id="bounceRate">Bounce rate</TechTerm> today</>}
          value={`${(overview.bounceRateToday * 100).toFixed(2)}%`}
        />
        <StatCard
          label="Replies waiting"
          value={replies.length}
        />
      </section>

      <section className="today-replies">
        <h2>Replies that need you</h2>
        {replies.length === 0 ? (
          <p className="muted">Nothing waiting. Nice.</p>
        ) : (
          <ul>
            {replies.map(r => (
              <li key={r.id}>
                <Link to={`/outreach/replies#${r.id}`}>
                  <strong>{r.fromName || r.fromEmail}</strong> · {r.subject || '(no subject)'}
                  <span className="muted"> — {new Date(r.receivedAt).toLocaleString()}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Delete `web/src/pages/Overview.jsx`**

```bash
git rm web/src/pages/Overview.jsx
```

- [ ] **Step 3: Update `web/src/App.jsx`** — swap the `Today` import from `Overview` (PR 3 placeholder) to the new `Today.jsx`.

- [ ] **Step 4: Smoke test** — `/` loads Today with KPIs and up to 5 replies. Click a reply → deep link to `/outreach/replies#<id>` scrolls to the row.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/Today.jsx web/src/App.jsx
git commit -m "feat(web): Today page — KPIs + reply action tile replaces Overview"
```

### Task 6.4: Sidebar section tooltips

- [ ] **Step 1: Update `Sidebar.jsx` section-label rendering** to accept a tooltip:

```jsx
const SECTIONS = [
  { label: 'Home',     tooltip: 'Your daily starting point.', items: [...] },
  { label: 'Outreach', tooltip: 'Active leads, sends, replies, funnel.', items: [...] },
  { label: 'Setup',    tooltip: 'Who you target, what you sell, how you sound.', items: [...] },
  { label: 'System',   tooltip: 'Spend, deliverability, errors, schedule.', items: [...] },
];
```

Render as `<div className="sidebar-section-label" title={section.tooltip}>{section.label}</div>`.

- [ ] **Step 2: Smoke test** — hover each section label in the sidebar, confirm tooltip.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/Sidebar.jsx
git commit -m "feat(web): sidebar section tooltips explain each group to first-time users"
```

### Task 6.5: Final smoke test + full test run

- [ ] **Step 1: Run full backend + frontend test suites**

```bash
npm test 2>&1 | tail -20
cd web && npm test && cd ..
```

Expected: all green.

- [ ] **Step 2: Manual end-to-end walkthrough in the browser**

Sidebar sections reveal tooltips. Every sidebar entry loads a page. Today shows KPIs + replies. Engines tabs work. Settings pages save round-trip. Hover `ⓘ` on every technical label — tooltip appears. `/leads` (old path) 301s to `/outreach/leads`.

- [ ] **Step 3: Deploy to VPS**, tail logs for 15 minutes, confirm cron schedule resolves (especially `checkReplies` now on the dynamic interval from PR 2).

- [ ] **Step 4: Kick off the fallback-removal follow-up** once the startup warning has been silent for 7 days (spec §10 risk row).
