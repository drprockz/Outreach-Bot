# ICP Framework Refactor Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat 8-rule ICP scorer with a structured OFFER + ICP_PROFILE model that produces a 0–100 weighted score across 6 factors with per-factor breakdown, key matches, gaps, and hard disqualifiers.

**Architecture:** Two new singleton tables (`offer`, `icp_profile`) edited via dashboard forms. New `icpScorer.js` module replaces inline `stage9_icpScore` in findLeads. `leads` table gains 6 new columns (4 scoring + 2 extraction). A/B/C bucketing preserved but derived from 0–100 score via configurable thresholds. Disqualifiers override score via new `status='disqualified'`.

**Tech Stack:** Node.js 20 ESM, better-sqlite3, Express 4, vitest, React 18 + Vite, Gemini 2.5 Flash.

**Spec reference:** [`docs/superpowers/specs/2026-04-19-icp-framework-refactor-design.md`](../specs/2026-04-19-icp-framework-refactor-design.md)

**Chunks:**
1. Schema migration + seed + config defaults
2. `icpScorer.js` module (pure lib, unit-tested in isolation)
3. API routes for OFFER and ICP_PROFILE + `icp_weights` validation
4. Dashboard edit pages for OFFER and ICP_PROFILE
5. `findLeads.js` refactor: extraction extension + `insertLead` helper + Gate 3 rewrite
6. `scripts/rescoreLeads.js` with `--legacy` rollback support
7. Dashboard visualization updates (LeadPipeline drawer + FunnelAnalytics thresholds) — deployed atomically with Chunk 5

**Dependencies:**
- Chunks 1, 2 are independent — can be done in parallel
- Chunk 3 depends on Chunk 1
- Chunk 4 depends on Chunk 3
- Chunk 5 depends on Chunks 1, 2 (and Chunks 3, 4 for config to exist in prod)
- Chunk 6 depends on Chunks 1, 2
- Chunk 7 depends on Chunk 1 (new columns must exist) — merged with Chunk 5 deploy

---

## Chunk 1: Schema migration + seeds + config defaults

**Files:**
- Modify: `db/schema.sql`
- Modify: `src/core/db/index.js`
- Test: `tests/core/db/db.test.js`

**Commit cadence:** one commit for schema + initSchema changes + tests.

### Task 1.1: Write failing test — `initSchema` creates `offer` and `icp_profile` tables

- [ ] **Step 1: Open `tests/core/db/db.test.js`** and find the existing `initSchema creates icp_rules table` test near line 59. Add two parallel tests after it:

```js
it('initSchema creates offer table as singleton', async () => {
  await import('../../../src/core/db/index.js').then(m => m.initSchema());
  const db = (await import('../../../src/core/db/index.js')).getDb();
  const row = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='offer'`).get();
  expect(row).toBeTruthy();
  const seeded = db.prepare('SELECT * FROM offer WHERE id = 1').get();
  expect(seeded).toBeTruthy();
  expect(seeded.problem).toBeNull();
});

