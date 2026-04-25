# Leads Decision Cockpit Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the read-only `/outreach/leads` page into an operator console with multi-select filters, search, sort, KPIs, saved views, bulk actions (status + retries), and CSV export — driven by the design at `docs/superpowers/specs/2026-04-25-leads-decision-cockpit-design.md`.

**Architecture:** New `src/core/pipeline/` library lifts non-exported stage helpers out of `findLeads.js` so the API can call them. Backend extends `/api/leads` and adds `/kpis`, `/facets`, `/export.csv`, `/bulk/status`, `/bulk/retry`, `/saved-views`. Frontend decomposes `Leads.jsx` into composable components driven by URL-state filters.

**Tech Stack:** Express 4, Prisma + Postgres, React 18 + Vite, Vitest, better-fetch SSE.

---

## Conventions used in this plan

- Test runner: `npm test -- <pattern>` (vitest run). Tests live under `tests/`.
- Frontend tests: vitest + jsdom (see `web/vitest.config.js`). Suffix `.test.jsx`.
- API tests boot the real server on a random port, talk over HTTP, reset Postgres in `beforeEach` (see `tests/api/api.test.js`).
- Commit per task using conventional commits (`feat:`, `refactor:`, `test:`, `chore:`).
- All new server modules use ES modules (`export`, `import`).
- All Prisma migrations go through `npx prisma migrate dev --name <slug>` then commit the generated SQL under `prisma/migrations/`.

---

## Chunk 1: Pre-work refactor — lift stage helpers into core/pipeline

**Why first:** The bulk-retry endpoint (chunk 3) imports these. The refactor must land cleanly behind the existing engine before any new feature touches them.

### File structure (new + modified)

| File | Action | Responsibility |
|---|---|---|
| `src/core/pipeline/regenerateHook.js` | create | exports `regenerateHook(lead, persona, signals)` returning `{ hook, costUsd, model, hookVariantId }` |
| `src/core/pipeline/regenerateBody.js` | create | exports `regenerateBody(lead, hook, persona)` returning `{ body, costUsd, model }` |
| `src/core/pipeline/regenerateSubject.js` | create | exports `regenerateSubject(lead)` returning `{ subject, costUsd }` |
| `src/core/pipeline/reextract.js` | create | exports `reextract(lead)` returning `{ data, costUsd }` |
| `src/core/pipeline/rescoreIcp.js` | create | thin re-export of `scoreLead` from `core/ai/icpScorer.js` |
| `src/core/pipeline/verifyEmailLib.js` | create | thin re-export of `verifyEmail` from `core/integrations/mev.js` |
| `src/core/pipeline/index.js` | create | barrel: `export { regenerateHook, regenerateBody, … }` |
| `src/engines/findLeads.js` | modify | replace inlined stage10/11/2-6 helpers with imports from `core/pipeline/` |
| `tests/core/pipeline/regenerateHook.test.js` | create | unit test asserting return shape + niche/persona context plumbed correctly (with mocked claude/gemini calls) |
| `tests/core/pipeline/regenerateBody.test.js` | create | as above |
| `tests/core/pipeline/reextract.test.js` | create | as above |
| `tests/core/pipeline/snapshot.findLeads.test.js` | create | golden test: feed canonical lead fixture through pipeline, snapshot stage 10 + 11 output (with deterministic mocks) |

### Task 1.1: Capture findLeads golden snapshot BEFORE refactor

**Files:**
- Create: `tests/engines/findLeads.snapshot.test.js`

- [ ] **Step 1: Write the snapshot test**

This test runs *against the current findLeads.js* with mocked AI calls so we can prove byte-identical output post-refactor.

```javascript
// tests/engines/findLeads.snapshot.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const FIXTURE_LEAD = {
  business_name: 'Acme Bakery',
  website_url: 'https://acmebakery.in',
  city: 'Mumbai',
  contact_name: 'Priya',
  manual_hook_note: null,
};
const PERSONA = { name: 'Darshan', role: 'fullstack dev', company: 'Simple Inc', services: 'web rebuild', tone: 'casual' };
const SIGNALS = [{ signalType: 'hiring', headline: 'hiring frontend dev', url: 'https://x.test' }];

vi.mock('../../src/core/ai/claude.js', () => ({
  callClaude: vi.fn(async (model, prompt) => ({
    text: model === 'sonnet'
      ? `MOCK_HOOK[${prompt.includes('curious-question') ? 'B' : 'A'}]`
      : prompt.includes('subject') ? 'mock subject' : 'mock body',
    costUsd: 0.001,
    model: `mock-${model}`,
  })),
}));

describe('findLeads stage helpers — pre-refactor snapshot', () => {
  let stage10_hook, stage11_body, stage11_subject;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../../src/engines/findLeads.js');
    // These functions are NOT exported today — this test will FAIL until task 1.2.
    stage10_hook = mod.stage10_hook;
    stage11_body = mod.stage11_body;
    stage11_subject = mod.stage11_subject;
  });

  it('stage10_hook returns chosen variant + total cost of both calls', async () => {
    const r = await stage10_hook(FIXTURE_LEAD, PERSONA, SIGNALS);
    expect(r.hook).toMatch(/^MOCK_HOOK\[(A|B)\]$/);
    expect(r.costUsd).toBeCloseTo(0.002, 6);
    expect(r.hookVariantId).toMatch(/^[AB]$/);
  });

  it('stage11_body returns body string', async () => {
    const r = await stage11_body(FIXTURE_LEAD, 'a hook', PERSONA);
    expect(r.body).toBe('mock body');
  });

  it('stage11_subject returns subject string', async () => {
    const r = await stage11_subject(FIXTURE_LEAD);
    expect(r.subject).toBe('mock subject');
  });
});
```

- [ ] **Step 2: Run — expect FAIL (helpers not exported yet)**