it('initSchema creates icp_profile table as singleton', async () => {
  await import('../../../src/core/db/index.js').then(m => m.initSchema());
  const db = (await import('../../../src/core/db/index.js')).getDb();
  const row = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='icp_profile'`).get();
  expect(row).toBeTruthy();
  const seeded = db.prepare('SELECT * FROM icp_profile WHERE id = 1').get();
  expect(seeded).toBeTruthy();
  expect(seeded.industries).toBeNull();
});
```

- [ ] **Step 2: Run and verify fail**

```bash
cd /Users/drprockz/Projects/Outreach && npm test -- core/db/db.test.js 2>&1 | tail -30
```

Expected: Two new tests fail — tables don't exist.

### Task 1.2: Add `offer` and `icp_profile` tables to schema

- [ ] **Step 1: Edit `db/schema.sql`**. At the end of the file (after `icp_rules` at line ~301), append:

```sql
-- ── OFFER (singleton) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS offer (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  problem         TEXT,
  outcome         TEXT,
  category        TEXT,
  use_cases       TEXT,  -- JSON array
  triggers        TEXT,  -- JSON array
  alternatives    TEXT,  -- JSON array
  differentiation TEXT,
  price_range     TEXT,
  sales_cycle     TEXT,
  criticality     TEXT,
  inaction_cost   TEXT,
  required_inputs TEXT,  -- JSON array
  proof_points    TEXT,  -- JSON array
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ── ICP PROFILE (singleton) ───────────────────────────────
CREATE TABLE IF NOT EXISTS icp_profile (
  id                     INTEGER PRIMARY KEY CHECK (id = 1),
  industries             TEXT,  -- JSON array
  company_size           TEXT,
  revenue_range          TEXT,
  geography              TEXT,  -- JSON array
  stage                  TEXT,  -- JSON array
  tech_stack             TEXT,  -- JSON array
  internal_capabilities  TEXT,  -- JSON array
  budget_range           TEXT,
  problem_frequency      TEXT,
  problem_cost           TEXT,
  impacted_kpis          TEXT,  -- JSON array
  initiator_roles        TEXT,  -- JSON array
  decision_roles         TEXT,  -- JSON array
  objections             TEXT,  -- JSON array
  buying_process         TEXT,
  intent_signals         TEXT,  -- JSON array
  current_tools          TEXT,  -- JSON array
  workarounds            TEXT,  -- JSON array
  frustrations           TEXT,  -- JSON array
  switching_barriers     TEXT,  -- JSON array
  hard_disqualifiers     TEXT,  -- JSON array
  updated_at             DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

- [ ] **Step 2: Edit `src/core/db/index.js`** `initSchema()` function (currently ends ~line 161). After the `icp_rules` seed block, add:

```js
// Seed offer singleton row (empty — human fills via dashboard)
db.prepare('INSERT OR IGNORE INTO offer (id) VALUES (1)').run();

// Seed icp_profile singleton row (empty)
db.prepare('INSERT OR IGNORE INTO icp_profile (id) VALUES (1)').run();
```

- [ ] **Step 3: Re-run the two tests**

```bash
npm test -- core/db/db.test.js 2>&1 | tail -20
```

Expected: PASS.

### Task 1.3: Write failing test — `addColumnIfMissing` is idempotent for leads columns

- [ ] **Step 1: Add test** to `tests/core/db/db.test.js`:

```js
it('initSchema adds new leads columns idempotently', async () => {
  const { initSchema, getDb } = await import('../../../src/core/db/index.js');
  initSchema();
  initSchema();  // second call must not throw
  const cols = getDb().prepare(`PRAGMA table_info(leads)`).all().map(c => c.name);
  expect(cols).toContain('icp_breakdown');
  expect(cols).toContain('icp_key_matches');
  expect(cols).toContain('icp_key_gaps');
  expect(cols).toContain('icp_disqualifiers');
  expect(cols).toContain('employees_estimate');
  expect(cols).toContain('business_stage');
});
```

- [ ] **Step 2: Run and verify fail**

```bash
npm test -- core/db/db.test.js 2>&1 | tail -10
```

Expected: FAIL — columns don't exist.

### Task 1.4: Implement `addColumnIfMissing` helper and call for 6 new columns

- [ ] **Step 1: Edit `src/core/db/index.js`** — add helper near top (after imports, before `initSchema`):

```js
function addColumnIfMissing(db, table, column, type) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some(c => c.name === column)) {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`).run();
  }
}
```

- [ ] **Step 2: Inside `initSchema()`**, after the DDL load (`db.exec(schemaSql)`), and before the niche seed, add:

```js
// Idempotent column adds for ICP framework refactor
addColumnIfMissing(db, 'leads', 'icp_breakdown',     'TEXT');
addColumnIfMissing(db, 'leads', 'icp_key_matches',   'TEXT');
addColumnIfMissing(db, 'leads', 'icp_key_gaps',      'TEXT');
addColumnIfMissing(db, 'leads', 'icp_disqualifiers', 'TEXT');
addColumnIfMissing(db, 'leads', 'employees_estimate', 'TEXT');
addColumnIfMissing(db, 'leads', 'business_stage',    'TEXT');
```

- [ ] **Step 3: Update `db/schema.sql`** `leads` table to include these columns so fresh databases also have them. Find the `leads` CREATE (around line 20) and add the 6 columns at the end of the column list (before `created_at`):

```sql
  -- ICP v2 framework (0-100 score with breakdown)
  icp_breakdown         TEXT,          -- JSON {firmographic,problem,intent,tech,economic,buying}
  icp_key_matches       TEXT,          -- JSON array
  icp_key_gaps          TEXT,          -- JSON array
  icp_disqualifiers     TEXT,          -- JSON array
  employees_estimate    TEXT,          -- "1-10" | "10-50" | "50-200" | "unknown"
  business_stage        TEXT,          -- "owner-operated" | "growing" | "established" | "unknown"
```

- [ ] **Step 4: Update the `status` enum comment** in `db/schema.sql` (currently at lines 49-51) to add `disqualified`:

```sql
  status                TEXT DEFAULT 'discovered',
  -- discovered / extraction_failed / judge_skipped / email_not_found /
  -- email_invalid / icp_c / deduped / ready / queued / sent / replied /
  -- unsubscribed / bounced / nurture / disqualified
```

- [ ] **Step 5: Run tests**

```bash
npm test -- core/db/db.test.js 2>&1 | tail -10
```

Expected: PASS.

### Task 1.5: Write failing test — `initSchema` seeds default config rows for ICP v2

- [ ] **Step 1: Add test** to `tests/core/db/db.test.js`:

```js
it('initSchema seeds default icp_weights and thresholds config rows', async () => {
  const { initSchema, getDb } = await import('../../../src/core/db/index.js');
  initSchema();
  const row = (k) => getDb().prepare('SELECT value FROM config WHERE key = ?').get(k)?.value;
  expect(Number(row('icp_threshold_a'))).toBe(70);
  expect(Number(row('icp_threshold_b'))).toBe(40);
  const weights = JSON.parse(row('icp_weights'));
  expect(weights).toEqual({ firmographic: 20, problem: 20, intent: 15, tech: 15, economic: 15, buying: 15 });
});
```

- [ ] **Step 2: Run and verify fail**

```bash
npm test -- core/db/db.test.js 2>&1 | tail -10
```

### Task 1.6: Seed ICP v2 config defaults

- [ ] **Step 1: Find `seedConfigDefaults` in `src/core/db/index.js`** (or if config seeding happens inline in `initSchema`). Inspect the current shape first:

```bash
grep -n "seedConfigDefaults\|config.*INSERT\|INSERT.*config" /Users/drprockz/Projects/Outreach/src/core/db/index.js
```

- [ ] **Step 2: Add to the config seed block** (wherever `icp_threshold_a` / `icp_threshold_b` are already set — they may exist as plain integer defaults; if not, add them):

```js
const configDefaults = [
  // ... existing defaults
  ['icp_threshold_a', '70'],
  ['icp_threshold_b', '40'],
  ['icp_weights', JSON.stringify({ firmographic: 20, problem: 20, intent: 15, tech: 15, economic: 15, buying: 15 })],
];

const stmt = db.prepare('INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)');
configDefaults.forEach(([k, v]) => stmt.run(k, v));
```

Use `INSERT OR IGNORE` so existing prod values are preserved. If `icp_threshold_a=7` already exists from old default, it will NOT be overwritten — see Task 1.7.

- [ ] **Step 3: Run tests** — they will still fail if the config seed isn't reached by `initSchema`. Wire it up if needed.

### Task 1.7: Write and implement one-off config upgrade for existing prod DBs

**Context:** Prod already has `icp_threshold_a=7` (0–10 scale). The `INSERT OR IGNORE` won't overwrite it. We need a one-time upgrade that detects the old scale and flips it to the new defaults.

- [ ] **Step 1: Write failing test** in `tests/core/db/db.test.js`:

```js
it('initSchema upgrades icp thresholds from 0-10 scale to 0-100 scale', async () => {
  const { initSchema, getDb } = await import('../../../src/core/db/index.js');
  initSchema();
  // Simulate old prod state
  getDb().prepare(`INSERT OR REPLACE INTO config (key, value) VALUES ('icp_threshold_a', '7')`).run();
  getDb().prepare(`INSERT OR REPLACE INTO config (key, value) VALUES ('icp_threshold_b', '4')`).run();
  initSchema();  // run migration again
  expect(Number(getDb().prepare(`SELECT value FROM config WHERE key='icp_threshold_a'`).get().value)).toBe(70);
  expect(Number(getDb().prepare(`SELECT value FROM config WHERE key='icp_threshold_b'`).get().value)).toBe(40);
});
```

- [ ] **Step 2: Run — verify fail**

- [ ] **Step 3: Implement the upgrade in `initSchema()`** after the config defaults seed:

```js
// One-off upgrade: if thresholds are still on 0-10 scale, flip to 0-100 defaults
const threshA = Number(db.prepare(`SELECT value FROM config WHERE key='icp_threshold_a'`).get()?.value);
if (threshA && threshA <= 10) {
  db.prepare(`UPDATE config SET value='70' WHERE key='icp_threshold_a'`).run();
  db.prepare(`UPDATE config SET value='40' WHERE key='icp_threshold_b'`).run();
}
```

- [ ] **Step 4: Run all db tests**

```bash
npm test -- core/db/db.test.js
```

Expected: all PASS.

### Task 1.8: Run full test suite to catch regressions

- [ ] **Step 1:**

```bash
cd /Users/drprockz/Projects/Outreach && npm test 2>&1 | tail -20
```

Expected: all existing 109 tests still pass + ~5 new tests.

### Task 1.9: Commit Chunk 1

- [ ] **Step 1:**

```bash
cd /Users/drprockz/Projects/Outreach && git add db/schema.sql src/core/db/index.js tests/core/db/db.test.js && git commit -m "feat(db): add offer + icp_profile tables + new leads columns

- New singleton tables: offer (13 fields) and icp_profile (21 fields)
- New leads columns: icp_breakdown, icp_key_matches, icp_key_gaps,
  icp_disqualifiers, employees_estimate, business_stage
- Idempotent addColumnIfMissing helper for live prod migrations
- Config defaults: icp_weights (JSON), icp_threshold_a=70, icp_threshold_b=40
- One-off upgrade: flips thresholds from 0-10 to 0-100 scale if detected
- Status enum comment updated to include 'disqualified'

Part of ICP framework refactor — see docs/superpowers/specs/
2026-04-19-icp-framework-refactor-design.md"
```

---

## Chunk 2: `icpScorer.js` module

**Files:**
- Create: `src/core/ai/icpScorer.js`
- Create: `tests/core/ai/icpScorer.test.js`

### Task 2.1: Write failing tests for `bucket()` helper

- [ ] **Step 1: Create `tests/core/ai/icpScorer.test.js`**:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { bucket, clampInt } from '../../../src/core/ai/icpScorer.js';

describe('bucket()', () => {
  it('returns A when score >= threshA', () => {
    expect(bucket(70, 70, 40)).toBe('A');
    expect(bucket(100, 70, 40)).toBe('A');
  });
  it('returns B when threshB <= score < threshA', () => {
    expect(bucket(69, 70, 40)).toBe('B');
    expect(bucket(40, 70, 40)).toBe('B');
  });
  it('returns C when score < threshB', () => {
    expect(bucket(39, 70, 40)).toBe('C');
    expect(bucket(0, 70, 40)).toBe('C');
  });
});

describe('clampInt()', () => {
  it('clamps low', () => expect(clampInt(-5, 0, 100)).toBe(0));
  it('clamps high', () => expect(clampInt(200, 0, 100)).toBe(100));
  it('passes through valid', () => expect(clampInt(50, 0, 100)).toBe(50));
  it('rounds floats', () => expect(clampInt(49.7, 0, 100)).toBe(50));
  it('handles NaN', () => expect(clampInt(NaN, 0, 100)).toBe(0));
});
```

- [ ] **Step 2: Run and verify fail**

```bash
npm test -- core/ai/icpScorer.test.js
```

Expected: fails — module doesn't exist.

### Task 2.2: Create `icpScorer.js` with pure helpers

- [ ] **Step 1: Create `src/core/ai/icpScorer.js`**:

```js
import { callGemini } from './gemini.js';
import { logError } from '../db/index.js';

const OFFER_JSON_FIELDS = ['use_cases', 'triggers', 'alternatives', 'required_inputs', 'proof_points'];
const ICP_JSON_FIELDS   = [
  'industries', 'geography', 'stage', 'tech_stack', 'internal_capabilities',
  'impacted_kpis', 'initiator_roles', 'decision_roles', 'objections',
  'intent_signals', 'current_tools', 'workarounds', 'frustrations',
  'switching_barriers', 'hard_disqualifiers'
];

export function clampInt(n, lo, hi) {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

export function bucket(score, threshA, threshB) {
  if (score >= threshA) return 'A';
  if (score >= threshB) return 'B';
  return 'C';
}

function parseJsonFields(row, fields) {
  const out = { ...row };
  for (const f of fields) {
    if (out[f] == null) { out[f] = []; continue; }
    try {
      const parsed = JSON.parse(out[f]);
      out[f] = Array.isArray(parsed) ? parsed : [];
    } catch {
      // corrupted JSON in DB — log and use empty array
      console.warn(`icpScorer: malformed JSON in field "${f}", using []`);
      out[f] = [];
    }
  }
  return out;
}

function stripJson(text) {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
}

export function loadScoringContext(db) {
  const offer = db.prepare('SELECT * FROM offer WHERE id = 1').get();
  const icp   = db.prepare('SELECT * FROM icp_profile WHERE id = 1').get();
  if (!offer || !icp) {
    throw new Error('ICP scoring requires offer + icp_profile rows to exist');
  }
  const parsedOffer = parseJsonFields(offer, OFFER_JSON_FIELDS);
  const parsedIcp   = parseJsonFields(icp, ICP_JSON_FIELDS);
  if (!parsedOffer.problem || !Array.isArray(parsedIcp.industries) || parsedIcp.industries.length === 0) {
    throw new Error('ICP scoring requires offer.problem and icp_profile.industries to be configured');
  }
  return { offer: parsedOffer, icp: parsedIcp };
}

export function buildScorerPrompt(lead, offer, icp, weights) {
  return `You are an ICP scoring engine.

OFFER: ${JSON.stringify(offer)}
ICP_PROFILE: ${JSON.stringify(icp)}
LEAD: ${JSON.stringify({
    business_name: lead.business_name,
    industry: lead.category,
    employees_estimate: lead.employees_estimate || 'unknown',
    business_stage: lead.business_stage || 'unknown',
    geography: lead.city,
    tech_stack: lead.tech_stack || [],
    roles_present: lead.owner_role ? [lead.owner_role] : [],
    signals: [
      ...(Array.isArray(lead.business_signals) ? lead.business_signals : []),
      ...(Array.isArray(lead.website_problems) ? lead.website_problems : [])
    ],
    observed_pains: lead.judge_reason || null,
  })}

Score LEAD 0-100 using these weights: ${JSON.stringify(weights)}.

Scoring method:
- Firmographic Fit (0-${weights.firmographic}): match industry, size, stage, geography
- Problem Intensity (0-${weights.problem}): evidence of pains aligned to OFFER.problem and ICP.problem_cost/frequency
- Intent/Trigger (0-${weights.intent}): presence of ICP.intent_signals or OFFER.triggers
- Tech/Environment Fit (0-${weights.tech}): overlap with ICP.tech_stack
- Economic Fit (0-${weights.economic}): inferred capacity vs OFFER.price_range (use business_stage/employees as proxy)
- Buying Readiness (0-${weights.buying}): presence of initiator_roles, decision_roles, compatible buying_process

For each factor, award points proportional to evidence.
Missing evidence counts as a key_gap, not a penalty.
If LEAD matches any ICP.hard_disqualifiers, list them in disqualifiers.

Return JSON ONLY (no markdown fences):
{
  "score": <int 0-100>,
  "breakdown": {"firmographic":n,"problem":n,"intent":n,"tech":n,"economic":n,"buying":n},
  "key_matches": [<strings>],
  "key_gaps": [<strings>],
  "disqualifiers": [<strings>]
}`;
}

function summarize({ key_matches, key_gaps, disqualifiers }) {
  const parts = [];
  if (disqualifiers && disqualifiers.length) parts.push(`DQ: ${disqualifiers.slice(0, 2).join(', ')}`);
  if (key_matches && key_matches.length)     parts.push(`✓ ${key_matches.slice(0, 2).join(', ')}`);
  if (key_gaps && key_gaps.length)           parts.push(`? ${key_gaps.slice(0, 2).join(', ')}`);
  return parts.join(' | ').slice(0, 300);
}

export async function scoreLead(lead, ctx) {
  const { offer, icp, weights, threshA, threshB } = ctx;
  const prompt = buildScorerPrompt(lead, offer, icp, weights);
  const result = await callGemini(prompt);

  let parsed;
  try {
    parsed = JSON.parse(stripJson(result.text));
  } catch (err) {
    logError('icpScorer.parse', err, { rawResponse: result.text, leadId: lead.id });
    return {
      icp_score: 0,
      icp_priority: 'C',
      icp_breakdown: null,
      icp_key_matches: [],
      icp_key_gaps: ['scorer_parse_error'],
      icp_disqualifiers: [],
      icp_reason: 'parse error',
      costUsd: result.costUsd,
    };
  }

  const score = clampInt(parsed.score, 0, 100);
  return {
    icp_score:         score,
    icp_priority:      bucket(score, threshA, threshB),
    icp_breakdown:     parsed.breakdown || null,
    icp_key_matches:   Array.isArray(parsed.key_matches) ? parsed.key_matches : [],
    icp_key_gaps:      Array.isArray(parsed.key_gaps) ? parsed.key_gaps : [],
    icp_disqualifiers: Array.isArray(parsed.disqualifiers) ? parsed.disqualifiers : [],
    icp_reason:        summarize(parsed),
    costUsd:           result.costUsd,
  };
}
```

- [ ] **Step 2: Run bucket/clampInt tests**

```bash
npm test -- core/ai/icpScorer.test.js -t "bucket\\|clampInt"
```

Expected: PASS.

### Task 2.3: Write failing tests for `loadScoringContext`

- [ ] **Step 1: Add to `tests/core/ai/icpScorer.test.js`**:

```js
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('loadScoringContext', () => {
  let tmpDir;
  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'radar-test-'));
    process.env.DB_PATH = join(tmpDir, 'radar.sqlite');
    const { resetDb, initSchema } = await import('../../../src/core/db/index.js');
    resetDb();
    initSchema();
  });
  afterEach(async () => {
    const { resetDb } = await import('../../../src/core/db/index.js');
    resetDb();
    rmSync(tmpDir, { recursive: true });
  });

  it('throws when offer.problem is empty (seeded but unconfigured)', async () => {
    const { loadScoringContext } = await import('../../../src/core/ai/icpScorer.js');
    const { getDb } = await import('../../../src/core/db/index.js');
    expect(() => loadScoringContext(getDb())).toThrow(/offer\.problem/);
  });

  it('throws when icp_profile.industries is empty array', async () => {
    const { loadScoringContext } = await import('../../../src/core/ai/icpScorer.js');
    const { getDb } = await import('../../../src/core/db/index.js');
    const db = getDb();
    db.prepare(`UPDATE offer SET problem = 'outdated websites' WHERE id = 1`).run();
    // industries still null
    expect(() => loadScoringContext(db)).toThrow(/industries/);
  });

  it('returns parsed context when both rows properly configured', async () => {
    const { loadScoringContext } = await import('../../../src/core/ai/icpScorer.js');
    const { getDb } = await import('../../../src/core/db/index.js');
    const db = getDb();
    db.prepare(`UPDATE offer SET problem = 'outdated websites' WHERE id = 1`).run();
    db.prepare(`UPDATE icp_profile SET industries = ? WHERE id = 1`).run(JSON.stringify(['restaurants', 'salons']));
    const ctx = loadScoringContext(db);
    expect(ctx.offer.problem).toBe('outdated websites');
    expect(ctx.icp.industries).toEqual(['restaurants', 'salons']);
  });

  it('returns [] for malformed JSON array fields instead of throwing', async () => {
    const { loadScoringContext } = await import('../../../src/core/ai/icpScorer.js');
    const { getDb } = await import('../../../src/core/db/index.js');
    const db = getDb();
    db.prepare(`UPDATE offer SET problem='x', use_cases='not-valid-json' WHERE id = 1`).run();
    db.prepare(`UPDATE icp_profile SET industries=? WHERE id = 1`).run(JSON.stringify(['x']));
    const ctx = loadScoringContext(db);
    expect(ctx.offer.use_cases).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — verify all 4 pass**

```bash
npm test -- core/ai/icpScorer.test.js -t "loadScoringContext"
```

### Task 2.4: Write failing tests for `scoreLead`

- [ ] **Step 1: Add to test file**:

```js
vi.mock('../../../src/core/ai/gemini.js', () => ({
  callGemini: vi.fn()
}));

describe('scoreLead', () => {
  const ctx = {
    offer: { problem: 'outdated sites', use_cases: [], triggers: [], alternatives: [], required_inputs: [], proof_points: [] },
    icp: { industries: ['restaurants'], geography: [], stage: [], tech_stack: [], internal_capabilities: [],
           impacted_kpis: [], initiator_roles: [], decision_roles: [], objections: [], intent_signals: [],
           current_tools: [], workarounds: [], frustrations: [], switching_barriers: [], hard_disqualifiers: [] },
    weights: { firmographic: 20, problem: 20, intent: 15, tech: 15, economic: 15, buying: 15 },
    threshA: 70, threshB: 40,
  };
  const lead = { business_name: 'X', category: 'restaurant', city: 'Mumbai' };

  beforeEach(async () => {
    const { callGemini } = await import('../../../src/core/ai/gemini.js');
    callGemini.mockReset();
  });

  it('returns normalized result on valid JSON', async () => {
    const { callGemini } = await import('../../../src/core/ai/gemini.js');
    callGemini.mockResolvedValueOnce({
      text: JSON.stringify({
        score: 75,
        breakdown: { firmographic: 18, problem: 17, intent: 10, tech: 12, economic: 10, buying: 8 },
        key_matches: ['restaurant industry match', 'Mumbai geo'],
        key_gaps: ['budget unknown'],
        disqualifiers: []
      }),
      costUsd: 0.001,
    });
    const { scoreLead } = await import('../../../src/core/ai/icpScorer.js');
    const result = await scoreLead(lead, ctx);
    expect(result.icp_score).toBe(75);
    expect(result.icp_priority).toBe('A');
    expect(result.icp_key_matches).toEqual(['restaurant industry match', 'Mumbai geo']);
    expect(result.icp_disqualifiers).toEqual([]);
    expect(result.costUsd).toBe(0.001);
  });

  it('falls back to 0/C/parse_error on malformed JSON', async () => {
    const { callGemini } = await import('../../../src/core/ai/gemini.js');
    callGemini.mockResolvedValueOnce({ text: 'not json at all', costUsd: 0.001 });
    const { scoreLead } = await import('../../../src/core/ai/icpScorer.js');
    const result = await scoreLead(lead, ctx);
    expect(result.icp_score).toBe(0);
    expect(result.icp_priority).toBe('C');
    expect(result.icp_key_gaps).toEqual(['scorer_parse_error']);
    expect(result.icp_reason).toBe('parse error');
  });

  it('clamps negative scores to 0', async () => {
    const { callGemini } = await import('../../../src/core/ai/gemini.js');
    callGemini.mockResolvedValueOnce({ text: JSON.stringify({ score: -5, breakdown: {}, key_matches: [], key_gaps: [], disqualifiers: [] }), costUsd: 0 });
    const { scoreLead } = await import('../../../src/core/ai/icpScorer.js');
    const result = await scoreLead(lead, ctx);
    expect(result.icp_score).toBe(0);
  });

  it('clamps scores over 100 to 100', async () => {
    const { callGemini } = await import('../../../src/core/ai/gemini.js');
    callGemini.mockResolvedValueOnce({ text: JSON.stringify({ score: 200, breakdown: {}, key_matches: [], key_gaps: [], disqualifiers: [] }), costUsd: 0 });
    const { scoreLead } = await import('../../../src/core/ai/icpScorer.js');
    const result = await scoreLead(lead, ctx);
    expect(result.icp_score).toBe(100);
  });

  it('preserves disqualifiers array', async () => {
    const { callGemini } = await import('../../../src/core/ai/gemini.js');
    callGemini.mockResolvedValueOnce({
      text: JSON.stringify({ score: 20, breakdown: {}, key_matches: [], key_gaps: [], disqualifiers: ['locked-in 3yr contract'] }),
      costUsd: 0
    });
    const { scoreLead } = await import('../../../src/core/ai/icpScorer.js');
    const result = await scoreLead(lead, ctx);
    expect(result.icp_disqualifiers).toEqual(['locked-in 3yr contract']);
  });

  it('handles Gemini response wrapped in markdown fences', async () => {
    const { callGemini } = await import('../../../src/core/ai/gemini.js');
    callGemini.mockResolvedValueOnce({
      text: '```json\n{"score":50,"breakdown":{},"key_matches":[],"key_gaps":[],"disqualifiers":[]}\n```',
      costUsd: 0
    });
    const { scoreLead } = await import('../../../src/core/ai/icpScorer.js');
    const result = await scoreLead(lead, ctx);
    expect(result.icp_score).toBe(50);
    expect(result.icp_priority).toBe('B');
  });
});
```

- [ ] **Step 2: Run**

```bash
npm test -- core/ai/icpScorer.test.js
```

Expected: all tests PASS (module was implemented in Task 2.2).

### Task 2.5: Commit Chunk 2

- [ ] **Step 1:**

```bash
git add src/core/ai/icpScorer.js tests/core/ai/icpScorer.test.js && git commit -m "feat(scorer): add icpScorer module with 0-100 weighted 6-factor scoring

Pure module with loadScoringContext/scoreLead/bucket/clampInt.
Validates offer.problem and icp_profile.industries before scoring.
Parse-error fallback routes lead to nurture (score=0, C priority).
11 unit tests covering bucket boundaries, JSON robustness, clamping,
and disqualifier preservation.

Not yet wired into findLeads.js — see Chunk 5."
```

---

## Chunk 3: API routes + config validation

**Files:**
- Create: `src/api/routes/offer.js`
- Create: `src/api/routes/icpProfile.js`
- Create: `tests/api/offer.test.js`
- Create: `tests/api/icpProfile.test.js`
- Modify: `src/api/server.js`
- Modify: `src/api/routes/config.js` (add icp_weights validation)

### Task 3.1: Write failing tests for `/api/offer`

- [ ] **Step 1: Create `tests/api/offer.test.js`** — pattern from existing `tests/api/api.test.js`:

```js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let tmpDir, server, baseUrl, token;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'radar-test-'));
  process.env.DB_PATH = join(tmpDir, 'radar.sqlite');
  process.env.DASHBOARD_PASSWORD = 'testpass';
  process.env.JWT_SECRET = 'testsecret64charslongpadded00000000000000000000000000000000000000';
  process.env.JWT_EXPIRES_IN = '7d';
  process.env.NODE_ENV = 'test';
  const { resetDb, initSchema } = await import('../../src/core/db/index.js');
  resetDb();
  initSchema();
  const mod = await import('../../src/api/server.js');
  server = mod.app.listen(0);
  baseUrl = `http://localhost:${server.address().port}`;
  const r = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'testpass' })
  });
  token = (await r.json()).token;
});

afterAll(async () => {
  if (server) server.close();
  const { resetDb } = await import('../../src/core/db/index.js');
  resetDb();
  rmSync(tmpDir, { recursive: true });
});

const authHeaders = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` });

describe('GET/PUT /api/offer', () => {
  it('requires auth', async () => {
    const r = await fetch(`${baseUrl}/api/offer`);
    expect(r.status).toBe(401);
  });

  it('GET returns seeded row with nulls', async () => {
    const r = await fetch(`${baseUrl}/api/offer`, { headers: authHeaders() });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.offer).toBeTruthy();
    expect(body.offer.problem).toBeNull();
    expect(body.offer.use_cases).toEqual([]);
  });

  it('PUT persists offer and GET returns it', async () => {
    const offer = {
      problem: 'outdated websites',
      outcome: '2x conversion',
      category: 'web dev',
      use_cases: ['redesign', 'SEO'],
      triggers: ['Google penalty'],
      alternatives: ['freelancers'],
      differentiation: 'founder-built',
      price_range: '₹40k-2L',
      sales_cycle: '2-6 weeks',
      criticality: 'optional',
      inaction_cost: 'lost leads',
      required_inputs: ['existing hosting access'],
      proof_points: ['case studies']
    };
    const put = await fetch(`${baseUrl}/api/offer`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(offer) });
    expect(put.status).toBe(200);
    const get = await fetch(`${baseUrl}/api/offer`, { headers: authHeaders() });
    const body = await get.json();
    expect(body.offer.problem).toBe('outdated websites');
    expect(body.offer.use_cases).toEqual(['redesign', 'SEO']);
  });

  it('PUT rejects non-array where array expected', async () => {
    const r = await fetch(`${baseUrl}/api/offer`, {
      method: 'PUT', headers: authHeaders(),
      body: JSON.stringify({ problem: 'x', use_cases: 'not-an-array' })
    });
    expect(r.status).toBe(400);
  });

  it('PUT is full replacement, not patch', async () => {
    await fetch(`${baseUrl}/api/offer`, {
      method: 'PUT', headers: authHeaders(),
      body: JSON.stringify({ problem: 'first', use_cases: ['a'], triggers: [], alternatives: [], required_inputs: [], proof_points: [] })
    });
    await fetch(`${baseUrl}/api/offer`, {
      method: 'PUT', headers: authHeaders(),
      body: JSON.stringify({ problem: 'second', use_cases: [], triggers: [], alternatives: [], required_inputs: [], proof_points: [] })
    });
    const r = await fetch(`${baseUrl}/api/offer`, { headers: authHeaders() });
    const body = await r.json();
    expect(body.offer.problem).toBe('second');
    expect(body.offer.use_cases).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — verify fail**

```bash
npm test -- api/offer.test.js
```

Expected: 404 / route not mounted.

### Task 3.2: Implement `/api/offer` route

- [ ] **Step 1: Create `src/api/routes/offer.js`**:

```js
import { Router } from 'express';
import { getDb } from '../../core/db/index.js';