Run: `npm test -- findLeads.snapshot`
Expected: FAIL — `stage10_hook is not a function` (because they're local, not exported).

- [ ] **Step 3: Add named exports to findLeads.js for the three helpers**

Modify `src/engines/findLeads.js` — find each `async function stage10_hook`, `async function stage11_body`, `async function stage11_subject` and prefix with `export`. Same for `async function stages2to6_extract`. Do NOT change function bodies. Default export stays.

- [ ] **Step 4: Run — expect PASS**

Run: `npm test -- findLeads.snapshot`
Expected: PASS, all three tests green.

- [ ] **Step 5: Commit**

```bash
git add tests/engines/findLeads.snapshot.test.js src/engines/findLeads.js
git commit -m "test(findLeads): pin stage10/11 helpers behind exports + golden test"
```

### Task 1.2: Extract regenerateHook into core/pipeline

**Files:**
- Create: `src/core/pipeline/regenerateHook.js`
- Create: `tests/core/pipeline/regenerateHook.test.js`
- Modify: `src/engines/findLeads.js` (delete inlined helpers, import from core/pipeline)

- [ ] **Step 1: Write the failing test**

```javascript
// tests/core/pipeline/regenerateHook.test.js
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/core/ai/claude.js', () => ({
  callClaude: vi.fn(async (model, prompt) => ({
    text: prompt.includes('curious-question') ? 'B-hook' : 'A-hook',
    costUsd: 0.001,
    model: `mock-${model}`,
  })),
}));

const { regenerateHook } = await import('../../../src/core/pipeline/regenerateHook.js');

describe('regenerateHook', () => {
  const lead = { business_name: 'Acme', website_url: 'https://acme.test', manual_hook_note: null };
  const persona = { name: 'D', role: 'dev', company: 'X', services: 's', tone: 'casual' };

  it('returns chosen variant + summed cost of A+B', async () => {
    const r = await regenerateHook(lead, persona, []);
    expect(['A-hook', 'B-hook']).toContain(r.hook);
    expect(r.costUsd).toBeCloseTo(0.002, 6);
    expect(r.hookVariantId).toMatch(/^[AB]$/);
    expect(r.model).toMatch(/^mock-sonnet$/);
  });

  it('weaves signals into prompt when present', async () => {
    const { callClaude } = await import('../../../src/core/ai/claude.js');
    callClaude.mockClear();
    await regenerateHook(lead, persona, [{ signalType: 'hiring', headline: 'h1', url: 'u1' }]);
    const prompt = callClaude.mock.calls[0][1];
    expect(prompt).toContain('hiring');
    expect(prompt).toContain('h1');
  });

  it('appends manual_hook_note hint when set', async () => {
    const { callClaude } = await import('../../../src/core/ai/claude.js');
    callClaude.mockClear();
    await regenerateHook({ ...lead, manual_hook_note: 'angle: US expansion' }, persona, []);
    const prompt = callClaude.mock.calls[0][1];
    expect(prompt).toContain('angle: US expansion');
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npm test -- regenerateHook`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/core/pipeline/regenerateHook.js`**

Copy the bodies of `VARIANT_SEEDS`, `buildSignalsBlock`, `buildHookPrompt`, `generateHookVariant`, and `stage10_hook` from `src/engines/findLeads.js:185-225` into a new file. Replace the import path for `callClaude` and `callGemini` to use absolute imports from the file's new location. Export `regenerateHook` as a named export — same body as `stage10_hook`.

```javascript
// src/core/pipeline/regenerateHook.js
import { callClaude } from '../ai/claude.js';
import { callGemini } from '../ai/gemini.js';

const ANTHROPIC_DISABLED = process.env.ANTHROPIC_DISABLED === 'true';

const VARIANT_SEEDS = {
  A: { name: 'observation', angle: 'a hyper-specific observation about something concrete you\'d notice as' },
  B: { name: 'curious-question', angle: 'a short curious question opening (max 20 words) that a' },
};

function buildSignalsBlock(signals) {
  if (!Array.isArray(signals) || signals.length === 0) return '';
  const lines = signals.slice(0, 3).map((s, i) => `${i + 1}. [${s.signalType}] ${s.headline}${s.url ? ` (${s.url})` : ''}`);
  return `\n\nRecent signals about this business (newest/strongest first):\n${lines.join('\n')}\n\nIf one of these signals is genuinely interesting, weave it into the hook. If none feel natural, ignore them and observe the website directly.`;
}

function buildHookPrompt(variant, lead, persona, signals) {
  const seed = VARIANT_SEEDS[variant];
  const opener = variant === 'A'
    ? `Write ONE sentence (max 20 words) that makes ${seed.angle} a ${persona.role} — outdated tech, missing feature, design issue. No fluff, no compliments.`
    : `${seed.angle.replace(/^a /, 'Write ')} ${persona.role} would ask ${lead.business_name}'s owner about their site (${lead.website_url}) — concrete, no fluff.`;
  const manualNote = lead.manual_hook_note ? `\n\nManual hook hint from operator: ${lead.manual_hook_note}` : '';
  return opener + buildSignalsBlock(signals) + manualNote;
}

async function generateHookVariant(variant, lead, persona, signals) {
  const prompt = buildHookPrompt(variant, lead, persona, signals);
  if (ANTHROPIC_DISABLED) {
    const result = await callGemini(prompt);
    return { variant, hook: result.text.trim(), costUsd: result.costUsd, model: 'gemini-2.5-flash' };
  }
  const result = await callClaude('sonnet', prompt, { maxTokens: 60 });
  return { variant, hook: result.text.trim(), costUsd: result.costUsd, model: result.model };
}

export async function regenerateHook(lead, persona, signals = []) {
  const [a, b] = await Promise.all([
    generateHookVariant('A', lead, persona, signals),
    generateHookVariant('B', lead, persona, signals),
  ]);
  const chosen = Math.random() < 0.5 ? a : b;
  const totalCost = (a.costUsd || 0) + (b.costUsd || 0);
  return { hook: chosen.hook, costUsd: totalCost, model: chosen.model, hookVariantId: chosen.variant };
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npm test -- regenerateHook`
Expected: PASS, all three tests green.

- [ ] **Step 5: Replace findLeads stage10 with import**

In `src/engines/findLeads.js`:
1. Add at top: `import { regenerateHook } from '../core/pipeline/regenerateHook.js';`
2. Delete the local declarations: `VARIANT_SEEDS`, `buildSignalsBlock`, `buildHookPrompt`, `generateHookVariant`, `stage10_hook`, plus the `export` you added in Task 1.1 for `stage10_hook`.
3. Find the call site: every `stage10_hook(lead, persona, signals)` → replace with `regenerateHook(lead, persona, signals)`.

- [ ] **Step 6: Run engine tests + golden snapshot**

Run: `npm test -- findLeads`
Expected: PASS for both `findLeads.test.js` and `findLeads.snapshot.test.js` (the snapshot test in 1.1 will need its `mod.stage10_hook` reference updated — replace with `mod.regenerateHook` import path or delete that assertion since it's now covered by the unit test in 1.2). **Do this update inline** before running: edit `tests/engines/findLeads.snapshot.test.js` to remove the `stage10_hook` test, leaving only `stage11_body` and `stage11_subject` checks.

- [ ] **Step 7: Commit**

```bash
git add src/core/pipeline/regenerateHook.js tests/core/pipeline/regenerateHook.test.js src/engines/findLeads.js tests/engines/findLeads.snapshot.test.js
git commit -m "refactor(pipeline): extract regenerateHook into core/pipeline"
```

### Task 1.3: Extract regenerateBody into core/pipeline

**Files:**
- Create: `src/core/pipeline/regenerateBody.js`
- Create: `tests/core/pipeline/regenerateBody.test.js`
- Modify: `src/engines/findLeads.js`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/core/pipeline/regenerateBody.test.js
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/core/ai/claude.js', () => ({
  callClaude: vi.fn(async () => ({ text: '  body text  ', costUsd: 0.0005, model: 'mock-haiku' })),
}));

const { regenerateBody } = await import('../../../src/core/pipeline/regenerateBody.js');

describe('regenerateBody', () => {
  it('returns trimmed body + cost + model', async () => {
    const lead = { business_name: 'Acme', contact_name: 'Priya', owner_name: null };
    const persona = { name: 'D', role: 'dev', company: 'X', services: 's', tone: 'casual' };
    const r = await regenerateBody(lead, 'the hook', persona);
    expect(r.body).toBe('body text');
    expect(r.costUsd).toBe(0.0005);
    expect(r.model).toBe('mock-haiku');
  });

  it('passes hook into prompt verbatim', async () => {
    const { callClaude } = await import('../../../src/core/ai/claude.js');
    callClaude.mockClear();
    await regenerateBody({ business_name: 'A' }, 'UNIQUE_HOOK_TOKEN', { name: 'D', role: 'r', company: 'c', services: 's', tone: 't' });
    expect(callClaude.mock.calls[0][1]).toContain('UNIQUE_HOOK_TOKEN');
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`npm test -- regenerateBody`)

- [ ] **Step 3: Create `src/core/pipeline/regenerateBody.js`** by lifting `stage11_body` body verbatim from `findLeads.js`. Export as `regenerateBody`.

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Replace usage in findLeads.js** (delete local + add import + update call sites + drop export).

- [ ] **Step 6: Run all engine tests + snapshot — expect PASS**

- [ ] **Step 7: Commit**

```bash
git add src/core/pipeline/regenerateBody.js tests/core/pipeline/regenerateBody.test.js src/engines/findLeads.js
git commit -m "refactor(pipeline): extract regenerateBody into core/pipeline"
```

### Task 1.4: Extract regenerateSubject + reextract analogously

Same TDD shape as Task 1.3. Create:
- `src/core/pipeline/regenerateSubject.js` from `stage11_subject`
- `src/core/pipeline/reextract.js` from `stages2to6_extract` — note this returns `{ data, costUsd }` not `{ body, costUsd }`.
- Tests: `tests/core/pipeline/regenerateSubject.test.js`, `tests/core/pipeline/reextract.test.js`.

- [ ] **Step 1: Write tests for both** (mirror Task 1.3's structure)
- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Create both library files**
- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Replace usage in findLeads.js**
- [ ] **Step 6: Delete `tests/engines/findLeads.snapshot.test.js`** — it's now redundant (each helper has its own unit test).
- [ ] **Step 7: Run full engine suite — expect PASS**
- [ ] **Step 8: Commit**

```bash
git add src/core/pipeline/ tests/core/pipeline/ src/engines/findLeads.js
git rm tests/engines/findLeads.snapshot.test.js
git commit -m "refactor(pipeline): extract regenerateSubject + reextract; remove transitional snapshot"
```

### Task 1.5: Add thin pipeline barrel + re-exports

**Files:**
- Create: `src/core/pipeline/index.js`
- Create: `src/core/pipeline/rescoreIcp.js`
- Create: `src/core/pipeline/verifyEmailLib.js`

- [ ] **Step 1: Create `rescoreIcp.js`** as a thin re-export:

```javascript
// src/core/pipeline/rescoreIcp.js
export { scoreLead as rescoreIcp } from '../ai/icpScorer.js';
```

- [ ] **Step 2: Create `verifyEmailLib.js`** as a thin re-export:

```javascript
// src/core/pipeline/verifyEmailLib.js
export { verifyEmail } from '../integrations/mev.js';
```

- [ ] **Step 3: Create `index.js` barrel:**

```javascript
// src/core/pipeline/index.js
export { regenerateHook } from './regenerateHook.js';
export { regenerateBody } from './regenerateBody.js';
export { regenerateSubject } from './regenerateSubject.js';
export { reextract } from './reextract.js';
export { rescoreIcp } from './rescoreIcp.js';
export { verifyEmail } from './verifyEmailLib.js';
```

- [ ] **Step 4: Run all tests — expect PASS** (`npm test`)

- [ ] **Step 5: Commit**

```bash
git add src/core/pipeline/index.js src/core/pipeline/rescoreIcp.js src/core/pipeline/verifyEmailLib.js
git commit -m "refactor(pipeline): add barrel + thin wrappers for icp/mev"
```

---

## Chunk 2: Schema migration — saved_views + indexes

### File structure

| File | Action | Responsibility |
|---|---|---|
| `prisma/schema.prisma` | modify | add `SavedView` model + 2 composite indexes on Lead |
| `prisma/migrations/<ts>_leads_cockpit_baseline/migration.sql` | create (auto) | generated by `prisma migrate dev` |
| `tests/api/savedViews.test.js` | create later (chunk 3) | — |

### Task 2.1: Add SavedView model + Lead indexes

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Append SavedView model** to `prisma/schema.prisma`:

```prisma
model SavedView {
  id          Int       @id @default(autoincrement())
  name        String
  filtersJson Json      @map("filters_json")
  sort        String?
  createdAt   DateTime  @default(now()) @db.Timestamptz(6) @map("created_at")
  updatedAt   DateTime  @updatedAt @db.Timestamptz(6) @map("updated_at")

  @@map("saved_views")
}
```

- [ ] **Step 2: Add Lead composite indexes**

Inside `model Lead { ... }`, replace the `@@index([status])` and `@@index([icpScore])` lines with:

```prisma
  @@index([status])
  @@index([icpScore])
  @@index([contactEmail])
  @@index([status, icpScore(sort: Desc)], map: "idx_leads_status_icp_score")
  @@index([domainLastContacted(sort: Desc)], map: "idx_leads_domain_last_contacted")
```

- [ ] **Step 3: Generate migration**

Run: `npx prisma migrate dev --name leads_cockpit_baseline`

Expected: prompts may appear; accept defaults. New folder created at `prisma/migrations/<timestamp>_leads_cockpit_baseline/`. SQL contains `CREATE TABLE "saved_views"` and `CREATE INDEX idx_leads_status_icp_score`.

- [ ] **Step 4: Run all tests — expect PASS** (`npm test`)

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(db): add saved_views table + leads cockpit indexes"
```

---

## Chunk 3: Backend extensions

Order: read endpoints first (filters, kpis, facets), then mutations (status, retry), then saved-views CRUD, then export.

### File structure

| File | Action | Responsibility |
|---|---|---|
| `src/api/routes/leads.js` | modify | extend `GET /` (filters, sort, search), add `GET /kpis`, `GET /facets`, `GET /export.csv`, `POST /bulk/status`, `POST /bulk/retry` |
| `src/api/routes/leads/filterParser.js` | create | pure module: parse req.query → Prisma `where` + sort args; allowlist sort fields |
| `src/api/routes/leads/csvExport.js` | create | pure module: streamed CSV writer |
| `src/api/routes/leads/bulkStatus.js` | create | bulk status handler logic |
| `src/api/routes/leads/bulkRetry.js` | create | bulk retry orchestrator (cost estimate + SSE) |
| `src/api/routes/savedViews.js` | create | CRUD router |
| `src/api/server.js` | modify | mount `/api/saved-views` |
| `tests/api/leads.filters.test.js` | create | filter parser unit tests + endpoint integration tests |
| `tests/api/leads.kpis.test.js` | create | |
| `tests/api/leads.bulk.status.test.js` | create | |
| `tests/api/leads.bulk.retry.test.js` | create | |
| `tests/api/leads.export.test.js` | create | |
| `tests/api/savedViews.test.js` | create | |

### Task 3.1: Extract filter parser into a pure module

**Files:**
- Create: `src/api/routes/leads/filterParser.js`
- Create: `tests/api/leads/filterParser.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/api/leads/filterParser.test.js
import { describe, it, expect } from 'vitest';
import { parseLeadsQuery } from '../../../src/api/routes/leads/filterParser.js';

const T = { threshA: 70, threshB: 40 };

describe('parseLeadsQuery', () => {
  it('parses single-value status', () => {
    const out = parseLeadsQuery({ status: 'ready' }, T);
    expect(out.where.status).toBe('ready');
  });

  it('parses multi-value status', () => {
    const out = parseLeadsQuery({ status: ['ready', 'queued'] }, T);
    expect(out.where.status).toEqual({ in: ['ready', 'queued'] });
  });

  it('translates icp_priority A → score >= threshA', () => {
    const out = parseLeadsQuery({ icp_priority: 'A' }, T);
    expect(out.where.icpScore).toEqual({ gte: 70 });
  });

  it('translates icp_priority B → range [threshB, threshA)', () => {
    const out = parseLeadsQuery({ icp_priority: 'B' }, T);
    expect(out.where.icpScore).toEqual({ gte: 40, lt: 70 });
  });

  it('translates icp_priority C → score < threshB', () => {
    const out = parseLeadsQuery({ icp_priority: 'C' }, T);
    expect(out.where.icpScore).toEqual({ lt: 40 });
  });

  it('translates multi-priority to OR of ranges', () => {
    const out = parseLeadsQuery({ icp_priority: ['A', 'C'] }, T);
    expect(out.where.OR).toBeDefined();
  });

  it('parses search across business_name / website_url / contact_email', () => {
    const out = parseLeadsQuery({ search: 'acme' }, T);
    expect(out.where.OR).toEqual([
      { businessName: { contains: 'acme', mode: 'insensitive' } },
      { websiteUrl: { contains: 'acme', mode: 'insensitive' } },
      { contactEmail: { contains: 'acme', mode: 'insensitive' } },
    ]);
  });

  it('parses icp_score range', () => {
    const out = parseLeadsQuery({ icp_score_min: '50', icp_score_max: '90' }, T);
    expect(out.where.icpScore).toEqual({ gte: 50, lte: 90 });
  });

  it('parses has_linkedin_dm bool', () => {
    const out = parseLeadsQuery({ has_linkedin_dm: '1' }, T);
    expect(out.where.dmLinkedinUrl).toEqual({ not: null });
  });

  it('parses sort with allowlist; falls back on invalid', () => {
    expect(parseLeadsQuery({ sort: 'icp_score:desc' }, T).orderBy).toEqual([
      { icpScore: 'desc' }, { discoveredAt: 'desc' },
    ]);
    expect(parseLeadsQuery({ sort: 'malicious;drop' }, T).orderBy).toEqual([
      { icpScore: 'desc' }, { discoveredAt: 'desc' },
    ]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`npm test -- filterParser`)

- [ ] **Step 3: Implement `filterParser.js`**

```javascript
// src/api/routes/leads/filterParser.js

const SORT_ALLOWLIST = {
  icp_score: 'icpScore',
  website_quality_score: 'websiteQualityScore',
  signal_count: '__signalCount',  // resolved at query layer
  discovered_at: 'discoveredAt',
  domain_last_contacted: 'domainLastContacted',
};

function asArray(v) { return v == null ? [] : Array.isArray(v) ? v : [v]; }

function priorityToRange(p, t) {
  if (p === 'A') return { gte: t.threshA };
  if (p === 'B') return { gte: t.threshB, lt: t.threshA };
  if (p === 'C') return { lt: t.threshB };
  return null;
}

export function parseLeadsQuery(q, thresholds) {
  const where = {};

  // status
  const status = asArray(q.status);
  if (status.length === 1) where.status = status[0];
  else if (status.length > 1) where.status = { in: status };

  // category, city, country, email_status, business_stage, employees_estimate
  for (const [qkey, dbkey] of [
    ['category', 'category'], ['city', 'city'], ['country', 'country'],
    ['email_status', 'emailStatus'], ['business_stage', 'businessStage'],
    ['employees_estimate', 'employeesEstimate'],
  ]) {
    const arr = asArray(q[qkey]);
    if (arr.length === 1) where[dbkey] = arr[0];
    else if (arr.length > 1) where[dbkey] = { in: arr };
  }

  // search
  if (q.search) {
    where.OR = [
      { businessName: { contains: q.search, mode: 'insensitive' } },
      { websiteUrl: { contains: q.search, mode: 'insensitive' } },
      { contactEmail: { contains: q.search, mode: 'insensitive' } },
    ];
  }

  // icp_priority (multi)
  const priorities = asArray(q.icp_priority);
  if (priorities.length === 1) {
    const r = priorityToRange(priorities[0], thresholds);
    if (r) where.icpScore = r;
  } else if (priorities.length > 1) {
    const ors = priorities.map(p => priorityToRange(p, thresholds)).filter(Boolean).map(r => ({ icpScore: r }));
    where.OR = (where.OR || []).concat(ors);
  }

  // icp_score range
  if (q.icp_score_min || q.icp_score_max) {
    where.icpScore = where.icpScore || {};
    if (q.icp_score_min) where.icpScore.gte = Number(q.icp_score_min);
    if (q.icp_score_max) where.icpScore.lte = Number(q.icp_score_max);
  }

  // quality_score range
  if (q.quality_score_min || q.quality_score_max) {
    where.websiteQualityScore = {};
    if (q.quality_score_min) where.websiteQualityScore.gte = Number(q.quality_score_min);
    if (q.quality_score_max) where.websiteQualityScore.lte = Number(q.quality_score_max);
  }

  // has_linkedin_dm
  if (q.has_linkedin_dm === '1' || q.has_linkedin_dm === 'true') {
    where.dmLinkedinUrl = { not: null };
  }

  // in_reject_list — default false (hide rejected unless asked)
  if (q.in_reject_list === '1' || q.in_reject_list === 'true') {
    where.inRejectList = true;
  } else if (q.in_reject_list !== 'all') {
    where.inRejectList = false;
  }

  // discovered date range
  if (q.date_from || q.date_to) {
    where.discoveredAt = {};
    if (q.date_from) where.discoveredAt.gte = new Date(q.date_from);
    if (q.date_to) where.discoveredAt.lte = new Date(q.date_to);
  }

  // sort
  const orderBy = parseSort(q.sort);

  return { where, orderBy, raw: { q, thresholds } };
}

function parseSort(s) {
  const fallback = [{ icpScore: 'desc' }, { discoveredAt: 'desc' }];
  if (!s || typeof s !== 'string') return fallback;
  const [field, dir] = s.split(':');
  if (!SORT_ALLOWLIST[field] || !['asc', 'desc'].includes(dir)) return fallback;
  if (SORT_ALLOWLIST[field] === '__signalCount') return [{ __signalCount: dir }, { discoveredAt: 'desc' }];
  return [{ [SORT_ALLOWLIST[field]]: dir }, { discoveredAt: 'desc' }];
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/api/routes/leads/filterParser.js tests/api/leads/filterParser.test.js
git commit -m "feat(api): pure filter parser for leads cockpit"
```

### Task 3.2: Wire filter parser into GET /api/leads (multi-value, search, sort)

**Files:**
- Modify: `src/api/routes/leads.js`
- Create: `tests/api/leads.filters.test.js`

- [ ] **Step 1: Write integration test**

```javascript
// tests/api/leads.filters.test.js
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { truncateAll, closeTestPrisma } from '../helpers/testDb.js';

let server, baseUrl, token;
async function login() {
  const r = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'testpass' }),
  });
  return (await r.json()).token;
}
function h() { return { Authorization: `Bearer ${token}` }; }