const router = Router();

const ARRAY_FIELDS = ['use_cases', 'triggers', 'alternatives', 'required_inputs', 'proof_points'];
const SCALAR_FIELDS = [
  'problem', 'outcome', 'category', 'differentiation',
  'price_range', 'sales_cycle', 'criticality', 'inaction_cost'
];

function serialize(row) {
  if (!row) return null;
  const out = { ...row };
  for (const f of ARRAY_FIELDS) {
    try { out[f] = out[f] ? JSON.parse(out[f]) : []; }
    catch { out[f] = []; }
  }
  return out;
}

router.get('/', (req, res) => {
  const row = getDb().prepare('SELECT * FROM offer WHERE id = 1').get();
  res.json({ offer: serialize(row) });
});

router.put('/', (req, res) => {
  const body = req.body || {};

  // Validate array fields
  for (const f of ARRAY_FIELDS) {
    if (f in body && !Array.isArray(body[f])) {
      return res.status(400).json({ error: `field ${f} must be an array` });
    }
  }

  const values = {};
  for (const f of SCALAR_FIELDS) values[f] = body[f] ?? null;
  for (const f of ARRAY_FIELDS) values[f] = JSON.stringify(body[f] || []);

  getDb().prepare(`
    UPDATE offer SET
      problem=@problem, outcome=@outcome, category=@category,
      use_cases=@use_cases, triggers=@triggers, alternatives=@alternatives,
      differentiation=@differentiation, price_range=@price_range,
      sales_cycle=@sales_cycle, criticality=@criticality,
      inaction_cost=@inaction_cost, required_inputs=@required_inputs,
      proof_points=@proof_points, updated_at=datetime('now')
    WHERE id = 1
  `).run(values);

  res.json({ ok: true });
});

export default router;
```

- [ ] **Step 2: Mount in `src/api/server.js`** — add after the existing route imports and mounts:

```js
import offerRoutes from './routes/offer.js';
// ...
app.use('/api/offer', offerRoutes);
```

- [ ] **Step 3: Run**

```bash
npm test -- api/offer.test.js
```

Expected: all PASS.

### Task 3.3: Write failing tests + implement `/api/icp-profile`

Mirror of Task 3.1/3.2. Same test shape, different fields.

- [ ] **Step 1: Create `tests/api/icpProfile.test.js`** following the same pattern as `offer.test.js`. Array fields to test: `industries`, `geography`, `stage`, `tech_stack`, `internal_capabilities`, `impacted_kpis`, `initiator_roles`, `decision_roles`, `objections`, `intent_signals`, `current_tools`, `workarounds`, `frustrations`, `switching_barriers`, `hard_disqualifiers`. Scalar fields: `company_size`, `revenue_range`, `budget_range`, `problem_frequency`, `problem_cost`, `buying_process`.

Key tests:
- auth required
- GET returns seeded-empty row
- PUT with `industries: ['x']` persists
- PUT with `industries: 'not-array'` → 400
- PUT full replacement works

- [ ] **Step 2: Run — verify fail**

- [ ] **Step 3: Create `src/api/routes/icpProfile.js`** — identical structure to `offer.js`, with the full field list from §3.1/§3.2 of the spec. Use `ARRAY_FIELDS = [...]` matching the 15 JSON fields and `SCALAR_FIELDS = ['company_size', 'revenue_range', 'budget_range', 'problem_frequency', 'problem_cost', 'buying_process']`.

- [ ] **Step 4: Mount** in `server.js`:

```js
import icpProfileRoutes from './routes/icpProfile.js';
app.use('/api/icp-profile', icpProfileRoutes);
```

- [ ] **Step 5: Run tests**

```bash
npm test -- api/icpProfile.test.js
```

Expected: PASS.

### Task 3.4: Add `icp_weights` sum validation to `/api/config`

- [ ] **Step 1: Add test** to existing `tests/api/api.test.js`:

```js
it('PUT /api/config rejects icp_weights that do not sum to 100', async () => {
  const r = await fetch(`${baseUrl}/api/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ icp_weights: JSON.stringify({ firmographic: 50, problem: 20, intent: 15, tech: 15, economic: 15, buying: 15 }) })
  });
  expect(r.status).toBe(400);
});

it('PUT /api/config accepts valid icp_weights summing to 100', async () => {
  const r = await fetch(`${baseUrl}/api/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ icp_weights: JSON.stringify({ firmographic: 20, problem: 20, intent: 15, tech: 15, economic: 15, buying: 15 }) })
  });
  expect(r.status).toBe(200);
});
```

- [ ] **Step 2: Run — verify fail**

- [ ] **Step 3: Update `src/api/routes/config.js`** PUT handler:

```js
router.put('/', (req, res) => {
  const updates = req.body || {};

  // Validate icp_weights JSON structure if provided
  if ('icp_weights' in updates) {
    let parsed;
    try { parsed = JSON.parse(updates.icp_weights); }
    catch { return res.status(400).json({ error: 'icp_weights must be valid JSON' }); }
    const expected = ['firmographic', 'problem', 'intent', 'tech', 'economic', 'buying'];
    if (!expected.every(k => typeof parsed[k] === 'number')) {
      return res.status(400).json({ error: `icp_weights must contain numeric keys: ${expected.join(', ')}` });
    }
    const sum = expected.reduce((a, k) => a + parsed[k], 0);
    if (sum !== 100) {
      return res.status(400).json({ error: `icp_weights values must sum to 100 (got ${sum})` });
    }
  }

  const stmt = getDb().prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(updates)) {
    stmt.run(key, String(value));
  }
  res.json({ ok: true });
});
```

- [ ] **Step 4: Run**

```bash
npm test -- api/api.test.js
```

Expected: PASS.

### Task 3.5: Run full suite + commit Chunk 3

- [ ] **Step 1:**

```bash
npm test 2>&1 | tail -15
```

Expected: no regressions.

- [ ] **Step 2:**

```bash
git add src/api/routes/offer.js src/api/routes/icpProfile.js src/api/routes/config.js src/api/server.js tests/api/offer.test.js tests/api/icpProfile.test.js tests/api/api.test.js && git commit -m "feat(api): add /api/offer and /api/icp-profile routes + icp_weights validation

Both routes follow the singleton pattern: GET returns the single row
with JSON array fields parsed; PUT does full replacement with
array-field validation. icp_weights values must sum to 100."
```

---

## Chunk 4: Dashboard edit pages

**Files:**
- Create: `web/src/pages/Offer.jsx`
- Create: `web/src/pages/IcpProfile.jsx`
- Modify: `web/src/App.jsx` (nav)
- Create or reuse: `web/src/components/ChipInput.jsx` (if no existing tag/chip input component found)

**Testing note:** No automated tests at this layer (repo has no Playwright/Vitest for React). Manual verification = start `npm run dev` in `web/`, login, visit Offer + ICP Profile pages, save, verify via `GET /api/offer` and `GET /api/icp-profile`.

### Task 4.1: Check for existing chip-input pattern

- [ ] **Step 1:**

```bash
grep -rn "tag\|chip\|Array.*map.*input\|addTag" /Users/drprockz/Projects/Outreach/web/src/components/ 2>/dev/null | head -20
grep -rn "tag\|chip" /Users/drprockz/Projects/Outreach/web/src/pages/EngineConfig.jsx 2>/dev/null | head -10
```

- [ ] **Step 2:** If a reusable chip/tag input exists, note its path. If not, create a minimal one at `web/src/components/ChipInput.jsx`:

```jsx
import { useState } from 'react';

export default function ChipInput({ value = [], onChange, placeholder = 'Add item...' }) {
  const [draft, setDraft] = useState('');

  function addChip() {
    const v = draft.trim();
    if (!v) return;
    if (value.includes(v)) { setDraft(''); return; }
    onChange([...value, v]);
    setDraft('');
  }

  function removeChip(idx) {
    onChange(value.filter((_, i) => i !== idx));
  }

  return (
    <div className="chip-input">
      <div className="chips">
        {value.map((chip, i) => (
          <span className="chip" key={i}>
            {chip}
            <button type="button" onClick={() => removeChip(i)} aria-label={`Remove ${chip}`}>×</button>
          </span>
        ))}
      </div>
      <input
        type="text"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addChip(); } }}
        placeholder={placeholder}
      />
      <button type="button" onClick={addChip}>Add</button>
    </div>
  );
}
```

Add minimal CSS to `web/src/index.css`:

```css
.chip-input { display: flex; flex-direction: column; gap: 6px; }
.chip-input .chips { display: flex; flex-wrap: wrap; gap: 4px; }
.chip-input .chip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 999px; background: var(--bg-muted); font-size: 0.85em; }
.chip-input .chip button { background: none; border: none; cursor: pointer; color: var(--text-muted); }
```

### Task 4.2: Create `Offer.jsx` page

- [ ] **Step 1: Create `web/src/pages/Offer.jsx`**:

```jsx
import { useState, useEffect } from 'react';
import { api } from '../api';
import ChipInput from '../components/ChipInput';

const EMPTY = {
  problem: '', outcome: '', category: '', differentiation: '',
  price_range: '', sales_cycle: '', criticality: '', inaction_cost: '',
  use_cases: [], triggers: [], alternatives: [], required_inputs: [], proof_points: []
};

export default function Offer() {
  const [offer, setOffer] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api.get('/api/offer').then(r => {
      setOffer({ ...EMPTY, ...(r.offer || {}) });
    });
  }, []);

  const set = (k) => (v) => setOffer(o => ({ ...o, [k]: v }));
  const setText = (k) => (e) => set(k)(e.target.value);

  async function save() {
    setSaving(true);
    setMsg('');
    try {
      await api.put('/api/offer', offer);
      setMsg('Saved.');
    } catch (e) {
      setMsg(`Error: ${e.message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page offer-page">
      <h2>Offer</h2>
      <p className="muted">What you sell. Feeds the ICP scorer as the OFFER record.</p>

      <section>
        <h3>What</h3>
        <label>Problem<textarea value={offer.problem} onChange={setText('problem')} rows={2} /></label>
        <label>Outcome<textarea value={offer.outcome} onChange={setText('outcome')} rows={2} /></label>
        <label>Category<input value={offer.category} onChange={setText('category')} /></label>
        <label>Differentiation<textarea value={offer.differentiation} onChange={setText('differentiation')} rows={2} /></label>
      </section>

      <section>
        <h3>Who benefits</h3>
        <label>Use cases<ChipInput value={offer.use_cases} onChange={set('use_cases')} placeholder="e.g. redesign" /></label>
        <label>Triggers<ChipInput value={offer.triggers} onChange={set('triggers')} placeholder="e.g. Google penalty" /></label>
      </section>

      <section>
        <h3>Commercial</h3>
        <label>Price range<input value={offer.price_range} onChange={setText('price_range')} placeholder="₹40k-2L" /></label>
        <label>Sales cycle<input value={offer.sales_cycle} onChange={setText('sales_cycle')} placeholder="2-6 weeks" /></label>
        <label>Criticality
          <select value={offer.criticality} onChange={setText('criticality')}>
            <option value="">—</option>
            <option value="mission-critical">mission-critical</option>
            <option value="optional">optional</option>
          </select>
        </label>
        <label>Inaction cost<textarea value={offer.inaction_cost} onChange={setText('inaction_cost')} rows={2} /></label>
        <label>Alternatives<ChipInput value={offer.alternatives} onChange={set('alternatives')} placeholder="e.g. freelancers" /></label>
      </section>

      <section>
        <h3>Proof</h3>
        <label>Required inputs<ChipInput value={offer.required_inputs} onChange={set('required_inputs')} placeholder="e.g. hosting access" /></label>
        <label>Proof points<ChipInput value={offer.proof_points} onChange={set('proof_points')} placeholder="e.g. case study" /></label>
      </section>

      <div className="save-bar">
        <button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        {msg && <span className="msg">{msg}</span>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Check `web/src/api.js`** — confirm `api.get(path)` and `api.put(path, body)` work as assumed. Adjust calls if API wrapper differs.

### Task 4.3: Create `IcpProfile.jsx` page

- [ ] **Step 1: Create `web/src/pages/IcpProfile.jsx`** — same structure as `Offer.jsx`, with 21 fields grouped per spec §5.3:

- Company fit: `industries` (chip), `company_size`, `revenue_range`, `geography` (chip), `stage` (chip), `tech_stack` (chip), `internal_capabilities` (chip), `budget_range`
- Problem intensity: `problem_frequency`, `problem_cost`, `impacted_kpis` (chip)
- Buying behavior: `initiator_roles` (chip), `decision_roles` (chip), `objections` (chip), `buying_process`, `intent_signals` (chip)
- Current solutions: `current_tools` (chip), `workarounds` (chip), `frustrations` (chip), `switching_barriers` (chip)
- Hard disqualifiers: `hard_disqualifiers` (chip)

Fetches/saves via `/api/icp-profile`.

### Task 4.4: Wire new pages in App.jsx nav

- [ ] **Step 1: Edit `web/src/App.jsx`** — find the nav/routes block (imports + `<Route>` entries). Import and register the two new pages, replacing the `ICP Rules` entry:

```jsx
import Offer from './pages/Offer';
import IcpProfile from './pages/IcpProfile';
// ...
<Route path="/offer" element={<Offer />} />
<Route path="/icp-profile" element={<IcpProfile />} />
// Remove: <Route path="/icp-rules" .../> if present
```

And in nav link list:

```jsx
<NavLink to="/offer">Offer</NavLink>
<NavLink to="/icp-profile">ICP Profile</NavLink>
// Remove: <NavLink to="/icp-rules">ICP Rules</NavLink>
```

### Task 4.5: Manual browser verification

- [ ] **Step 1: Start API + web dev servers:**

```bash
# terminal 1 — API (with test DB path to avoid prod DB mutation)
DB_PATH=./db/radar-dev.sqlite node src/api/server.js

# terminal 2 — Vite dev
cd web && npm run dev
```

- [ ] **Step 2: In browser, visit `http://localhost:5173`**. Log in. Navigate to `/offer`. Fill all fields, click Save. Expect "Saved." message.

- [ ] **Step 3: Verify persistence:**

```bash
sqlite3 db/radar-dev.sqlite 'SELECT problem, use_cases FROM offer WHERE id=1;'
```

Expect the problem text + JSON array of use_cases.

- [ ] **Step 4: Navigate to `/icp-profile`.** Fill `industries` (add at least one chip), save. Verify:

```bash
sqlite3 db/radar-dev.sqlite 'SELECT industries FROM icp_profile WHERE id=1;'
```

- [ ] **Step 5: Stop both servers.** Delete `db/radar-dev.sqlite`.

### Task 4.6: Build check + commit

- [ ] **Step 1:**

```bash
cd web && npm run build
```

Expect clean build with no errors.

- [ ] **Step 2:**

```bash
cd /Users/drprockz/Projects/Outreach && git add web/ && git commit -m "feat(dashboard): add Offer and ICP Profile edit pages

Replaces the old ICP Rules page with two structured forms:
- Offer: 13 fields (problem, outcome, category, triggers, pricing, proof)
- ICP Profile: 21 fields (industries, sizes, intent, objections, disqualifiers)

Uses a reusable ChipInput component for JSON-array fields.
Both pages PUT the entire record on save (full replacement semantics)."
```

---

## Chunk 5: findLeads.js refactor

**Files:**
- Modify: `src/engines/findLeads.js`
- Modify: `tests/engines/findLeads.test.js`
- Modify: `tests/engines/findLeads.unit.test.js` (if affected)
- Create: `tests/engines/insertLead.test.js`

### Task 5.1: Write failing test — `insertLead` helper (ready path)

- [ ] **Step 1: Create `tests/engines/insertLead.test.js`**:

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let tmpDir;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'radar-test-'));
  process.env.DB_PATH = join(tmpDir, 'radar.sqlite');
  const { resetDb, initSchema } = await import('../../src/core/db/index.js');
  resetDb();
  initSchema();
});

afterEach(async () => {
  const { resetDb } = await import('../../src/core/db/index.js');
  resetDb();
  rmSync(tmpDir, { recursive: true });
});

const baseLead = {
  business_name: 'Acme', website_url: 'https://x.com', category: 'restaurant', city: 'Mumbai',
  tech_stack: ['WordPress'], website_problems: ['no SSL'],
  last_updated: '2022', has_ssl: 0, has_analytics: 0,
  owner_name: 'John', owner_role: 'Founder',
  business_signals: ['low reviews'], social_active: 1,
  website_quality_score: 4, judge_reason: 'outdated',
  contact_email: 'j@x.com', contact_confidence: 'medium', contact_source: 'guess',
  email_status: 'valid',
  employees_estimate: '1-10', business_stage: 'owner-operated',
  icp_score: 75, icp_priority: 'A', icp_reason: 'good fit',
  icp_breakdown: { firmographic: 18, problem: 17, intent: 10, tech: 12, economic: 10, buying: 8 },
  icp_key_matches: ['restaurant match'],
  icp_key_gaps: ['budget unknown'],
  icp_disqualifiers: [],
  extractCost: 0.001, icpCost: 0.001,
};