beforeAll(async () => {
  process.env.DASHBOARD_PASSWORD = 'testpass';
  process.env.JWT_SECRET = 'testsecret64charslongpadded00000000000000000000000000000000000000';
  process.env.NODE_ENV = 'test';
  const mod = await import('../../src/api/server.js');
  server = mod.app.listen(0);
  baseUrl = `http://localhost:${server.address().port}`;
});

beforeEach(async () => {
  await truncateAll();
  const { resetDb, seedConfigDefaults, prisma } = await import('../../src/core/db/index.js');
  await resetDb();
  await seedConfigDefaults();
  await prisma.lead.createMany({ data: [
    { businessName: 'Alpha', status: 'ready', icpScore: 80, city: 'Mumbai',  category: 'd2c' },
    { businessName: 'Beta',  status: 'queued', icpScore: 50, city: 'Bangalore', category: 'd2c' },
    { businessName: 'Gamma', status: 'nurture', icpScore: 30, city: 'Mumbai',  category: 'real_estate' },
    { businessName: 'Delta', status: 'ready', icpScore: 75, city: 'Mumbai', category: 'real_estate', dmLinkedinUrl: 'https://li/x' },
  ] });
  token = await login();
});

afterAll(async () => { server.close(); await closeTestPrisma(); });

describe('GET /api/leads — extended filters', () => {
  it('multi-value status', async () => {
    const r = await fetch(`${baseUrl}/api/leads?status=ready&status=queued`, { headers: h() });
    const d = await r.json();
    expect(d.total).toBe(3);
  });

  it('icp_priority A returns score >= 70', async () => {
    const r = await fetch(`${baseUrl}/api/leads?icp_priority=A`, { headers: h() });
    const d = await r.json();
    expect(d.leads.map(l => l.business_name).sort()).toEqual(['Alpha', 'Delta']);
  });

  it('search matches business_name case-insensitive', async () => {
    const r = await fetch(`${baseUrl}/api/leads?search=alp`, { headers: h() });
    const d = await r.json();
    expect(d.total).toBe(1);
    expect(d.leads[0].business_name).toBe('Alpha');
  });

  it('has_linkedin_dm filter', async () => {
    const r = await fetch(`${baseUrl}/api/leads?has_linkedin_dm=1`, { headers: h() });
    const d = await r.json();
    expect(d.total).toBe(1);
    expect(d.leads[0].business_name).toBe('Delta');
  });

  it('sort=icp_score:asc', async () => {
    const r = await fetch(`${baseUrl}/api/leads?sort=icp_score:asc`, { headers: h() });
    const d = await r.json();
    expect(d.leads[0].business_name).toBe('Gamma');
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Update `src/api/routes/leads.js`** GET handler (lines 163–193 today):

Replace the inlined `where = {}` block with:

```javascript
import { parseLeadsQuery } from './leads/filterParser.js';

// ...inside router.get('/'):
const t = await getThresholds();
const { where, orderBy } = parseLeadsQuery(req.query, t);
const limit = Number(req.query.limit) || 25;
const offset = (Number(req.query.page) || 1 - 1) * limit;
// note: signal_count sort handled separately (next task)
const [total, rows] = await Promise.all([
  prisma.lead.count({ where }),
  prisma.lead.findMany({ where, orderBy, take: limit, skip: offset }),
]);
// existing signal-count groupBy block stays as-is
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/api/routes/leads.js tests/api/leads.filters.test.js
git commit -m "feat(api): multi-value filters + search + sort on GET /leads"
```

### Task 3.3: Add signal-driven filters to GET /api/leads

**Files:**
- Modify: `src/api/routes/leads/filterParser.js` (signal joins)
- Modify: `src/api/routes/leads.js`
- Modify: `tests/api/leads.filters.test.js` (add signal test cases)

The filters: `has_signals=1`, `min_signal_count=N`, `signal_type=hiring`, `signal_date_from`, `signal_date_to`. These cannot land in `where` directly — they require a sub-query against `lead_signals`.

- [ ] **Step 1: Write failing tests**

Add to `tests/api/leads.filters.test.js`:

```javascript
it('has_signals=1 returns leads with at least one signal', async () => {
  const { prisma } = await import('../../src/core/db/index.js');
  const lead = await prisma.lead.findFirst({ where: { businessName: 'Alpha' } });
  await prisma.leadSignal.create({ data: { leadId: lead.id, source: 'rss', signalType: 'hiring', headline: 'h', confidence: 0.8, signalDate: new Date() } });
  const r = await fetch(`${baseUrl}/api/leads?has_signals=1`, { headers: h() });
  const d = await r.json();
  expect(d.total).toBe(1);
  expect(d.leads[0].business_name).toBe('Alpha');
});

it('signal_type=funding filters via join', async () => {
  const { prisma } = await import('../../src/core/db/index.js');
  const a = await prisma.lead.findFirst({ where: { businessName: 'Alpha' } });
  const b = await prisma.lead.findFirst({ where: { businessName: 'Beta' } });
  await prisma.leadSignal.createMany({ data: [
    { leadId: a.id, source: 'rss', signalType: 'hiring', headline: 'h', confidence: 0.8, signalDate: new Date() },
    { leadId: b.id, source: 'rss', signalType: 'funding', headline: 'f', confidence: 0.9, signalDate: new Date() },
  ] });
  const r = await fetch(`${baseUrl}/api/leads?signal_type=funding`, { headers: h() });
  const d = await r.json();
  expect(d.total).toBe(1);
  expect(d.leads[0].business_name).toBe('Beta');
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Extend `parseLeadsQuery`** to compute a `signalFilter` object (without putting it on `where`):

```javascript
// inside parseLeadsQuery, before `return`:
const signalFilter = {};
if (q.has_signals === '1') signalFilter.has = true;
if (q.min_signal_count) signalFilter.minCount = Number(q.min_signal_count);
const sigTypes = asArray(q.signal_type);
if (sigTypes.length) signalFilter.types = sigTypes;
if (q.signal_date_from) signalFilter.from = new Date(q.signal_date_from);
if (q.signal_date_to) signalFilter.to = new Date(q.signal_date_to);
return { where, orderBy, signalFilter };
```

- [ ] **Step 4: In `src/api/routes/leads.js`**, when `signalFilter` non-empty, pre-compute eligible leadIds and AND into `where`:

```javascript
if (Object.keys(signalFilter).length) {
  const sw = {};
  if (signalFilter.types) sw.signalType = { in: signalFilter.types };
  if (signalFilter.from || signalFilter.to) {
    sw.signalDate = {};
    if (signalFilter.from) sw.signalDate.gte = signalFilter.from;
    if (signalFilter.to) sw.signalDate.lte = signalFilter.to;
  }
  const grouped = await prisma.leadSignal.groupBy({
    by: ['leadId'], where: sw, _count: { _all: true },
  });
  const minCount = signalFilter.minCount || 1;
  const eligible = grouped.filter(g => g._count._all >= minCount).map(g => g.leadId);
  where.AND = (where.AND || []).concat([{ id: { in: eligible.length ? eligible : [-1] } }]);
}
```

- [ ] **Step 5: Run — expect PASS**

- [ ] **Step 6: Commit**

```bash
git add src/api/routes/leads/filterParser.js src/api/routes/leads.js tests/api/leads.filters.test.js
git commit -m "feat(api): signal-driven filters on GET /leads"
```

### Task 3.4: Add tech_stack JSON-array filter (with jsonb_typeof guard)

**Files:**
- Modify: `src/api/routes/leads.js`
- Modify: `tests/api/leads.filters.test.js`

- [ ] **Step 1: Write failing test**

```javascript
it('tech_stack filter (any-of) using JSONB ?| operator', async () => {
  const { prisma } = await import('../../src/core/db/index.js');
  await prisma.lead.update({ where: { businessName: 'Alpha' }, data: { techStack: ['WordPress', 'PHP'] } });
  await prisma.lead.update({ where: { businessName: 'Beta' }, data: { techStack: ['Next.js'] } });
  const r = await fetch(`${baseUrl}/api/leads?tech_stack=WordPress&tech_stack=Shopify`, { headers: h() });
  const d = await r.json();
  expect(d.leads.map(l => l.business_name)).toEqual(['Alpha']);
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement raw SQL guard in `src/api/routes/leads.js`**

After the existing `where` is computed but before the count/findMany, when `tech_stack` is in query:

```javascript
const techStack = Array.isArray(req.query.tech_stack) ? req.query.tech_stack : req.query.tech_stack ? [req.query.tech_stack] : [];
if (techStack.length) {
  // JSONB array contains-any — guarded against rows where tech_stack is not an array
  const rows = await prisma.$queryRaw`
    SELECT id FROM leads
    WHERE jsonb_typeof(tech_stack) = 'array'
      AND tech_stack ?| ${techStack}::text[]
  `;
  const ids = rows.map(r => r.id);
  where.AND = (where.AND || []).concat([{ id: { in: ids.length ? ids : [-1] } }]);
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/api/routes/leads.js tests/api/leads.filters.test.js
git commit -m "feat(api): tech_stack JSONB filter with jsonb_typeof guard"
```

### Task 3.5: GET /api/leads/kpis (global + filter-scoped)

**Files:**
- Modify: `src/api/routes/leads.js` (add new route handler before `/:id`)
- Create: `tests/api/leads.kpis.test.js`

- [ ] **Step 1: Write failing test**

```javascript
// tests/api/leads.kpis.test.js
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { truncateAll, closeTestPrisma } from '../helpers/testDb.js';

let server, baseUrl, token;
// (same setup as leads.filters.test.js — copy beforeAll/beforeEach/afterAll, seed: 4 leads as in 3.2 + a signal in last 7d on Alpha + an unactioned reply)

describe('GET /api/leads/kpis', () => {
  it('returns global + filter-scoped counters in one payload', async () => {
    const r = await fetch(`${baseUrl}/api/leads/kpis?status=ready`, { headers: h() });
    const d = await r.json();
    expect(d.global).toMatchObject({
      total: 4,
      readyToSend: 2,
      icpA: 2, icpB: 1, icpC: 1,
      signals7d: expect.any(Number),
      repliesAwaitingTriage: expect.any(Number),
    });
    expect(d.inFilter).toMatchObject({
      total: 2, readyToSend: 2, icpA: 2, icpB: 0, icpC: 0,
    });
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement handler**

In `src/api/routes/leads.js`, BEFORE `router.get('/:id', ...)`:

```javascript
router.get('/kpis', async (req, res) => {
  const t = await getThresholds();
  const { where } = parseLeadsQuery(req.query, t);

  async function summarize(scopedWhere) {
    const [total, readyToSend, icpA, icpB, icpC] = await Promise.all([
      prisma.lead.count({ where: scopedWhere }),
      prisma.lead.count({ where: { ...scopedWhere, status: 'ready' } }),
      prisma.lead.count({ where: { ...scopedWhere, icpScore: { gte: t.threshA } } }),
      prisma.lead.count({ where: { ...scopedWhere, icpScore: { gte: t.threshB, lt: t.threshA } } }),
      prisma.lead.count({ where: { ...scopedWhere, icpScore: { lt: t.threshB } } }),
    ]);
    return { total, readyToSend, icpA, icpB, icpC };
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000);
  const [global, inFilter, signals7d, repliesAwaiting] = await Promise.all([
    summarize({}),
    summarize(where),
    prisma.leadSignal.findMany({ where: { signalDate: { gte: sevenDaysAgo } }, distinct: ['leadId'], select: { leadId: true } }).then(r => r.length),
    prisma.reply.count({ where: { actionedAt: null } }),
  ]);

  res.json({
    global: { ...global, signals7d, repliesAwaitingTriage: repliesAwaiting },
    inFilter: { ...inFilter },
  });
});
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/api/routes/leads.js tests/api/leads.kpis.test.js
git commit -m "feat(api): /leads/kpis endpoint with global + filter-scoped counters"
```

### Task 3.6: GET /api/leads/facets

**Files:**
- Modify: `src/api/routes/leads.js`
- Add facet test to `tests/api/leads.filters.test.js`

- [ ] **Step 1: Write failing test**

```javascript
it('GET /api/leads/facets returns distinct categories/cities/countries', async () => {
  const r = await fetch(`${baseUrl}/api/leads/facets`, { headers: h() });
  const d = await r.json();
  expect(d.categories).toEqual(expect.arrayContaining(['d2c', 'real_estate']));
  expect(d.cities).toEqual(expect.arrayContaining(['Mumbai', 'Bangalore']));
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement (with 60s in-process cache)**

```javascript
let facetsCache = { at: 0, data: null };
router.get('/facets', async (_req, res) => {
  if (facetsCache.data && Date.now() - facetsCache.at < 60_000) return res.json(facetsCache.data);
  const [categories, cities, countries] = await Promise.all([
    prisma.lead.findMany({ where: { category: { not: null } }, distinct: ['category'], select: { category: true } }).then(r => r.map(x => x.category)),
    prisma.lead.findMany({ where: { city: { not: null } }, distinct: ['city'], select: { city: true } }).then(r => r.map(x => x.city)),
    prisma.lead.findMany({ where: { country: { not: null } }, distinct: ['country'], select: { country: true } }).then(r => r.map(x => x.country)),
  ]);
  facetsCache = { at: Date.now(), data: { categories, cities, countries } };
  res.json(facetsCache.data);
});
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/api/routes/leads.js tests/api/leads.filters.test.js
git commit -m "feat(api): /leads/facets endpoint"
```

### Task 3.7: POST /api/leads/bulk/status

**Files:**
- Create: `src/api/routes/leads/bulkStatus.js`
- Modify: `src/api/routes/leads.js`
- Create: `tests/api/leads.bulk.status.test.js`

- [ ] **Step 1: Write failing test**

```javascript
// tests/api/leads.bulk.status.test.js
// (copy setup boilerplate from leads.kpis.test.js)

describe('POST /api/leads/bulk/status', () => {
  it('rejects non-whitelisted action', async () => {
    const r = await fetch(`${baseUrl}/api/leads/bulk/status`, {
      method: 'POST', headers: { ...h(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadIds: [1], action: 'sent' }),
    });
    expect(r.status).toBe(400);
  });

  it('nurture: updates status', async () => {
    const { prisma } = await import('../../src/core/db/index.js');
    const a = await prisma.lead.findFirst({ where: { businessName: 'Alpha' } });
    const r = await fetch(`${baseUrl}/api/leads/bulk/status`, {
      method: 'POST', headers: { ...h(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadIds: [a.id], action: 'nurture' }),
    });
    expect(r.status).toBe(200);
    const d = await r.json();
    expect(d.updated).toBe(1);
    const refreshed = await prisma.lead.findUnique({ where: { id: a.id } });
    expect(refreshed.status).toBe('nurture');
  });

  it('reject: inserts into reject_list + sets in_reject_list=true', async () => {
    const { prisma } = await import('../../src/core/db/index.js');
    const a = await prisma.lead.findFirst({ where: { businessName: 'Alpha' } });
    await prisma.lead.update({ where: { id: a.id }, data: { contactEmail: 'p@alpha.test' } });
    const r = await fetch(`${baseUrl}/api/leads/bulk/status`, {
      method: 'POST', headers: { ...h(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadIds: [a.id], action: 'reject' }),
    });
    expect(r.status).toBe(200);
    const refreshed = await prisma.lead.findUnique({ where: { id: a.id } });
    expect(refreshed.inRejectList).toBe(true);
    expect(refreshed.status).toBe('unsubscribed');
    const reject = await prisma.rejectList.findFirst({ where: { email: 'p@alpha.test' } });
    expect(reject).toBeTruthy();
  });

  it('requeue: skips leads with no pending step-0 email', async () => {
    const { prisma } = await import('../../src/core/db/index.js');
    const a = await prisma.lead.findFirst({ where: { businessName: 'Alpha' } });
    const r = await fetch(`${baseUrl}/api/leads/bulk/status`, {
      method: 'POST', headers: { ...h(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadIds: [a.id], action: 'requeue' }),
    });
    const d = await r.json();
    expect(d.skipped).toContainEqual({ id: a.id, reason: 'no_pending_email' });
  });

  it('requeue: succeeds when pending email row exists', async () => {
    const { prisma } = await import('../../src/core/db/index.js');
    const a = await prisma.lead.findFirst({ where: { businessName: 'Alpha' } });
    await prisma.email.create({ data: { leadId: a.id, sequenceStep: 0, status: 'pending' } });
    const r = await fetch(`${baseUrl}/api/leads/bulk/status`, {
      method: 'POST', headers: { ...h(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadIds: [a.id], action: 'requeue' }),
    });
    expect((await r.json()).updated).toBe(1);
    const refreshed = await prisma.lead.findUnique({ where: { id: a.id } });
    expect(refreshed.status).toBe('ready');
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Create `src/api/routes/leads/bulkStatus.js`**

```javascript
// src/api/routes/leads/bulkStatus.js
import { prisma } from '../../../core/db/index.js';

const ALLOWED = new Set(['nurture', 'unsubscribed', 'reject', 'requeue']);
const TERMINAL = new Set(['bounced', 'replied']);

export async function bulkStatus(req, res) {
  const { leadIds, action } = req.body || {};
  if (!ALLOWED.has(action)) return res.status(400).json({ error: 'invalid_action' });
  if (!Array.isArray(leadIds) || leadIds.length === 0) return res.status(400).json({ error: 'no_lead_ids' });
  if (leadIds.length > 200) return res.status(400).json({ error: 'batch_too_large', max: 200 });

  const leads = await prisma.lead.findMany({ where: { id: { in: leadIds } }, include: { emails: { where: { sequenceStep: 0, status: 'pending' }, take: 1 } } });
  const updated = [];
  const skipped = [];

  for (const lead of leads) {
    if (TERMINAL.has(lead.status)) { skipped.push({ id: lead.id, reason: `terminal_${lead.status}` }); continue; }
    if (action === 'nurture') {
      await prisma.lead.update({ where: { id: lead.id }, data: { status: 'nurture' } });
      updated.push(lead.id);
    } else if (action === 'unsubscribed') {
      await prisma.lead.update({ where: { id: lead.id }, data: { status: 'unsubscribed' } });
      updated.push(lead.id);
    } else if (action === 'reject') {
      const domain = lead.contactEmail ? lead.contactEmail.split('@')[1] : null;
      if (lead.contactEmail) {
        await prisma.rejectList.upsert({
          where: { email: lead.contactEmail },
          update: {},
          create: { email: lead.contactEmail, domain, reason: 'manual_bulk_reject' },
        });
      }
      await prisma.lead.update({ where: { id: lead.id }, data: { status: 'unsubscribed', inRejectList: true } });
      updated.push(lead.id);
    } else if (action === 'requeue') {
      if (!lead.emails.length) { skipped.push({ id: lead.id, reason: 'no_pending_email' }); continue; }
      await prisma.lead.update({ where: { id: lead.id }, data: { status: 'ready' } });
      updated.push(lead.id);
    }
  }

  res.json({ updated: updated.length, updatedIds: updated, skipped });
}
```

Note: `rejectList.upsert` requires a unique on `email` — confirm `prisma/schema.prisma` has it. If only `@@index`, switch to `findFirst + create` pattern.

- [ ] **Step 4: Wire into `src/api/routes/leads.js`**

```javascript
import { bulkStatus } from './leads/bulkStatus.js';
router.post('/bulk/status', bulkStatus);
```

- [ ] **Step 5: Run — expect PASS** (`npm test -- bulk.status`)

- [ ] **Step 6: Commit**

```bash
git add src/api/routes/leads/bulkStatus.js src/api/routes/leads.js tests/api/leads.bulk.status.test.js
git commit -m "feat(api): POST /leads/bulk/status with reject_list integration"
```

### Task 3.8: POST /api/leads/bulk/retry — dryRun cost estimator

**Files:**
- Create: `src/api/routes/leads/bulkRetry.js` (just dryRun for this task)
- Modify: `src/api/routes/leads.js`
- Create: `tests/api/leads.bulk.retry.test.js`

- [ ] **Step 1: Write failing test for dryRun**

```javascript
// tests/api/leads.bulk.retry.test.js
// (boilerplate setup)

describe('POST /api/leads/bulk/retry?dry_run=1', () => {
  it('returns count + estimated cost without side effects', async () => {
    const { prisma } = await import('../../src/core/db/index.js');
    const a = await prisma.lead.findFirst({ where: { businessName: 'Alpha' } });
    // seed Email rows so cost averaging has samples
    await prisma.email.createMany({ data: [
      { leadId: a.id, sequenceStep: 0, hookCostUsd: 0.01, bodyCostUsd: 0.005 },
      { leadId: a.id, sequenceStep: 1, hookCostUsd: 0.02, bodyCostUsd: 0.006 },
    ] });
    const r = await fetch(`${baseUrl}/api/leads/bulk/retry?dry_run=1`, {
      method: 'POST', headers: { ...h(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadIds: [a.id], stage: 'regen_hook' }),
    });
    expect(r.status).toBe(200);
    const d = await r.json();
    expect(d.count).toBe(1);
    expect(d.estimated_cost_usd).toBeGreaterThan(0);
    expect(d.estimate_quality).toBe('low'); // < 5 samples
  });

  it('rejects batch > 25', async () => {
    const r = await fetch(`${baseUrl}/api/leads/bulk/retry?dry_run=1`, {
      method: 'POST', headers: { ...h(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadIds: Array.from({ length: 26 }, (_, i) => i + 1), stage: 'regen_hook' }),
    });
    expect(r.status).toBe(400);
    const d = await r.json();
    expect(d.error).toBe('batch_too_large');
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Create `bulkRetry.js` with dryRun handler only**

```javascript
// src/api/routes/leads/bulkRetry.js
import { prisma } from '../../../core/db/index.js';

const STAGES = new Set(['verify_email', 'regen_hook', 'regen_body', 'rescore_icp', 'reextract', 'rejudge']);
const MEV_FALLBACK = Number(process.env.MEV_COST_PER_CALL) || 0.0006;

async function avg(rows, key) {
  const xs = rows.map(r => Number(r[key])).filter(n => Number.isFinite(n) && n > 0);
  return xs.length ? { mean: xs.reduce((a, b) => a + b, 0) / xs.length, count: xs.length } : { mean: 0, count: 0 };
}

export async function estimateCost(stage, n) {
  if (stage === 'verify_email') return { perLead: MEV_FALLBACK, count: 999 };
  if (stage === 'regen_hook' || stage === 'regen_body') {
    const rows = await prisma.email.findMany({ orderBy: { id: 'desc' }, take: 200, select: { hookCostUsd: true, bodyCostUsd: true } });
    const a = await avg(rows, stage === 'regen_hook' ? 'hookCostUsd' : 'bodyCostUsd');
    return { perLead: a.mean, count: a.count };
  }
  // rescore_icp / reextract / rejudge — use Lead.geminiCostUsd as a coarse proxy
  const rows = await prisma.lead.findMany({ where: { geminiCostUsd: { gt: 0 } }, orderBy: { id: 'desc' }, take: 200, select: { geminiCostUsd: true } });
  const a = await avg(rows, 'geminiCostUsd');
  return { perLead: a.mean, count: a.count };
}

export async function bulkRetry(req, res) {
  const { leadIds, stage } = req.body || {};
  if (!STAGES.has(stage)) return res.status(400).json({ error: 'invalid_stage' });
  if (!Array.isArray(leadIds) || leadIds.length === 0) return res.status(400).json({ error: 'no_lead_ids' });
  if (leadIds.length > 25) return res.status(400).json({ error: 'batch_too_large', max: 25 });

  if (req.query.dry_run === '1' || req.query.dry_run === 'true') {
    const est = await estimateCost(stage, leadIds.length);
    const total = est.perLead * leadIds.length;
    return res.json({
      count: leadIds.length,
      estimated_cost_usd: Number(total.toFixed(4)),
      breakdown_by_stage: { [stage]: Number(total.toFixed(4)) },
      estimate_quality: est.count < 5 ? 'low' : 'normal',
    });
  }

  // Real execution lands in Task 3.9.
  return res.status(501).json({ error: 'execution_not_implemented_yet' });
}
```

- [ ] **Step 4: Wire route**

```javascript
import { bulkRetry } from './leads/bulkRetry.js';
router.post('/bulk/retry', bulkRetry);
```

- [ ] **Step 5: Run — expect PASS**

- [ ] **Step 6: Commit**

```bash
git add src/api/routes/leads/bulkRetry.js src/api/routes/leads.js tests/api/leads.bulk.retry.test.js
git commit -m "feat(api): POST /leads/bulk/retry?dry_run with cost estimator"
```

### Task 3.9: bulk/retry execution path with SSE

**Files:**
- Modify: `src/api/routes/leads/bulkRetry.js`
- Modify: `tests/api/leads.bulk.retry.test.js` (add execution tests)

Behavior: when `dry_run` is absent, open SSE response, run each retry sequentially, write `data: <JSON>\n\n` per result.

- [ ] **Step 1: Write failing tests**

```javascript
it('regen_hook: real run updates email row + writes SSE events', async () => {
  // mock the pipeline
  vi.doMock('../../src/core/pipeline/regenerateHook.js', () => ({
    regenerateHook: async () => ({ hook: 'NEW_HOOK', costUsd: 0.001, model: 'mock', hookVariantId: 'A' }),
  }));
  // … set BULK_RETRY_ENABLED=true, run fetch with stream reader, assert events.
});

it('returns 503 when BULK_RETRY_ENABLED is unset', async () => {
  delete process.env.BULK_RETRY_ENABLED;
  const r = await fetch(`${baseUrl}/api/leads/bulk/retry`, {
    method: 'POST', headers: { ...h(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ leadIds: [1], stage: 'regen_hook' }),
  });
  expect(r.status).toBe(503);
});
```

(Full SSE test reads chunks from `r.body.getReader()` and parses each `data:` line. See an existing example or model after the bulk-retry test below.)

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement execution**

In `bulkRetry.js`:

```javascript
import { regenerateHook } from '../../../core/pipeline/regenerateHook.js';
import { regenerateBody } from '../../../core/pipeline/regenerateBody.js';
import { regenerateSubject } from '../../../core/pipeline/regenerateSubject.js';
import { reextract } from '../../../core/pipeline/reextract.js';
import { rescoreIcp } from '../../../core/pipeline/rescoreIcp.js';
import { verifyEmail } from '../../../core/pipeline/verifyEmailLib.js';
// + load offer + persona + niche context once per batch

async function loadCtx() {
  const offer = await prisma.offer.findFirst();
  const icp = await prisma.icpProfile.findFirst();
  const persona = { name: offer?.fromName || 'Operator', role: offer?.role || 'consultant', company: offer?.company || '', services: offer?.services || '', tone: offer?.tone || 'casual' };
  return { persona, icp };
}

async function runStage(stage, lead, ctx) {
  if (stage === 'verify_email') {
    const r = await verifyEmail(lead.contactEmail);
    await prisma.lead.update({ where: { id: lead.id }, data: { emailStatus: r.status, emailVerifiedAt: new Date() } });
    return { costUsd: r.costUsd || 0 };
  }
  if (stage === 'rescore_icp') {
    const r = await rescoreIcp(lead, ctx.icp);
    await prisma.lead.update({ where: { id: lead.id }, data: { icpScore: r.score, icpReason: r.reason, icpBreakdown: r.breakdown, icpKeyMatches: r.keyMatches, icpKeyGaps: r.keyGaps, icpDisqualifiers: r.disqualifiers } });
    return { costUsd: r.costUsd || 0 };
  }
  if (stage === 'regen_hook') {
    const signals = await prisma.leadSignal.findMany({ where: { leadId: lead.id }, orderBy: { confidence: 'desc' }, take: 3 });
    const r = await regenerateHook(lead, ctx.persona, signals);
    // attach to next pending step-0 email row, or create one
    const email = await prisma.email.findFirst({ where: { leadId: lead.id, sequenceStep: 0, status: 'pending' } });
    if (email) await prisma.email.update({ where: { id: email.id }, data: { hookCostUsd: r.costUsd, hookModel: r.model, hookVariantId: r.hookVariantId, body: null } });
    return { costUsd: r.costUsd, hook: r.hook };
  }
  if (stage === 'regen_body') {
    const email = await prisma.email.findFirst({ where: { leadId: lead.id, sequenceStep: 0 }, orderBy: { id: 'desc' } });
    const hook = email?.subject || 'observed your site';
    const r = await regenerateBody(lead, hook, ctx.persona);
    if (email) await prisma.email.update({ where: { id: email.id }, data: { body: r.body, bodyCostUsd: r.costUsd, bodyModel: r.model } });
    return { costUsd: r.costUsd };
  }
  if (stage === 'reextract') {
    const r = await reextract(lead);
    if (r.data) await prisma.lead.update({ where: { id: lead.id }, data: r.data });
    return { costUsd: r.costUsd };
  }
  // rejudge — same as reextract today (judge_reason is one field of stages2to6 output)
  if (stage === 'rejudge') {
    const r = await reextract(lead);
    if (r.data) await prisma.lead.update({ where: { id: lead.id }, data: { judgeReason: r.data.judge_reason, websiteQualityScore: r.data.website_quality_score } });
    return { costUsd: r.costUsd };
  }
}

// Replace the 501 path with:
if (process.env.BULK_RETRY_ENABLED !== 'true') return res.status(503).json({ error: 'bulk_retry_disabled' });

res.setHeader('Content-Type', 'text/event-stream');
res.setHeader('Cache-Control', 'no-cache');
res.setHeader('Connection', 'keep-alive');
const ctx = await loadCtx();
const leads = await prisma.lead.findMany({ where: { id: { in: leadIds } } });
for (const lead of leads) {
  try {
    const r = await runStage(stage, lead, ctx);
    res.write(`data: ${JSON.stringify({ leadId: lead.id, status: 'ok', costUsd: r.costUsd })}\n\n`);
  } catch (err) {
    await prisma.errorLog.create({ data: { source: 'bulk_retry', message: err.message, occurredAt: new Date() } });
    res.write(`data: ${JSON.stringify({ leadId: lead.id, status: 'error', error: err.message })}\n\n`);
  }
}
res.write('data: {"status":"done"}\n\n');
res.end();
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/api/routes/leads/bulkRetry.js tests/api/leads.bulk.retry.test.js
git commit -m "feat(api): bulk/retry execution via SSE behind BULK_RETRY_ENABLED gate"
```

### Task 3.10: Saved-views CRUD

**Files:**
- Create: `src/api/routes/savedViews.js`
- Modify: `src/api/server.js`
- Create: `tests/api/savedViews.test.js`

- [ ] **Step 1: Write failing tests** (CRUD round-trip)

```javascript
// tests/api/savedViews.test.js
// (boilerplate)

describe('saved views CRUD', () => {
  it('full lifecycle', async () => {
    const c = await fetch(`${baseUrl}/api/saved-views`, {
      method: 'POST', headers: { ...h(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'A-tier hot', filtersJson: { icp_priority: 'A', has_signals: '1' }, sort: 'icp_score:desc' }),
    });
    expect(c.status).toBe(201);
    const created = (await c.json()).view;

    const list = await fetch(`${baseUrl}/api/saved-views`, { headers: h() }).then(r => r.json());
    expect(list.views.length).toBe(1);

    const u = await fetch(`${baseUrl}/api/saved-views/${created.id}`, {
      method: 'PATCH', headers: { ...h(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'A-tier renamed' }),
    });
    expect((await u.json()).view.name).toBe('A-tier renamed');

    const d = await fetch(`${baseUrl}/api/saved-views/${created.id}`, { method: 'DELETE', headers: h() });
    expect(d.status).toBe(204);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `src/api/routes/savedViews.js`**

```javascript
import { Router } from 'express';
import { prisma } from '../../core/db/index.js';
const router = Router();

function serialize(v) { return { id: v.id, name: v.name, filtersJson: v.filtersJson, sort: v.sort, updatedAt: v.updatedAt }; }

router.get('/', async (_req, res) => {
  const views = await prisma.savedView.findMany({ orderBy: { updatedAt: 'desc' } });
  res.json({ views: views.map(serialize) });
});

router.post('/', async (req, res) => {
  const { name, filtersJson, sort } = req.body || {};
  if (!name || !filtersJson) return res.status(400).json({ error: 'missing_fields' });
  const v = await prisma.savedView.create({ data: { name, filtersJson, sort: sort || null } });
  res.status(201).json({ view: serialize(v) });
});

router.patch('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const data = {};
  if (req.body.name !== undefined) data.name = req.body.name;
  if (req.body.filtersJson !== undefined) data.filtersJson = req.body.filtersJson;
  if (req.body.sort !== undefined) data.sort = req.body.sort;
  const v = await prisma.savedView.update({ where: { id }, data });
  res.json({ view: serialize(v) });
});

router.delete('/:id', async (req, res) => {
  await prisma.savedView.delete({ where: { id: Number(req.params.id) } });
  res.status(204).end();
});

export default router;
```

- [ ] **Step 4: Mount in `src/api/server.js`**

After other route mounts:

```javascript
import savedViewsRoutes from './routes/savedViews.js';
app.use('/api/saved-views', savedViewsRoutes);
```

- [ ] **Step 5: Run — expect PASS**

- [ ] **Step 6: Commit**

```bash
git add src/api/routes/savedViews.js src/api/server.js tests/api/savedViews.test.js
git commit -m "feat(api): saved views CRUD"
```

### Task 3.11: GET /api/leads/export.csv

**Files:**
- Create: `src/api/routes/leads/csvExport.js`
- Modify: `src/api/routes/leads.js`
- Create: `tests/api/leads.export.test.js`

- [ ] **Step 1: Write failing test**

```javascript
// tests/api/leads.export.test.js
// (boilerplate)

describe('GET /api/leads/export.csv', () => {
  it('streams CSV with header + filtered rows', async () => {
    const r = await fetch(`${baseUrl}/api/leads/export.csv?status=ready&columns=visible`, { headers: h() });
    expect(r.headers.get('content-type')).toMatch(/text\/csv/);
    const text = await r.text();
    const lines = text.trim().split('\n');
    expect(lines[0]).toContain('business_name');
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });

  it('columns=all includes every Lead field', async () => {
    const r = await fetch(`${baseUrl}/api/leads/export.csv?columns=all`, { headers: h() });
    const text = await r.text();
    expect(text.split('\n')[0]).toContain('icp_breakdown');
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

```javascript
// src/api/routes/leads/csvExport.js
const VISIBLE_COLS = ['id','business_name','category','contact_name','contact_email','email_status','icp_score','website_quality_score','status','tech_stack','city','discovered_at'];

function escape(v) {
  if (v == null) return '';
  if (typeof v === 'object') v = JSON.stringify(v);
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function exportCsv(req, res, { where, orderBy, serializeLead, thresholds }) {
  const all = req.query.columns === 'all';
  const cols = all ? null : VISIBLE_COLS;

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="leads.csv"');

  // discover header from first row when columns=all
  let header = null;
  let cursor = 0;
  const PAGE = 200;
  while (true) {
    const { prisma } = await import('../../../core/db/index.js');
    const rows = await prisma.lead.findMany({ where, orderBy, skip: cursor, take: PAGE });
    if (!rows.length) break;
    if (!header) {
      header = all ? Object.keys(serializeLead(rows[0], thresholds)) : cols;
      res.write(header.join(',') + '\n');
    }
    for (const r of rows) {
      const s = serializeLead(r, thresholds);
      res.write(header.map(c => escape(s[c])).join(',') + '\n');
    }
    cursor += rows.length;
    if (rows.length < PAGE) break;
  }
  res.end();
}
```

In `src/api/routes/leads.js`:

```javascript
import { exportCsv } from './leads/csvExport.js';
router.get('/export.csv', async (req, res) => {
  const t = await getThresholds();
  const { where, orderBy } = parseLeadsQuery(req.query, t);
  await exportCsv(req, res, { where, orderBy, serializeLead, thresholds: t });
});
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/api/routes/leads/csvExport.js src/api/routes/leads.js tests/api/leads.export.test.js
git commit -m "feat(api): /leads/export.csv with visible|all column modes"
```

---

## Chunk 4: Frontend cockpit

Goal: refactor `web/src/pages/Leads.jsx` into a composition. Add KPI strip, saved views, expanded filter bar, bulk action bar, sortable + selectable table. Keep existing detail panel.

### File structure

| File | Action | Responsibility |
|---|---|---|
| `web/src/pages/Leads.jsx` | rewrite | composition root |
| `web/src/pages/leads/useFiltersFromUrl.js` | create | hook: parses URL → filter state, setters mutate URL |
| `web/src/pages/leads/KpiStrip.jsx` | create | 5 tiles, fetches `/leads/kpis` |
| `web/src/pages/leads/SavedViews.jsx` | create | chips + CRUD modals |
| `web/src/pages/leads/FilterBar.jsx` | create | top row + drawer |
| `web/src/pages/leads/BulkActionBar.jsx` | create | sticky bar + dropdowns |
| `web/src/pages/leads/LeadsTable.jsx` | create | table with checkbox col + sortable headers |
| `web/src/pages/leads/LeadDetailPanel.jsx` | create | extracted from current Leads.jsx |
| `web/src/api.js` | modify | add new API methods |
| `web/src/pages/leads/useFiltersFromUrl.test.jsx` | create | URL ⇄ state |
| `web/src/pages/leads/BulkActionBar.test.jsx` | create | selection state |

### Task 4.1: Extend `web/src/api.js` with new methods

- [ ] **Step 1: Add to the `api` export object**

```javascript
leadKpis:        (params = '') => request(`/leads/kpis${params}`),
leadFacets:      ()             => request('/leads/facets'),
bulkLeadStatus:  (body)         => request('/leads/bulk/status', { method: 'POST', body: JSON.stringify(body) }),
bulkLeadRetryDryRun: (body)     => request('/leads/bulk/retry?dry_run=1', { method: 'POST', body: JSON.stringify(body) }),
// streamed retry handled inline (fetch + reader) in component, not via api.js helper
exportLeadsCsv:  (params, columns) => {
  const token = localStorage.getItem('radar_token');
  return fetch(`/api/leads/export.csv${params}${params.includes('?') ? '&' : '?'}columns=${columns}`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then(async res => {
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `leads-${Date.now()}.csv`;
    a.click(); URL.revokeObjectURL(url);
  });
},
listSavedViews:  ()             => request('/saved-views'),
createSavedView: (body)         => request('/saved-views', { method: 'POST', body: JSON.stringify(body) }),
updateSavedView: (id, body)     => request(`/saved-views/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
deleteSavedView: (id)           => request(`/saved-views/${id}`, { method: 'DELETE' }),
```

- [ ] **Step 2: Commit**

```bash
git add web/src/api.js
git commit -m "feat(web): extend api client for cockpit endpoints"
```

### Task 4.2: useFiltersFromUrl hook (TDD)

**Files:**
- Create: `web/src/pages/leads/useFiltersFromUrl.js`
- Create: `web/src/pages/leads/useFiltersFromUrl.test.jsx`

- [ ] **Step 1: Write failing test**

```jsx
// web/src/pages/leads/useFiltersFromUrl.test.jsx
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFiltersFromUrl } from './useFiltersFromUrl';

beforeEach(() => { window.history.replaceState({}, '', '/'); });

describe('useFiltersFromUrl', () => {
  it('parses URL into filters', () => {
    window.history.replaceState({}, '', '/?status=ready&status=queued&search=acme&icp_priority=A');
    const { result } = renderHook(() => useFiltersFromUrl());
    expect(result.current.filters.status).toEqual(['ready', 'queued']);
    expect(result.current.filters.search).toBe('acme');
    expect(result.current.filters.icp_priority).toEqual(['A']);
  });

  it('setFilter updates URL', () => {
    const { result } = renderHook(() => useFiltersFromUrl());
    act(() => result.current.setFilter('status', ['ready']));
    expect(window.location.search).toContain('status=ready');
  });

  it('clearFilters resets URL', () => {
    window.history.replaceState({}, '', '/?status=ready');
    const { result } = renderHook(() => useFiltersFromUrl());
    act(() => result.current.clearFilters());
    expect(window.location.search).toBe('');
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`cd web && npm test -- useFiltersFromUrl`)

- [ ] **Step 3: Implement hook**

```javascript
// web/src/pages/leads/useFiltersFromUrl.js
import { useCallback, useEffect, useState } from 'react';

const MULTI = new Set(['status','category','city','country','email_status','icp_priority','tech_stack','signal_type','business_stage','employees_estimate']);

function parse() {
  const sp = new URLSearchParams(window.location.search);
  const obj = {};
  for (const [k, v] of sp.entries()) {
    if (MULTI.has(k)) obj[k] = sp.getAll(k);
    else obj[k] = v;
  }
  return obj;
}

function serialize(obj) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) continue;
    if (Array.isArray(v)) v.forEach(x => sp.append(k, x));
    else sp.set(k, String(v));
  }
  return sp.toString();
}

export function useFiltersFromUrl() {
  const [filters, setFilters] = useState(parse);

  useEffect(() => {
    const onpop = () => setFilters(parse());
    window.addEventListener('popstate', onpop);
    return () => window.removeEventListener('popstate', onpop);
  }, []);

  const push = useCallback((next) => {
    const qs = serialize(next);
    window.history.pushState({}, '', qs ? `?${qs}` : window.location.pathname);
    setFilters(next);
  }, []);

  return {
    filters,
    setFilter: (k, v) => push({ ...filters, [k]: v }),
    setMany: (patch) => push({ ...filters, ...patch }),
    clearFilters: () => push({}),
  };
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/leads/useFiltersFromUrl.js web/src/pages/leads/useFiltersFromUrl.test.jsx
git commit -m "feat(web): useFiltersFromUrl hook driving URL state"
```

### Task 4.3: KpiStrip component

**Files:**
- Create: `web/src/pages/leads/KpiStrip.jsx`

(Skeleton — no test required; visual surface; tested via smoke.)

- [ ] **Step 1: Implement**

```jsx
// web/src/pages/leads/KpiStrip.jsx
import React, { useEffect, useState } from 'react';
import { api } from '../../api';

export default function KpiStrip({ filterParams }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    api.leadKpis(filterParams).then(setData).catch(() => setData(null));
  }, [filterParams]);

  if (!data) return null;
  const { global: g, inFilter: f } = data;
  const fmt = (gv, fv) => filterParams && filterParams !== '?' ? `${gv} · ${fv}` : `${gv}`;

  return (
    <div className="kpi-strip">
      <Tile title="Total leads" value={fmt(g.total, f.total)} />
      <Tile title="A / B / C" value={`${g.icpA} / ${g.icpB} / ${g.icpC}`} sub={`in filter: ${f.icpA} / ${f.icpB} / ${f.icpC}`} />
      <Tile title="Ready to send" value={fmt(g.readyToSend, f.readyToSend)} />
      <Tile title="Signals (7d)" value={String(g.signals7d)} />
      <Tile title="Replies awaiting" value={String(g.repliesAwaitingTriage)} />
    </div>
  );
}

function Tile({ title, value, sub }) {
  return (
    <div className="kpi-tile">
      <div className="kpi-title">{title}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}
```

Add CSS for `.kpi-strip`, `.kpi-tile`, `.kpi-title`, `.kpi-value`, `.kpi-sub` in `web/src/index.css`.

- [ ] **Step 2: Commit**

```bash
git add web/src/pages/leads/KpiStrip.jsx web/src/index.css
git commit -m "feat(web): KpiStrip component"
```

### Task 4.4: FilterBar component (top row + drawer)

**Files:**
- Create: `web/src/pages/leads/FilterBar.jsx`

- [ ] **Step 1: Implement** — composition of search input, multi-select dropdowns for status/icp_priority/email_status, date range, and a `More filters ▾` button that toggles a drawer with the rest. Use existing `<select>` and `<input>` styles plus a small multi-select utility (a checkbox dropdown).

Key requirements:
- Calls `setFilter(key, value)` on every change.
- Loads facets via `api.leadFacets()` once on mount for category/city/country dropdowns.
- The drawer is collapsible — state in component-local `useState`.

(Implementation skeleton ~150 lines; follow the existing `web/src/pages/Engines.jsx` pattern for component structure.)

- [ ] **Step 2: Manual smoke** — `cd web && npm run dev`, open `/outreach/leads`, click each filter, confirm URL updates and table refetches.

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/leads/FilterBar.jsx
git commit -m "feat(web): FilterBar with top row + collapsible drawer"
```

### Task 4.5: SavedViews component

**Files:**
- Create: `web/src/pages/leads/SavedViews.jsx`

Behavior:
- Loads `api.listSavedViews()` on mount.
- Renders chips; click applies `view.filtersJson` via `setMany()` + `view.sort` via `setFilter('sort', ...)`.
- `★ Save current view` button opens a name dialog → POST.
- Hover on a chip reveals pencil (rename → PATCH) and trash (delete → DELETE).

- [ ] **Step 1: Implement** (skeleton)
- [ ] **Step 2: Manual smoke** — save a view, refresh, click chip, confirm filter applied.
- [ ] **Step 3: Commit**

```bash
git add web/src/pages/leads/SavedViews.jsx
git commit -m "feat(web): SavedViews chips with create/rename/delete"
```

### Task 4.6: LeadsTable with checkbox + sortable headers

**Files:**
- Create: `web/src/pages/leads/LeadsTable.jsx`

- [ ] **Step 1: Implement** (lift the table JSX from current `Leads.jsx`, add):
  - Leading checkbox column with "select all on page" header checkbox.
  - Click on sortable header (`ICP`, `Quality`, `Date`) cycles asc/desc/off via `setFilter('sort', …)`.
  - Dense/comfortable toggle in a header bar above the table; persists to localStorage.
  - Selection state stored in parent (`Leads.jsx`) via `useState([])`.

- [ ] **Step 2: Commit**

```bash
git add web/src/pages/leads/LeadsTable.jsx
git commit -m "feat(web): LeadsTable with selection + sortable headers"
```

### Task 4.7: BulkActionBar

**Files:**
- Create: `web/src/pages/leads/BulkActionBar.jsx`
- Create: `web/src/pages/leads/BulkActionBar.test.jsx`

- [ ] **Step 1: Write component test**

```jsx
// web/src/pages/leads/BulkActionBar.test.jsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import BulkActionBar from './BulkActionBar';

describe('BulkActionBar', () => {
  it('hidden when no leads selected', () => {
    const { container } = render(<BulkActionBar selectedIds={[]} onAction={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows selection count', () => {
    render(<BulkActionBar selectedIds={[1, 2, 3]} onAction={() => {}} />);
    expect(screen.getByText(/3 selected/i)).toBeInTheDocument();
  });

  it('calls onAction with status:nurture when clicked', () => {
    const onAction = vi.fn();
    render(<BulkActionBar selectedIds={[1]} onAction={onAction} />);
    fireEvent.click(screen.getByText(/Mark as nurture/i));
    expect(onAction).toHaveBeenCalledWith({ kind: 'status', action: 'nurture' });
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

```jsx
// web/src/pages/leads/BulkActionBar.jsx
import React, { useState } from 'react';

export default function BulkActionBar({ selectedIds, onAction }) {
  const [retryOpen, setRetryOpen] = useState(false);
  if (selectedIds.length === 0) return null;
  return (
    <div className="bulk-bar">
      <span>{selectedIds.length} selected</span>
      <button onClick={() => onAction({ kind: 'status', action: 'nurture' })}>Mark as nurture</button>
      <button onClick={() => onAction({ kind: 'status', action: 'unsubscribed' })}>Mark as unsubscribed</button>
      <button onClick={() => onAction({ kind: 'status', action: 'reject' })}>Add to reject list</button>
      <button onClick={() => onAction({ kind: 'status', action: 'requeue' })}>Send back to ready</button>
      <div className="retry-dropdown">
        <button onClick={() => setRetryOpen(!retryOpen)}>Retry ▾</button>
        {retryOpen && (
          <ul>
            {['verify_email','regen_hook','regen_body','rescore_icp','reextract','rejudge'].map(s => (
              <li key={s}><button onClick={() => onAction({ kind: 'retry', stage: s })}>{s}</button></li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/leads/BulkActionBar.jsx web/src/pages/leads/BulkActionBar.test.jsx
git commit -m "feat(web): BulkActionBar with status + retry actions"
```

### Task 4.8: Wire it all together — rewrite Leads.jsx

**Files:**
- Rewrite: `web/src/pages/Leads.jsx`
- Create: `web/src/pages/leads/LeadDetailPanel.jsx` (extracted from old Leads.jsx)

- [ ] **Step 1: Extract detail panel** — move the `selectedLead && (<>...</>)` block from current `Leads.jsx` into `LeadDetailPanel.jsx` as a default export taking `{ lead, detailData, onClose, onSaveNote }`.

- [ ] **Step 2: Rewrite `Leads.jsx`**

```jsx
// web/src/pages/Leads.jsx
import React, { useEffect, useState, useMemo } from 'react';
import { api } from '../api';
import { useFiltersFromUrl } from './leads/useFiltersFromUrl';
import KpiStrip from './leads/KpiStrip';
import SavedViews from './leads/SavedViews';
import FilterBar from './leads/FilterBar';
import LeadsTable from './leads/LeadsTable';
import BulkActionBar from './leads/BulkActionBar';
import LeadDetailPanel from './leads/LeadDetailPanel';

export default function Leads() {
  const { filters, setFilter, setMany, clearFilters } = useFiltersFromUrl();
  const [leads, setLeads] = useState([]);
  const [total, setTotal] = useState(0);
  const [selectedIds, setSelectedIds] = useState([]);
  const [detailLead, setDetailLead] = useState(null);
  const [detailData, setDetailData] = useState(null);
  const [page, setPage] = useState(1);

  const queryString = useMemo(() => {
    const sp = new URLSearchParams(window.location.search);
    sp.set('page', String(page));
    sp.set('limit', '25');
    return `?${sp.toString()}`;
  }, [filters, page]);

  useEffect(() => {
    api.leads(queryString).then(d => { setLeads(d?.leads || []); setTotal(d?.total || 0); });
  }, [queryString]);

  async function handleBulk(action) {
    if (action.kind === 'status') {
      await api.bulkLeadStatus({ leadIds: selectedIds, action: action.action });
      setSelectedIds([]);
      // refetch
      const d = await api.leads(queryString); setLeads(d?.leads || []); setTotal(d?.total || 0);
    } else if (action.kind === 'retry') {
      const dry = await api.bulkLeadRetryDryRun({ leadIds: selectedIds, stage: action.stage });
      const ok = window.confirm(`Estimated cost: $${dry.estimated_cost_usd} (${dry.estimate_quality}). Proceed?`);
      if (!ok) return;
      // streamed retry — open SSE + show progress
      await runStreamedRetry(selectedIds, action.stage, () => {
        // on each event: refetch this lead
      });
      setSelectedIds([]);
    }
  }

  return (
    <div>
      <h1 className="page-title">Lead Pipeline</h1>
      <KpiStrip filterParams={queryString} />
      <SavedViews onApply={(view) => setMany(view.filtersJson)} currentFilters={filters} />
      <FilterBar filters={filters} setFilter={setFilter} clearFilters={clearFilters} />
      <BulkActionBar selectedIds={selectedIds} onAction={handleBulk} />
      <LeadsTable
        leads={leads}
        selectedIds={selectedIds}
        onToggleSelect={(id) => setSelectedIds(s => s.includes(id) ? s.filter(x => x !== id) : s.concat(id))}
        onToggleSelectAll={() => setSelectedIds(s => s.length === leads.length ? [] : leads.map(l => l.id))}
        sort={filters.sort}
        onSort={(s) => setFilter('sort', s)}
        onOpenDetail={(lead) => { setDetailLead(lead); api.lead(lead.id).then(setDetailData); }}
      />
      {/* pagination */}
      {detailLead && (
        <LeadDetailPanel lead={detailLead} detailData={detailData} onClose={() => { setDetailLead(null); setDetailData(null); }} />
      )}
    </div>
  );
}

async function runStreamedRetry(leadIds, stage, onEvent) {
  const token = localStorage.getItem('radar_token');
  const r = await fetch('/api/leads/bulk/retry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ leadIds, stage }),
  });
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const line = buf.slice(0, idx).replace(/^data:\s*/, '');
      buf = buf.slice(idx + 2);
      try { onEvent(JSON.parse(line)); } catch {}
    }
  }
}
```

- [ ] **Step 3: Manual smoke** — visit `/outreach/leads`, exercise each path: search, A/B/C filter, save view, bulk nurture, bulk retry dry-run, CSV export.

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/Leads.jsx web/src/pages/leads/LeadDetailPanel.jsx
git commit -m "feat(web): wire decision cockpit pieces in Leads page"
```

---

## Chunk 5: Polish + smoke

### Task 5.1: Add CSV export button to UI

- [ ] Place split-button next to filter clear-all that calls `api.exportLeadsCsv(queryString, 'visible')` or `'all'`.
- [ ] Manual smoke: download both flavors, open in spreadsheet.
- [ ] Commit: `feat(web): CSV export split-button`

### Task 5.2: Document BULK_RETRY_ENABLED + cockpit

- [ ] Add a one-paragraph section to `CLAUDE.md` §3 (Environment Variables) documenting `BULK_RETRY_ENABLED`.
- [ ] Add a brief "Decision Cockpit" subsection to `CLAUDE.md` §6 (Dashboard).
- [ ] Commit: `docs: BULK_RETRY_ENABLED env + cockpit overview`

### Task 5.3: End-to-end smoke checklist

- [ ] Login → `/outreach/leads`.
- [ ] Apply each filter; URL reflects state; reload page; state persists.
- [ ] Save view "A-tier hot" with `icp_priority=A&has_signals=1&sort=icp_score:desc`. Reload, click chip, confirm filter applies.
- [ ] Click 3 rows → bulk action bar appears. `Mark as nurture`. Confirm DB updated.
- [ ] Select 2 leads → `Retry ▾` → `regen_hook`. Confirm `dry_run` shows cost + quality. Cancel.
- [ ] Set `BULK_RETRY_ENABLED=true`, retry: confirm SSE events stream, table refetches, costs logged in `daily_metrics`.
- [ ] CSV export `visible` and `all`. Open in spreadsheet, sanity check.
- [ ] `npm test` — all green.

---

## Notes for the executing agent

- The plan is structured around vertical slices that ship a feature per task. Resist horizontal sequencing (do not do "all backend first", "all frontend later").
- When a task says "rewrite Leads.jsx", do NOT delete the existing file before extracting LeadDetailPanel — that lifts work in-place.
- If `prisma.rejectList.upsert` fails (unique constraint missing), fall back to `findFirst` + `create` and add an issue note.
- If `daily_metrics` cost columns are empty in test fixtures, `estimate_quality: 'low'` is correct — don't backfill data.
- Plan uses YAGNI on column picker, soft-delete, BullMQ, multi-tenancy. Don't add them.