describe('insertLead', () => {
  it('status=ready inserts all columns and sets email_verified_at', async () => {
    const { insertLead } = await import('../../src/engines/findLeads.js');
    const { getDb } = await import('../../src/core/db/index.js');
    const db = getDb();
    insertLead(db, baseLead, { query: 'q' }, 'ready');
    const row = db.prepare('SELECT * FROM leads').get();
    expect(row.status).toBe('ready');
    expect(row.icp_score).toBe(75);
    expect(row.email_verified_at).not.toBeNull();
    expect(JSON.parse(row.icp_breakdown).firmographic).toBe(18);
  });

  it('status=nurture leaves email_verified_at NULL', async () => {
    const { insertLead } = await import('../../src/engines/findLeads.js');
    const { getDb } = await import('../../src/core/db/index.js');
    const db = getDb();
    insertLead(db, { ...baseLead, icp_priority: 'C', icp_score: 20 }, { query: 'q' }, 'nurture');
    const row = db.prepare('SELECT * FROM leads').get();
    expect(row.status).toBe('nurture');
    expect(row.email_verified_at).toBeNull();
  });

  it('status=disqualified stores disqualifiers JSON', async () => {
    const { insertLead } = await import('../../src/engines/findLeads.js');
    const { getDb } = await import('../../src/core/db/index.js');
    const db = getDb();
    const lead = { ...baseLead, icp_disqualifiers: ['locked-in contract'] };
    insertLead(db, lead, { query: 'q' }, 'disqualified');
    const row = db.prepare('SELECT * FROM leads').get();
    expect(row.status).toBe('disqualified');
    expect(JSON.parse(row.icp_disqualifiers)).toEqual(['locked-in contract']);
    expect(row.email_verified_at).toBeNull();
  });

  it('defaults missing optional fields to safe values', async () => {
    const { insertLead } = await import('../../src/engines/findLeads.js');
    const { getDb } = await import('../../src/core/db/index.js');
    const db = getDb();
    const minimal = { ...baseLead };
    delete minimal.employees_estimate;
    delete minimal.business_stage;
    insertLead(db, minimal, { query: 'q' }, 'nurture');
    const row = db.prepare('SELECT * FROM leads').get();
    expect(row.employees_estimate).toBe('unknown');
    expect(row.business_stage).toBe('unknown');
  });
});
```

- [ ] **Step 2: Run — verify fail** (insertLead not exported yet):

```bash
npm test -- engines/insertLead.test.js
```

### Task 5.2: Implement `insertLead` helper and export it

- [ ] **Step 1: Edit `src/engines/findLeads.js`** — add after the existing helper functions (after `buildIcpRubric`, before `stage1_discover`):

```js
// Exported for unit testing
export function insertLead(db, lead, niche, status) {
  return db.prepare(`
    INSERT INTO leads (
      business_name, website_url, category, city, country, search_query,
      tech_stack, website_problems, last_updated, has_ssl, has_analytics,
      owner_name, owner_role, business_signals, social_active,
      website_quality_score, judge_reason,
      contact_name, contact_email, contact_confidence, contact_source,
      email_status, email_verified_at,
      employees_estimate, business_stage,
      icp_score, icp_priority, icp_reason,
      icp_breakdown, icp_key_matches, icp_key_gaps, icp_disqualifiers,
      status, gemini_cost_usd, discovery_model, extraction_model
    ) VALUES (?, ?, ?, ?, 'IN', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
              CASE WHEN ? = 'ready' THEN datetime('now') ELSE NULL END,
              ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'gemini-2.5-flash', 'gemini-2.5-flash')
  `).run(
    lead.business_name, lead.website_url, lead.category, lead.city, niche.query,
    JSON.stringify(lead.tech_stack || []), JSON.stringify(lead.website_problems || []),
    lead.last_updated, lead.has_ssl, lead.has_analytics,
    lead.owner_name, lead.owner_role,
    JSON.stringify(lead.business_signals || []), lead.social_active,
    lead.website_quality_score, lead.judge_reason,
    lead.owner_name, lead.contact_email, lead.contact_confidence, lead.contact_source,
    lead.email_status, status,
    lead.employees_estimate || 'unknown', lead.business_stage || 'unknown',
    lead.icp_score, lead.icp_priority, lead.icp_reason,
    JSON.stringify(lead.icp_breakdown || null),
    JSON.stringify(lead.icp_key_matches || []),
    JSON.stringify(lead.icp_key_gaps || []),
    JSON.stringify(lead.icp_disqualifiers || []),
    status,
    (lead.extractCost || 0) + (lead.icpCost || 0)
  );
}
```

- [ ] **Step 2: Run**

```bash
npm test -- engines/insertLead.test.js
```

Expected: all 4 tests PASS.

### Task 5.3: Extend `stages2to6_extract` prompt for new fields

- [ ] **Step 1: Edit `src/engines/findLeads.js`** `stages2to6_extract` prompt (currently at lines 58-84). Add two fields to the JSON contract:

```
- employees_estimate: "1-10" | "10-50" | "50-200" | "unknown" (string). Use team/about page clues.
- business_stage: "owner-operated" | "growing" | "established" | "unknown" (string).
```

Add them to the field list in the prompt. Leave the `return { data: JSON.parse(...) }` structure unchanged — the two new fields will flow through naturally.

- [ ] **Step 2: Update existing `findLeads.test.js` mock** (around line 22-44) — add the two fields to the mocked extraction response:

```js
employees_estimate: '1-10',
business_stage: 'owner-operated',
```

- [ ] **Step 3: Run findLeads tests — expect no regression**

```bash
npm test -- engines/findLeads.test.js
```

### Task 5.4: Swap `stage9_icpScore` → `scoreLead`, rewrite Gate 3

- [ ] **Step 1: Edit `src/engines/findLeads.js`** — add imports at top:

```js
import { loadScoringContext, scoreLead } from '../core/ai/icpScorer.js';
```

- [ ] **Step 2: Delete** the old `stage9_icpScore` function (currently at lines 86-110) and `buildIcpRubric` (lines 16-19). Also delete the old `rubric`/`threshA`/`threshB` computation in the main pipeline where it prepares the old prompt (approx lines 204-206).

- [ ] **Step 3: At the top of the `findLeads()` try block** (after `const db = getDb()`), add:

```js
const threshA   = getConfigInt(cfg, 'icp_threshold_a', 70);
const threshB   = getConfigInt(cfg, 'icp_threshold_b', 40);
let icpWeights;
try {
  icpWeights = JSON.parse(getConfigStr(cfg, 'icp_weights', '{}'));
} catch {
  icpWeights = { firmographic: 20, problem: 20, intent: 15, tech: 15, economic: 15, buying: 15 };
}
const scoringCtx = loadScoringContext(db);
scoringCtx.weights = icpWeights;
scoringCtx.threshA = threshA;
scoringCtx.threshB = threshB;
```

This line throws if offer/icp_profile are unconfigured — caught by the outer try/catch which calls `logError` + `sendAlert` + `finishCron(failed)`.

- [ ] **Step 4: Replace** the `Stage 9: ICP scoring` worker (currently at lines 349-395) with:

```js
const scoredLeads = await withConcurrency(gate2Passed, 20, async (lead) => {
  try {
    const icp = await scoreLead(lead, scoringCtx);
    totalCost += icp.costUsd;
    bumpMetric('gemini_cost_usd', icp.costUsd);
    bumpMetric('total_api_cost_usd', icp.costUsd);

    Object.assign(lead, icp, { icpCost: icp.costUsd });

    // Hard disqualifiers override score
    if (icp.icp_disqualifiers.length > 0) {
      insertLead(db, lead, niche, 'disqualified');
      bumpMetric('leads_disqualified');
      leadsSkipped++;
      return null;
    }

    // C-priority → nurture
    if (icp.icp_priority === 'C') {
      insertLead(db, lead, niche, 'nurture');
      leadsSkipped++;
      return null;
    }

    bumpMetric('leads_icp_ab');
    return lead;
  } catch (err) {
    logError('findLeads.lead', err, { jobName: 'findLeads' });
    leadsSkipped++;
    return null;
  }
});
const abLeads = scoredLeads.filter(Boolean);
```

- [ ] **Step 5: Update the "ready" insert block** (currently at lines 439-461) to use `insertLead(db, lead, niche, 'ready')` instead of the inline INSERT. Keep the `emails` INSERT inline. Result:

```js
const leadInsert = insertLead(db, lead, niche, 'ready');
const leadId = leadInsert.lastInsertRowid;
// emails INSERT unchanged
db.prepare(`INSERT INTO emails (...) VALUES (...)`).run(...);
```

### Task 5.5: Update existing findLeads tests for 0–100 scale + disqualifier path

- [ ] **Step 1: Update mock in `tests/engines/findLeads.test.js`** — the Gemini mock for ICP scoring (currently returns `{icp_score: 7, icp_priority: 'A'}`) needs to return the new shape:

```js
if (prompt.includes('You are an ICP scoring engine')) {
  return {
    text: JSON.stringify({
      score: 75,
      breakdown: { firmographic: 18, problem: 17, intent: 10, tech: 12, economic: 10, buying: 8 },
      key_matches: ['industry match', 'geo match'],
      key_gaps: [],
      disqualifiers: []
    }),
    costUsd: 0.001,
  };
}
```

Remove the old `prompt.includes('Score this lead')` branch — it won't be hit.

- [ ] **Step 2: Seed `offer` + `icp_profile` rows** in `beforeEach`:

```js
const { getDb } = await import('../../src/core/db/index.js');
getDb().prepare(`UPDATE offer SET problem='outdated sites' WHERE id=1`).run();
getDb().prepare(`UPDATE icp_profile SET industries=? WHERE id=1`).run(JSON.stringify(['restaurants','salons']));
```

Without this, `loadScoringContext` throws and `findLeads()` fails.

- [ ] **Step 3: Update existing tests with hardcoded `icp_score` values**:

Find the C-priority test (currently uses `{icp_score: 2, icp_priority: 'C'}` around line 159). Change to:

```js
text: JSON.stringify({
  score: 20,
  breakdown: {},
  key_matches: [],
  key_gaps: ['low quality'],
  disqualifiers: []
}),
```

And adjust assertions on `icp_score` value (2 → 20, 7 → 75, etc.).

- [ ] **Step 4: Add new test — disqualifier path**:

```js
it('inserts lead with status=disqualified when scorer emits disqualifiers', async () => {
  // Override default mock for this test
  const { callGemini } = await import('../../src/core/ai/gemini.js');
  let callCount = 0;
  callGemini.mockImplementation(async (prompt) => {
    callCount++;
    if (prompt.toLowerCase().includes('discover')) {
      return { text: JSON.stringify([{ business_name: 'X', website_url: 'https://x.com', city: 'Mumbai', category: 'restaurant' }]), costUsd: 0, inputTokens: 0, outputTokens: 0 };
    }
    if (prompt.includes('Analyze this business')) {
      return { text: JSON.stringify({ owner_name: 'J', owner_role: 'F', contact_email: 'j@x.com', contact_confidence: 'medium', contact_source: 'guess', tech_stack: ['WP'], website_problems: [], last_updated: '2022', has_ssl: 1, has_analytics: 0, business_signals: [], social_active: 0, website_quality_score: 4, judge_reason: 'ok', employees_estimate: '1-10', business_stage: 'owner-operated' }), costUsd: 0, inputTokens: 0, outputTokens: 0 };
    }
    if (prompt.includes('ICP scoring engine')) {
      return { text: JSON.stringify({ score: 80, breakdown: {}, key_matches: [], key_gaps: [], disqualifiers: ['locked-in 3yr contract'] }), costUsd: 0, inputTokens: 0, outputTokens: 0 };
    }
    return { text: '{}', costUsd: 0, inputTokens: 0, outputTokens: 0 };
  });

  const { default: findLeads } = await import('../../src/engines/findLeads.js');
  await findLeads();

  const { getDb } = await import('../../src/core/db/index.js');
  const disqualified = getDb().prepare(`SELECT * FROM leads WHERE status='disqualified'`).all();
  expect(disqualified.length).toBeGreaterThanOrEqual(1);
  expect(JSON.parse(disqualified[0].icp_disqualifiers)).toContain('locked-in 3yr contract');
  const ready = getDb().prepare(`SELECT * FROM leads WHERE status='ready'`).all();
  expect(ready.length).toBe(0);  // hook/body stages should not have run
});
```

- [ ] **Step 5: Add test — fails fast if offer unconfigured**:

```js
it('fails fast when offer.problem is empty', async () => {
  const { resetDb, initSchema, getDb } = await import('../../src/core/db/index.js');
  resetDb();
  initSchema();
  // deliberately do NOT seed offer.problem
  getDb().prepare(`INSERT OR REPLACE INTO config (key, value) VALUES ('find_leads_enabled','1')`).run();

  const { default: findLeads } = await import('../../src/engines/findLeads.js');
  await findLeads();  // must not throw (caught internally)

  const row = getDb().prepare(`SELECT * FROM cron_log ORDER BY id DESC LIMIT 1`).get();
  expect(row.status).toBe('failed');
  expect(row.error).toMatch(/offer\.problem/);
});
```

- [ ] **Step 6: Update `tests/engines/sendFollowups.test.js:43`** and `tests/engines/sendEmails.test.js` (3 places) to rescale seed `icp_score` values: 5 → 50, 7 → 70, etc.

- [ ] **Step 7: Run full engines test suite**

```bash
npm test -- engines/
```

Expected: all pass.

### Task 5.6: Run full suite + commit Chunk 5

- [ ] **Step 1:**

```bash
npm test 2>&1 | tail -15
```

- [ ] **Step 2:**

```bash
git add src/engines/findLeads.js tests/engines/ && git commit -m "feat(findLeads): replace stage9_icpScore with structured scorer

- Import loadScoringContext/scoreLead from core/ai/icpScorer
- Extract insertLead helper (tri-status: ready/nurture/disqualified)
- Extend extraction prompt to emit employees_estimate + business_stage
- Gate 3 rewrite: disqualifiers override score → status=disqualified
- Fail fast with Telegram alert if offer/icp_profile unconfigured
- Legacy buildIcpRubric removed
- 0-100 score scale throughout; A/B/C derived from configurable thresholds

Pairs with Chunk 7 (dashboard visualization) for atomic prod rollout."
```

---

## Chunk 6: rescoreLeads script

**Files:**
- Create: `scripts/rescoreLeads.js`
- Create: `tests/scripts/rescoreLeads.test.js`
- Modify: `src/api/routes/icpRules.js` (kept intact; verify)

### Task 6.1: Write failing tests for rescore script

- [ ] **Step 1: Create `tests/scripts/rescoreLeads.test.js`**:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

vi.mock('../../src/core/ai/gemini.js', () => ({
  callGemini: vi.fn(async () => ({
    text: JSON.stringify({
      score: 75,
      breakdown: { firmographic: 18, problem: 17, intent: 10, tech: 12, economic: 10, buying: 8 },
      key_matches: [],
      key_gaps: [],
      disqualifiers: []
    }),
    costUsd: 0.001,
  }))
}));

let tmpDir;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'radar-test-'));
  process.env.DB_PATH = join(tmpDir, 'radar.sqlite');
  const { resetDb, initSchema, getDb } = await import('../../src/core/db/index.js');
  resetDb();
  initSchema();
  // Seed minimally valid offer + icp_profile
  getDb().prepare(`UPDATE offer SET problem='x' WHERE id=1`).run();
  getDb().prepare(`UPDATE icp_profile SET industries=? WHERE id=1`).run(JSON.stringify(['r']));
});

afterEach(async () => {
  const { resetDb } = await import('../../src/core/db/index.js');
  resetDb();
  rmSync(tmpDir, { recursive: true });
});

describe('rescoreLeads', () => {
  it('updates all scoreable leads with 0-100 scores', async () => {
    const { getDb } = await import('../../src/core/db/index.js');
    const db = getDb();
    db.prepare(`INSERT INTO leads (business_name, website_url, category, city, contact_email, icp_score, icp_priority, status) VALUES (?,?,?,?,?,?,?,?)`)
      .run('A', 'https://a.com', 'restaurant', 'Mumbai', 'a@a.com', 7, 'A', 'sent');
    db.prepare(`INSERT INTO leads (business_name, website_url, category, city, contact_email, icp_score, icp_priority, status) VALUES (?,?,?,?,?,?,?,?)`)
      .run('B', 'https://b.com', 'restaurant', 'Mumbai', 'b@b.com', 5, 'B', 'nurture');

    const { default: rescore } = await import('../../scripts/rescoreLeads.js');
    await rescore({ legacy: false });

    const rows = db.prepare(`SELECT business_name, icp_score, icp_priority FROM leads ORDER BY id`).all();
    expect(rows[0].icp_score).toBe(75);
    expect(rows[0].icp_priority).toBe('A');
    expect(rows[1].icp_score).toBe(75);
  });

  it('exits with error if offer.problem is empty', async () => {
    const { getDb } = await import('../../src/core/db/index.js');
    const db = getDb();
    db.prepare(`UPDATE offer SET problem=NULL WHERE id=1`).run();
    const { default: rescore } = await import('../../scripts/rescoreLeads.js');
    await expect(rescore({ legacy: false })).rejects.toThrow(/offer\.problem/);
  });

  it('moves ready leads with disqualifiers to disqualified and deletes pending emails', async () => {
    const { callGemini } = await import('../../src/core/ai/gemini.js');
    callGemini.mockResolvedValueOnce({
      text: JSON.stringify({ score: 80, breakdown: {}, key_matches: [], key_gaps: [], disqualifiers: ['DQ1'] }),
      costUsd: 0.001,
    });
    const { getDb } = await import('../../src/core/db/index.js');
    const db = getDb();
    const info = db.prepare(`INSERT INTO leads (business_name, website_url, category, city, contact_email, icp_score, icp_priority, status) VALUES (?,?,?,?,?,?,?,?)`)
      .run('A', 'https://a.com', 'restaurant', 'Mumbai', 'a@a.com', 7, 'A', 'ready');
    db.prepare(`INSERT INTO emails (lead_id, sequence_step, subject, body, status) VALUES (?, 0, ?, ?, 'pending')`)
      .run(info.lastInsertRowid, 'hi', 'body');

    const { default: rescore } = await import('../../scripts/rescoreLeads.js');
    await rescore({ legacy: false });

    const lead = db.prepare(`SELECT * FROM leads WHERE id=?`).get(info.lastInsertRowid);
    expect(lead.status).toBe('disqualified');
    const pending = db.prepare(`SELECT * FROM emails WHERE lead_id=? AND status='pending'`).all(info.lastInsertRowid);
    expect(pending.length).toBe(0);
  });

  it('preserves status for sent/replied/nurture leads even with disqualifiers', async () => {
    const { callGemini } = await import('../../src/core/ai/gemini.js');
    callGemini.mockImplementation(async () => ({
      text: JSON.stringify({ score: 80, breakdown: {}, key_matches: [], key_gaps: [], disqualifiers: ['DQ1'] }),
      costUsd: 0.001,
    }));
    const { getDb } = await import('../../src/core/db/index.js');
    const db = getDb();
    db.prepare(`INSERT INTO leads (business_name, website_url, category, city, contact_email, status) VALUES (?,?,?,?,?,?)`)
      .run('S', 'https://s.com', 'r', 'M', 's@s.com', 'sent');
    db.prepare(`INSERT INTO leads (business_name, website_url, category, city, contact_email, status) VALUES (?,?,?,?,?,?)`)
      .run('N', 'https://n.com', 'r', 'M', 'n@n.com', 'nurture');

    const { default: rescore } = await import('../../scripts/rescoreLeads.js');
    await rescore({ legacy: false });

    const statuses = db.prepare(`SELECT business_name, status FROM leads ORDER BY business_name`).all();
    expect(statuses.find(s => s.business_name === 'S').status).toBe('sent');
    expect(statuses.find(s => s.business_name === 'N').status).toBe('nurture');
  });
});
```

- [ ] **Step 2: Run — verify fail**

```bash
npm test -- scripts/rescoreLeads.test.js
```

### Task 6.2: Implement `scripts/rescoreLeads.js`

- [ ] **Step 1: Create `scripts/rescoreLeads.js`**:

```js
import 'dotenv/config';
import { getDb, getConfigMap, getConfigInt, getConfigStr } from '../src/core/db/index.js';
import { loadScoringContext, scoreLead } from '../src/core/ai/icpScorer.js';

const DEFAULT_WEIGHTS = { firmographic: 20, problem: 20, intent: 15, tech: 15, economic: 15, buying: 15 };
const SCOREABLE_STATUSES = ['ready', 'sent', 'replied', 'nurture', 'bounced', 'unsubscribed'];

export default async function rescoreLeads({ legacy = false } = {}) {
  if (legacy) {
    return rescoreLegacy();
  }

  const db = getDb();
  const cfg = getConfigMap();
  const scoringCtx = loadScoringContext(db);
  scoringCtx.weights = (() => {
    try { return JSON.parse(getConfigStr(cfg, 'icp_weights', JSON.stringify(DEFAULT_WEIGHTS))); }
    catch { return DEFAULT_WEIGHTS; }
  })();
  scoringCtx.threshA = getConfigInt(cfg, 'icp_threshold_a', 70);
  scoringCtx.threshB = getConfigInt(cfg, 'icp_threshold_b', 40);

  const placeholders = SCOREABLE_STATUSES.map(() => '?').join(',');
  const leads = db.prepare(
    `SELECT * FROM leads WHERE status IN (${placeholders}) ORDER BY id`
  ).all(...SCOREABLE_STATUSES);

  const stats = { total: leads.length, A: 0, B: 0, C: 0, disqualified: 0, ready_to_dq: 0, cost: 0 };
  const updateStmt = db.prepare(`
    UPDATE leads SET
      icp_score=?, icp_priority=?, icp_reason=?,
      icp_breakdown=?, icp_key_matches=?, icp_key_gaps=?, icp_disqualifiers=?
    WHERE id=?
  `);
  const statusUpdate = db.prepare(`UPDATE leads SET status='disqualified' WHERE id=?`);
  const deletePending = db.prepare(`DELETE FROM emails WHERE lead_id=? AND status='pending'`);

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];
    // Parse JSON fields that scoreLead expects as arrays
    try { lead.tech_stack = JSON.parse(lead.tech_stack || '[]'); } catch { lead.tech_stack = []; }
    try { lead.website_problems = JSON.parse(lead.website_problems || '[]'); } catch { lead.website_problems = []; }
    try { lead.business_signals = JSON.parse(lead.business_signals || '[]'); } catch { lead.business_signals = []; }

    const icp = await scoreLead(lead, scoringCtx);
    stats.cost += icp.costUsd;

    updateStmt.run(
      icp.icp_score, icp.icp_priority, icp.icp_reason,
      JSON.stringify(icp.icp_breakdown || null),
      JSON.stringify(icp.icp_key_matches || []),
      JSON.stringify(icp.icp_key_gaps || []),
      JSON.stringify(icp.icp_disqualifiers || []),
      lead.id
    );

    stats[icp.icp_priority]++;

    // ready leads with disqualifiers → move to 'disqualified' + delete pending emails
    if (icp.icp_disqualifiers.length > 0) {
      stats.disqualified++;
      if (lead.status === 'ready') {
        statusUpdate.run(lead.id);
        deletePending.run(lead.id);
        stats.ready_to_dq++;
      }
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
  // Rollback helper: re-runs the OLD rubric-based scorer against icp_rules
  // to restore 0-10 scores. Kept here so that `--legacy` rollback is one command.
  const { callGemini } = await import('../src/core/ai/gemini.js');
  const db = getDb();

  const rules = db.prepare('SELECT * FROM icp_rules WHERE enabled=1 ORDER BY sort_order').all();
  if (rules.length === 0) throw new Error('legacy rescore requires icp_rules rows');
  const rubric = rules.map(r => `${r.points > 0 ? '+' : ''}${r.points}  ${r.label}`).join('\n');
  const threshA = 7;
  const threshB = 4;

  const placeholders = SCOREABLE_STATUSES.map(() => '?').join(',');
  const leads = db.prepare(`SELECT * FROM leads WHERE status IN (${placeholders})`).all(...SCOREABLE_STATUSES);

  const stmt = db.prepare(`UPDATE leads SET icp_score=?, icp_priority=?, icp_reason=? WHERE id=?`);
  let cost = 0;
  for (const lead of leads) {
    const prompt = `Score this lead on the ICP rubric and return JSON {icp_score: number, icp_priority: "A"|"B"|"C", icp_reason: "brief explanation"}.

Rubric:
${rubric}

Priority: A=${threshA}-10, B=${threshB}-${threshA - 1}, C=below ${threshB} (including negative)

Lead data:
Company: ${lead.business_name}
Tech stack: ${lead.tech_stack || 'unknown'}
Business signals: ${lead.business_signals || 'none'}
City: ${lead.city}
Category: ${lead.category}
Quality score: ${lead.website_quality_score}

Return only valid JSON.`;
    const result = await callGemini(prompt);
    cost += result.costUsd;
    let parsed;
    try {
      parsed = JSON.parse(result.text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim());
    } catch {
      parsed = { icp_score: 0, icp_priority: 'C', icp_reason: 'parse error' };
    }
    stmt.run(parsed.icp_score, parsed.icp_priority, parsed.icp_reason || '', lead.id);
  }
  console.log(`Legacy rescore done: ${leads.length} leads, cost $${cost.toFixed(4)}`);
  return { total: leads.length, cost };
}

// Run directly
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*[/\\]/, ''))) {
  const legacy = process.argv.includes('--legacy');
  rescoreLeads({ legacy }).catch(err => { console.error(err); process.exit(1); });
}
```

- [ ] **Step 2: Run tests**

```bash
npm test -- scripts/rescoreLeads.test.js
```

Expected: all 4 tests PASS.

### Task 6.3: Commit Chunk 6

- [ ] **Step 1:**

```bash
git add scripts/rescoreLeads.js tests/scripts/ && git commit -m "feat(script): add rescoreLeads.js with --legacy rollback flag

Forward pass: rescores all leads on 0-100 scale using new icpScorer.
Ready leads that surface disqualifiers move to status=disqualified
and their pending emails are deleted. Sent/replied/nurture statuses
are preserved (history is sacred).

--legacy flag: runs the old 0-10 rubric scorer against icp_rules
for a clean rollback. icp_rules table stays intact until Phase 8
follow-up cleanup."
```

---

## Chunk 7: Dashboard visualization + atomic rollout with Chunk 5

**Files:**
- Modify: `web/src/pages/LeadPipeline.jsx`
- Modify: `web/src/pages/FunnelAnalytics.jsx`

**Note:** Per spec §7.3, this chunk is merged + deployed together with Chunk 5 to avoid the 0–10/0–100 color-threshold cliff.

### Task 7.1: Update `FunnelAnalytics.jsx` color thresholds

- [ ] **Step 1: Edit `web/src/pages/FunnelAnalytics.jsx` line 240.** Current:

```jsx
<Cell key={entry.icp_score} fill={entry.icp_score >= 7 ? 'var(--green)' : entry.icp_score >= 4 ? 'var(--amber)' : 'var(--text-muted)'} />
```

Change to:

```jsx
<Cell key={entry.icp_score} fill={entry.icp_score >= 70 ? 'var(--green)' : entry.icp_score >= 40 ? 'var(--amber)' : 'var(--text-muted)'} />
```

Also check if the chart's X-axis tick interval or domain assumes 0–10 — if so, update.

### Task 7.2: Update `LeadPipeline.jsx` detail drawer

- [ ] **Step 1: Edit `web/src/pages/LeadPipeline.jsx`** line 222 area. The current shows:

```jsx
{selectedLead.icp_score ?? '-'} / {selectedLead.icp_priority || '-'}
```

Replace with a richer drawer section:

```jsx
<div className="icp-details">
  <div><strong>Score:</strong> {selectedLead.icp_score ?? '-'} / 100 ({selectedLead.icp_priority || '-'})</div>
  {selectedLead.icp_breakdown && (
    <div className="icp-breakdown">
      <strong>Breakdown</strong>
      <small className="muted"> (per-factor evidence; may not sum exactly to score)</small>
      {(() => {
        let b;
        try { b = JSON.parse(selectedLead.icp_breakdown); } catch { b = null; }
        if (!b) return null;
        return Object.entries(b).map(([k, v]) => (
          <div key={k} className="breakdown-row">
            <span className="label">{k}</span>
            <span className="bar" style={{ width: `${(v / 20) * 100}%` }} />
            <span className="val">{v}</span>
          </div>
        ));
      })()}
    </div>
  )}
  {selectedLead.icp_key_matches && (
    <ChipList label="Matches" json={selectedLead.icp_key_matches} colorVar="--green" />
  )}
  {selectedLead.icp_key_gaps && (
    <ChipList label="Gaps" json={selectedLead.icp_key_gaps} colorVar="--text-muted" />
  )}
  {selectedLead.icp_disqualifiers && (
    <ChipList label="Disqualifiers" json={selectedLead.icp_disqualifiers} colorVar="--red" />
  )}
</div>
```

Where `ChipList` is a small inline helper above the export:

```jsx
function ChipList({ label, json, colorVar }) {
  let arr;
  try { arr = JSON.parse(json); } catch { arr = []; }
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return (
    <div className="chip-list">
      <strong>{label}:</strong>
      {arr.map((s, i) => (
        <span key={i} className="chip" style={{ background: `var(${colorVar})`, opacity: 0.15, color: `var(${colorVar})` }}>{s}</span>
      ))}
    </div>
  );
}
```

Add CSS to `web/src/index.css`:

```css
.icp-details { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
.icp-breakdown .breakdown-row { display: grid; grid-template-columns: 100px 1fr 40px; align-items: center; gap: 6px; font-size: 0.85em; }
.icp-breakdown .bar { height: 8px; background: var(--accent); border-radius: 4px; }
.chip-list { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.chip-list .chip { padding: 2px 6px; border-radius: 999px; font-size: 0.8em; }
```

### Task 7.3: Browser verification

- [ ] **Step 1: Start both servers** (same as Task 4.5) and log in.

- [ ] **Step 2: Run a synthetic findLeads invocation** to create a scored lead (needs offer/icp_profile filled in first):

```bash
node src/engines/findLeads.js
```

- [ ] **Step 3: Navigate to Lead Pipeline page.** Click a lead. Verify drawer shows score out of 100, breakdown bars, matches/gaps chips.

- [ ] **Step 4: Navigate to Funnel Analytics.** Verify score distribution chart uses new 70/40 thresholds for green/amber.

- [ ] **Step 5: Stop servers and clean dev DB.**

### Task 7.4: Commit Chunk 7

- [ ] **Step 1:**

```bash
git add web/src/pages/FunnelAnalytics.jsx web/src/pages/LeadPipeline.jsx web/src/index.css && git commit -m "feat(dashboard): show ICP v2 breakdown/matches/gaps/disqualifiers

FunnelAnalytics: 70/40 color thresholds (was 7/4) for 0-100 scale.
LeadPipeline drawer: per-factor breakdown bars, chip lists for matches,
gaps, and disqualifiers. Subtle caption explains that breakdown may
not sum exactly to overall score (Gemini quirk)."
```

---

## Production Rollout Runbook

Execute in this exact order after all 7 chunks are merged to `reach` and promoted.

| # | Action | Command / location | Verification |
|---|---|---|---|
| 0 | Disable findLeads cron | Dashboard → Engine Config → `find_leads_enabled`=0 | Next 09:00 IST cron logs `status=skipped` |
| 1 | Deploy Chunk 1 | `git push` + `pm2 restart radar-cron radar-dashboard` | `PRAGMA table_info(leads)` shows new columns; `SELECT * FROM offer,icp_profile` each return 1 empty row |
| 2 | Deploy Chunk 2, 3, 4 | same | `/api/offer` and `/api/icp-profile` return 200 |
| 3 | **Fill OFFER + ICP_PROFILE via dashboard** | visit `/offer` and `/icp-profile` on `radar.simpleinc.cloud` | `GET /api/offer` shows non-null `problem`; `GET /api/icp-profile` shows non-empty `industries` |
| 4 | Run rescore script against prod DB | `node scripts/rescoreLeads.js` (on VPS) | Summary prints; `SELECT MAX(icp_score), MIN(icp_score) FROM leads` shows values on 0-100 scale |
| 5 | Deploy Chunk 5 + Chunk 7 together | `git push` + `pm2 restart radar-cron radar-dashboard` | Lead Pipeline page renders 0-100 scores with breakdown; FunnelAnalytics uses 70/40 color thresholds |
| 6 | Re-enable findLeads cron | Dashboard → `find_leads_enabled`=1 | next cron run's `cron_log` shows `status=success` |
| 7 | Observe next 09:00 IST findLeads | Telegram alert "findLeads: N leads ready" | `SELECT icp_score, icp_priority, icp_breakdown, icp_disqualifiers FROM leads WHERE created_at >= date('now','-1 day')` shows structured data |
| 8 | Follow-up PR (separate) | remove `icp_rules` table + `icpRules.js` route + `buildIcpRubric` leftovers | after ~1 week of stable operation |

**Rollback (if step 7 reveals issues):**

1. Dashboard → `find_leads_enabled`=0
2. `git revert <chunk-5+7 merge commit>` + redeploy
3. `node scripts/rescoreLeads.js --legacy` (restores 0-10 scores using `icp_rules`)
4. Dashboard → `find_leads_enabled`=1

Budget: ~$0.50 of Gemini for rollback rescore with 500 leads.

---

## Final suite verification

- [ ] **Step 1: Before merging to main:**

```bash
cd /Users/drprockz/Projects/Outreach && npm test 2>&1 | tail -10
```

Expected: ~130 tests passing (109 original + ~21 new).

- [ ] **Step 2: Check no test files were left with `.skip` or `.only`:**

```bash
grep -rn "it\.skip\|it\.only\|describe\.skip\|describe\.only" tests/
```

Expected: no matches.

- [ ] **Step 3: Production build of dashboard:**

```bash
cd web && npm run build
```

Expected: clean build.
