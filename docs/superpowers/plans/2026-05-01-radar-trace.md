# Radar Trace Phase 1A Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Radar Trace — a structured digital-footprint collection layer with ~40 ToS-clean adapters across 9 modules — by `git mv`-ing the existing `radar-enrich` validation prototype, refactoring its 4 module-level adapters into 11 per-source adapters, and adding ~29 new adapters across 6 sub-phases over ~6 weeks.

(Note: spec §13.1 says "10 sub-adapters" — the actual number after the per-source split is 11 (2 hiring + 4 product + 2 customer + 3 operational). The plan reflects the post-split count of 11; spec §13.1's "10" predates the granularity refinement of `product.*`. The two figures don't conflict — both are correct per the more granular `product.github_org` + `github_events` + `github_releases` + `changelog` split.)

**Architecture:** Standalone TypeScript package at `tools/radar-trace/` (renamed from `tools/radar-enrich/`). Per-source adapter contract with new fields (`module`, `gate`, `cacheTtlMs`, `estimatedCostInr`). Two-wave orchestrator — Wave 1 = ungated adapters in parallel, Wave 2 = gated adapters with `gate(partialDossier)` predicates evaluated against Wave 1 results. Output is a flat `adapters` map + `modules` pointer block, no AI synthesis (`signalSummary: null`). Cost tracked in INR primary with USD breakdown for Apify-paid scrapers.

**Tech Stack:** TypeScript 5 (NodeNext, strict), Node 20+, `commander`, `zod`, `p-limit`, `pino`, `cheerio`, native `fetch`, `node:dns/promises`, `node:crypto`. New shared clients: `SerperClient`, `BraveClient`, `ApifyClient`. Tests with `vitest`, no real network.

**Spec:** [docs/superpowers/specs/2026-05-01-radar-trace-design.md](../specs/2026-05-01-radar-trace-design.md)

**Reference skills:**
- @superpowers:test-driven-development — every adapter is test-first
- @superpowers:verification-before-completion — never claim done without seeing tests pass

---

## File Structure

Files this plan creates or modifies, with one-line responsibility each. Numbers in brackets indicate the chunk that touches them.

### Existing files to refactor / modify (Chunk 1)

| Path | Responsibility | Touched by |
|---|---|---|
| `tools/radar-trace/package.json` | Renamed package; same deps + new ones (`undici`/RDAP, etc. added later) | [1] |
| `tools/radar-trace/src/types.ts` | Adds `module`, `gate`, `cacheTtlMs`, `estimatedCostInr`, `PartialDossier`, `Company`, `ModuleName` | [1] |
| `tools/radar-trace/src/schemas.ts` | New `RadarTraceDossierSchema` matching §6 of spec; `totalCostBreakdown` shape; `radarTraceVersion` field | [1] |
| `tools/radar-trace/src/orchestrator.ts` | Two-wave execution, `gate()` evaluation, `partialDossier` construction | [1] |
| `tools/radar-trace/src/cli.ts` | Wires new orchestrator output shape; adapter resolution by module + dotted name | [1, 6] |
| `tools/radar-trace/src/cache.ts` | Per-adapter `cacheTtlMs` override via mtime check | [1] |

### Existing adapters to split (Chunk 1)

| Old file | Splits into |
|---|---|
| `src/adapters/hiring.ts` | `src/adapters/hiring/adzuna.ts` + `src/adapters/hiring/careers.ts` |
| `src/adapters/product.ts` | `src/adapters/product/githubOrg.ts` + `githubEvents.ts` + `githubReleases.ts` + `changelog.ts` |
| `src/adapters/customer.ts` | `src/adapters/customer/logosCurrent.ts` + `waybackDiff.ts` |
| `src/adapters/operational.ts` | `src/adapters/operational/techStack.ts` + `crtsh.ts` + `dns.ts` |

### Files to delete (Chunk 1)

- `src/adapters/voice.stub.ts` (replaced in Chunk 3)
- `src/adapters/positioning.stub.ts` (replaced in Chunk 3)
- `src/synthesis/contextMapper.ts` (Phase 2 — re-introduced later)
- `src/synthesis/hookGenerator.ts` (Phase 2)
- `tests/synthesis/*` (Phase 2 — all synthesis tests removed)

### New adapters by chunk

| Chunk | Module | Adapter file (under `src/adapters/`) |
|---|---|---|
| [2] | product | `product/rss.ts` |
| [2] | product | `product/sitemap.ts` |
| [2] | operational | `operational/pagespeed.ts` |
| [2] | operational | `operational/httpHeaders.ts` |
| [2] | operational | `operational/robotsTxt.ts` |
| [2] | operational | `operational/whois.ts` |
| [3] | voice | `voice/founderLinkedinUrl.ts` |
| [3] | voice | `voice/founderGithubUrl.ts` |
| [3] | voice | `voice/linkedinPulse.ts` |
| [3] | voice | `voice/podcastAppearances.ts` |
| [3] | voice | `voice/youtubeChannel.ts` |
| [3] | positioning | `positioning/crunchbaseSnippet.ts` |
| [3] | positioning | `positioning/braveNews.ts` |
| [3] | positioning | `positioning/serperNews.ts` |
| [3] | ads | `ads/metaLibraryUrl.ts` |
| [3] | ads | `ads/googleTransparencyUrl.ts` |
| [3] | social | `social/links.ts` |
| [4] | directories | `directories/zaubacorp.ts` |
| [4] | directories | `directories/ambitionbox.ts` |
| [4] | directories | `directories/crunchbaseUrl.ts` |
| [4] | directories | `directories/linkedinCompanyApify.ts` |
| [4] | directories | `directories/g2Capterra.ts` (gated) |
| [4] | directories | `directories/glassdoorApify.ts` (gated) |
| [5] | voice | `voice/linkedinPostsApify.ts` |
| [5] | social | `social/twitterPostsApify.ts` |
| [5] | social | `social/instagramPostsApify.ts` |
| [5] | social | `social/facebookPostsApify.ts` |
| [5] | ads | `ads/metaCreativesApify.ts` |
| [5] | ads | `ads/googleCreativesApify.ts` |

### New shared clients

| Path | Responsibility | Chunk |
|---|---|---|
| `tools/radar-trace/src/clients/serper.ts` | Serper REST client; site-search helper | [3] |
| `tools/radar-trace/src/clients/brave.ts` | Brave Search REST client; news endpoint helper | [3] |
| `tools/radar-trace/src/clients/apify.ts` | Apify REST client (`run-sync-get-dataset-items`); cost tracking | [4] |

---

## Chunk 1: Sub-phase 1A.1.A — Rename + additive types + new schema + cache TTL

This chunk does **only additive changes** to the type/schema/cache layer — nothing breaks. New fields are added to `Adapter<T>` as **optional**, new types (`Company`, `PartialDossier`, `ModuleName`) are added alongside existing ones, the new `RadarTraceDossierSchema` is added next to (not replacing) `EnrichedDossierSchema`, and `Cache.read()` gains an optional `ttlMs` parameter. **Adapters, orchestrator, and CLI are NOT touched** — they continue to compile and test against the existing types and shape.

Chunk 2 makes the new fields required, removes the old shape, and refactors adapters/orchestrator/cli in one breaking pass.

**End state of chunk:** `npm test && npm run typecheck` green. Test count stays at 143. New types/schema/cache features exist but are not yet consumed by adapters or cli — that happens in Chunk 2.

### Task 1.1: Rename directory + package

**Files:**
- Rename: `tools/radar-enrich/` → `tools/radar-trace/`
- Modify: `tools/radar-trace/package.json`
- Modify: `tools/radar-trace/.env.example`
- Modify: `tools/radar-trace/README.md`

- [ ] **Step 1: Rename directory via git**

```bash
git mv tools/radar-enrich tools/radar-trace
```

- [ ] **Step 2: Update package.json — rename `name` and `bin`**

Edit `tools/radar-trace/package.json`:
- Change `"name": "radar-enrich"` → `"name": "radar-trace"`
- Change `"bin": { "radar-enrich": "./dist/cli.js" }` → `"bin": { "radar-trace": "./dist/cli.js" }`
- Update `"description"` to `"Structured digital-footprint collection for Radar (Phase 1A — data only)"`

- [ ] **Step 3: Update .env.example with placeholder for new env vars**

Append to `tools/radar-trace/.env.example`:

```env
# Phase 1A — added in chunks 3-5; leave blank if not yet wired
SERPER_API_KEY=                # Modules 4 (voice) + 6 (positioning)
BRAVE_API_KEY=                 # Module 6 (positioning)
LISTEN_NOTES_KEY=              # Module 4 (voice) — free tier 1k/mo
PAGESPEED_API_KEY=             # Module 5 (operational) — optional, free tier works without
APIFY_TOKEN=                   # Modules 4, 7, 8, 9 (paid scrapers, chunks 4-5)

# Cost-conversion
USD_INR_RATE=84.0              # Override if rate moves materially

# UNUSED IN PHASE 1A — kept for Phase 2 forward-compatibility
ANTHROPIC_API_KEY=
ANTHROPIC_DISABLED=
GEMINI_API_KEY=
```

- [ ] **Step 4: Replace README.md placeholder content**

Replace `tools/radar-trace/README.md` with:

````markdown
# Radar Trace

Structured digital-footprint collection layer for Radar. Phase 1A scope: ~30 ToS-clean data-collection adapters across 9 modules. **No AI synthesis (Phase 2).** **No temporal monitoring (Phase 1.5).**

**Spec:** [docs/superpowers/specs/2026-05-01-radar-trace-design.md](../../docs/superpowers/specs/2026-05-01-radar-trace-design.md)

## Setup

```bash
cd tools/radar-trace
npm install
cp .env.example .env
# fill in keys for the modules you plan to run
```

## Run

```bash
# Validation-cost mode (free + Serper + Brave only; ~₹2/lead)
npm run trace -- --company "Acme Corp" --domain acme.com --skip-paid

# Full trace (all modules including paid Apify; ~₹500-620/lead)
npm run trace -- --company "Acme Corp" --domain acme.com

# Subset of modules
npm run trace -- --company "Acme Corp" --domain acme.com --modules hiring,product,operational

# Subset of adapters (granular)
npm run trace -- --company "Acme Corp" --domain acme.com --adapters hiring.adzuna,operational.crtsh
```

## Test

```bash
npm test          # unit tests, no network
npm run typecheck # tsc --noEmit
```

(README is updated chunk-by-chunk; current state reflects only what's been built so far in Chunk 1.)
````

- [ ] **Step 5: Verify nothing broke from the rename**

```bash
cd tools/radar-trace && npm test 2>&1 | tail -8
```

Expected: 143 tests pass (or close to — some might break due to internal references to "radar-enrich" but those should be cosmetic). If any TEST fails because it asserts the old name in a string, fix the string to "radar-trace" and re-run.

- [ ] **Step 6: Find and replace residual "radar-enrich" string references**

```bash
cd tools/radar-trace && grep -rn "radar-enrich" src tests 2>/dev/null
```

Replace any matches (typically in logger messages, README references in test fixtures, or User-Agent strings) with "radar-trace". Re-run `npm test` after.

Common offenders to expect:
- `src/http.ts`: `DEFAULT_UA = 'radar-enrich/0.1 ...'` → `'radar-trace/0.1 ...'`
- Any test fixture with the old name in a body
- Logger child bindings if any reference the package name

- [ ] **Step 7: Commit**

```bash
git add -A tools/radar-trace
git commit -m "chore(radar-trace): rename radar-enrich → radar-trace, update package metadata"
```

---

### Task 1.2: Add new types (additive — no breaking changes)

**Files:**
- Modify: `tools/radar-trace/src/types.ts`
- Modify: `tools/radar-trace/tests/types.test.ts`

The `Adapter<T>` interface gains four **OPTIONAL** new fields (`module?`, `gate?`, `cacheTtlMs?`, `estimatedCostInr?`). New types `PartialDossier`, `Company`, `ModuleName` are added. **The existing `CompanyInput` type stays** — `Company` is added alongside as a type alias. The existing `AdapterResult.costPaise` stays; `costMeta` is added as optional. Chunk 2 makes the new fields required and removes `CompanyInput`.

- [ ] **Step 1: Update test to assert new types exist**

Replace `tools/radar-trace/tests/types.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';
import type {
  Adapter, AdapterResult, AdapterContext, Company, Cache, Logger,
  PartialDossier, ModuleName, Env,
} from '../src/types.js';

describe('types', () => {
  it('exports the expected type names', () => {
    // Compile-time: these will be type errors if any export is missing
    type _Surface = [
      Adapter<unknown>, AdapterResult<unknown>, AdapterContext, Company,
      Cache, Logger, PartialDossier, ModuleName, Env,
    ];
    expect(true).toBe(true);
  });

  it('AdapterStatus literal union covers ok/partial/empty/error', () => {
    const status: AdapterResult<unknown>['status'] = 'ok';
    expect(['ok', 'partial', 'empty', 'error']).toContain(status);
  });

  it('ModuleName covers all 9 modules', () => {
    const names: ModuleName[] = [
      'hiring', 'product', 'customer', 'voice', 'operational',
      'positioning', 'social', 'ads', 'directories',
    ];
    expect(names.length).toBe(9);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd tools/radar-trace && npm test -- types
```

Expected: FAIL — `Company`, `PartialDossier`, `ModuleName` not exported.

- [ ] **Step 3: Update types.ts (additive)**

In `tools/radar-trace/src/types.ts`, **add** the following exports without removing or modifying the existing ones:

```ts
/** Logical groupings — adapters declare which one they belong to. */
export type ModuleName =
  | 'hiring' | 'product' | 'customer' | 'voice' | 'operational'
  | 'positioning' | 'social' | 'ads' | 'directories';

/**
 * New input shape — adds founderLinkedinUrl. Alias of CompanyInput for backward
 * compatibility during the Chunk 1 → Chunk 2 transition. Chunk 2 removes CompanyInput.
 */
export interface Company extends CompanyInput {
  founderLinkedinUrl?: string;
}

/**
 * Read-only snapshot of Wave 1 results for use by Wave 2 gate predicates.
 * Every Wave 1 adapter is present, including ones with status:'error' (payload null)
 * or status:'empty'. Gate predicates MUST defensively handle null payloads.
 */
export type PartialDossier = Readonly<Record<string, AdapterResult<unknown>>>;
```

Modify the existing `Adapter<TPayload>` interface to add four **optional** fields. Do NOT make them required yet — Chunk 2 will tighten them:

```ts
// Existing fields stay unchanged. Add these as optional:

  /** Logical module this adapter belongs to. (Optional during Chunk 1; required after Chunk 2.) */
  readonly module?: ModuleName;

  /** Estimated INR cost per run. Optional during Chunk 1; required after Chunk 2. */
  readonly estimatedCostInr?: number;

  /** Optional per-adapter TTL override; default 24h. */
  readonly cacheTtlMs?: number;

  /**
   * Optional gate. If returns false, adapter is skipped (status:'empty', cost:0).
   * Receives Wave 1 partial dossier. Throws caught and treated as `false`.
   */
  gate?(partial: PartialDossier): boolean;
```

Modify the existing `Cache` interface to make `read()` accept an optional `ttlMs`:

```ts
export interface Cache {
  read<T>(key: CacheKey, ttlMs?: number): Promise<AdapterResult<T> | null>;  // ttlMs added
  write<T>(key: CacheKey, value: AdapterResult<T>): Promise<void>;
  clear(): Promise<void>;
}
```

**Note for test mocks:** Any test file that has an inline `memoryCache()` or similar mock of `Cache` will need its `read` method updated to accept (and ignore) the new `ttlMs` parameter — e.g., `read: async (_key, _ttlMs) => null`. This is source-compatible (TS optional parameters), but if your mock uses strict signature matching it may need a one-line update. Grep for `read: async` and update each.

Modify the existing `AdapterResult<T>` interface to add optional `costMeta`:

```ts
// Existing fields unchanged. Add:
  /** Optional extra cost detail — used by Apify adapters for USD reconciliation. */
  costMeta?: {
    apifyResults?: number;
    costUsd?: number;
  };
```

Add new env keys to `Env` interface (all optional already; just append):

```ts
// Append to Env interface:
  SERPER_API_KEY?: string;
  BRAVE_API_KEY?: string;
  LISTEN_NOTES_KEY?: string;
  PAGESPEED_API_KEY?: string;
  APIFY_TOKEN?: string;
  USD_INR_RATE?: string;
  GEMINI_API_KEY?: string;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd tools/radar-trace && npm test -- types
```

Expected: PASS — 3 assertions green.

- [ ] **Step 5: Run typecheck — must be CLEAN**

```bash
cd tools/radar-trace && npm run typecheck
```

Expected: exits 0. New types are additive; existing adapters still satisfy `Adapter<T>` because the new fields are optional. If typecheck fails, the additive principle was violated — find and fix.

- [ ] **Step 6: Run full test suite**

```bash
cd tools/radar-trace && npm test
```

Expected: 143+ tests pass (the existing 143 plus the 3 new type-export tests).

- [ ] **Step 7: Do NOT commit yet** — schemas + cache also need additive updates in Tasks 1.3-1.4 before we commit Chunk 1.

---

### Task 1.3: Add RadarTraceDossierSchema alongside EnrichedDossierSchema

**Files:**
- Modify: `tools/radar-trace/src/schemas.ts`
- Modify: `tools/radar-trace/tests/schemas.test.ts`

Spec §6 defines the new dossier shape. Add it **alongside** the existing `EnrichedDossierSchema` — Chunk 2 will remove the old one when CLI cuts over.

- [ ] **Step 1: Update test to assert new dossier shape**

Replace `tools/radar-trace/tests/schemas.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';
import {
  CompanySchema,
  AdapterResultSchema,
  RadarTraceDossierSchema,
  ALL_MODULE_NAMES,
} from '../src/schemas.js';

describe('CompanySchema', () => {
  it('parses minimal valid input', () => {
    expect(CompanySchema.safeParse({ name: 'Acme', domain: 'acme.com' }).success).toBe(true);
  });
  it('rejects empty name', () => {
    expect(CompanySchema.safeParse({ name: '', domain: 'acme.com' }).success).toBe(false);
  });
  it('accepts founderLinkedinUrl', () => {
    expect(CompanySchema.safeParse({
      name: 'Acme', domain: 'acme.com', founderLinkedinUrl: 'https://linkedin.com/in/jane',
    }).success).toBe(true);
  });
});

describe('AdapterResultSchema', () => {
  it('parses ok result with costPaise', () => {
    const r = AdapterResultSchema.safeParse({
      source: 'hiring.adzuna', fetchedAt: '2026-05-01T00:00:00.000Z',
      status: 'ok', payload: {}, costPaise: 0, durationMs: 100,
    });
    expect(r.success).toBe(true);
  });
  it('parses ok result with costMeta', () => {
    const r = AdapterResultSchema.safeParse({
      source: 'voice.linkedin_posts_apify', fetchedAt: '2026-05-01T00:00:00.000Z',
      status: 'ok', payload: { posts: [] },
      costPaise: 8400, costMeta: { apifyResults: 47, costUsd: 0.235 },
      durationMs: 5000,
    });
    expect(r.success).toBe(true);
  });
});

describe('ALL_MODULE_NAMES', () => {
  it('contains all 9 modules', () => {
    expect(ALL_MODULE_NAMES).toEqual([
      'hiring', 'product', 'customer', 'voice', 'operational',
      'positioning', 'social', 'ads', 'directories',
    ]);
  });
});

describe('RadarTraceDossierSchema', () => {
  const minimalAdapter = {
    source: 'x.y', fetchedAt: '2026-05-01T00:00:00.000Z',
    status: 'empty', payload: null, costPaise: 0, durationMs: 0,
  };
  const minimalDossier = {
    radarTraceVersion: '1.0.0',
    company: { name: 'Acme', domain: 'acme.com' },
    tracedAt: '2026-05-01T00:00:00.000Z',
    totalCostInr: 0,
    totalCostBreakdown: {
      serper: 0, brave: 0, listenNotes: 0, pagespeed: 0, apifyUsd: 0, apifyInr: 0,
    },
    totalDurationMs: 0,
    adapters: { 'x.y': minimalAdapter },
    modules: {
      hiring: { adapters: [] }, product: { adapters: [] },
      customer: { adapters: [] }, voice: { adapters: [] },
      operational: { adapters: [] }, positioning: { adapters: [] },
      social: { adapters: [] }, ads: { adapters: [] },
      directories: { adapters: [] },
    },
    signalSummary: null,
  };

  it('parses a minimal dossier', () => {
    expect(RadarTraceDossierSchema.safeParse(minimalDossier).success).toBe(true);
  });

  it('rejects dossier missing radarTraceVersion', () => {
    const { radarTraceVersion: _v, ...rest } = minimalDossier;
    expect(RadarTraceDossierSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects dossier missing one of the nine modules', () => {
    const { modules: _m, ...rest } = minimalDossier;
    const broken = { ...rest, modules: { ...minimalDossier.modules, ads: undefined } };
    expect(RadarTraceDossierSchema.safeParse(broken).success).toBe(false);
  });

  it('signalSummary may be null (Phase 1A) or an object (Phase 2 forward-compat)', () => {
    expect(RadarTraceDossierSchema.safeParse({ ...minimalDossier, signalSummary: null }).success).toBe(true);
    expect(RadarTraceDossierSchema.safeParse({ ...minimalDossier, signalSummary: {} }).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd tools/radar-trace && npm test -- schemas
```

Expected: FAIL — `RadarTraceDossierSchema` and `ALL_MODULE_NAMES` not exported.

- [ ] **Step 3: Add the new schema definitions to schemas.ts**

In `tools/radar-trace/src/schemas.ts`, **append** the following exports without touching the existing `EnrichedDossierSchema`, `AdapterResultSchema`, `CompanyInputSchema`, or `SignalSummarySchema`:

```ts
import type { ModuleName } from './types.js';

export const ALL_MODULE_NAMES: readonly ModuleName[] = [
  'hiring', 'product', 'customer', 'voice', 'operational',
  'positioning', 'social', 'ads', 'directories',
] as const;

export const CompanySchema = z.object({
  name: z.string().min(1),
  domain: z.string().min(1),
  location: z.string().optional(),
  founder: z.string().optional(),
  founderLinkedinUrl: z.string().url().optional(),
});

// Note: AdapterResultSchema already exists from Chunk 0 (radar-enrich). We add
// costMeta as an optional field via .extend() rather than replacing the export.
// In Chunk 2 we'll consolidate.
export const AdapterResultSchemaV2 = AdapterResultSchema.extend({
  costMeta: z.object({
    apifyResults: z.number().int().nonnegative().optional(),
    costUsd: z.number().nonnegative().optional(),
  }).optional(),
});

const TotalCostBreakdownSchema = z.object({
  serper: z.number().nonnegative(),
  brave: z.number().nonnegative(),
  listenNotes: z.number().nonnegative(),
  pagespeed: z.number().nonnegative(),
  apifyUsd: z.number().nonnegative(),
  apifyInr: z.number().nonnegative(),
});

const ModuleBlockSchema = z.object({
  adapters: z.array(z.string()),
});

const ModulesSchema = z.object(
  Object.fromEntries(ALL_MODULE_NAMES.map((n) => [n, ModuleBlockSchema])) as
    Record<ModuleName, typeof ModuleBlockSchema>,
);

/** Phase 2 deliverable; Phase 1A allows null. Accepts unknown object for forward-compat. */
const SignalSummarySchema = z.union([z.null(), z.record(z.unknown())]);

// Declare BEFORE RadarTraceDossierSchema (which references it).
// V2 distinguished from existing module-level SignalSummarySchema (which has
// stricter Phase 2 fields); the V2 variant accepts null OR any object,
// deliberately permissive for Phase 1A forward-compat. Chunk 2 consolidates.
const SignalSummarySchemaV2 = z.union([z.null(), z.record(z.unknown())]);

export const RadarTraceDossierSchema = z.object({
  radarTraceVersion: z.string(),
  company: CompanySchema,
  tracedAt: z.string(),
  totalCostInr: z.number().nonnegative(),
  totalCostBreakdown: TotalCostBreakdownSchema,
  totalDurationMs: z.number().int().nonnegative(),
  adapters: z.record(z.string(), AdapterResultSchemaV2),
  modules: ModulesSchema,
  signalSummary: SignalSummarySchemaV2,
});

export type RadarTraceDossier = z.infer<typeof RadarTraceDossierSchema>;
```

(`SignalSummarySchemaV2` is a fresh local — declared before `RadarTraceDossierSchema` so the reference resolves at module-load time. Chunk 2 consolidates by removing the old `SignalSummarySchema` and renaming V2 to the canonical name.)

- [ ] **Step 4: Run tests + typecheck to verify everything is green**

```bash
cd tools/radar-trace && npm test && npm run typecheck
```

Expected: tests pass (existing 143 + new schema tests), typecheck clean.

- [ ] **Step 5: Do NOT commit yet** — cache TTL change is next in Task 1.4.

---

### Task 1.4: Update cache.ts for per-adapter TTL

**Files:**
- Modify: `tools/radar-trace/src/cache.ts`
- Modify: `tools/radar-trace/tests/cache.test.ts`

Per spec §8, cache `read()` accepts an optional `ttlMs`. If file mtime is older than `Date.now() - ttlMs`, treat as missing.

- [ ] **Step 1: Add a failing test for the TTL behavior**

Append to `tools/radar-trace/tests/cache.test.ts`:

```ts
import { utimesSync } from 'node:fs';
import { join } from 'node:path';

describe('createFileCache TTL', () => {
  it('respects per-call ttlMs override (returns null if mtime older than TTL)', async () => {
    const cache = createFileCache(dir);
    await cache.write(sampleKey, sampleResult);
    // Manually backdate the file's mtime by 2 hours
    const filename = `${sampleKey.adapterName}-${sampleKey.inputHash}-${sampleKey.adapterVersion}-${sampleKey.date}.json`;
    const path = join(dir, filename);
    const twoHoursAgo = (Date.now() - 2 * 60 * 60 * 1000) / 1000;
    utimesSync(path, twoHoursAgo, twoHoursAgo);
    // Without ttlMs (or default 24h), still hits
    expect(await cache.read(sampleKey)).toEqual(sampleResult);
    // With ttlMs=1h, miss
    expect(await cache.read(sampleKey, 60 * 60 * 1000)).toBeNull();
    // With ttlMs=3h, hit
    expect(await cache.read(sampleKey, 3 * 60 * 60 * 1000)).toEqual(sampleResult);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd tools/radar-trace && npm test -- cache
```

Expected: FAIL — `read()` ignores the `ttlMs` argument.

- [ ] **Step 3: Update cache.ts to honor ttlMs**

In `tools/radar-trace/src/cache.ts`, update the `Cache.read()` implementation. Replace the `read` method body in `createFileCache`:

```ts
    async read<T>(key: CacheKey, ttlMs?: number): Promise<AdapterResult<T> | null> {
      const path = join(dir, fileNameFor(key));
      try {
        if (ttlMs !== undefined) {
          const stats = await stat(path);
          if (Date.now() - stats.mtimeMs > ttlMs) return null;
        }
        const raw = await readFile(path, 'utf8');
        return JSON.parse(raw) as AdapterResult<T>;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw err;
      }
    },
```

Add `stat` to the `fs/promises` import at top of file:

```ts
import { mkdir, readFile, writeFile, readdir, unlink, stat } from 'node:fs/promises';
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd tools/radar-trace && npm test -- cache
```

Expected: PASS — all 13 cache tests green (12 prior + 1 new).

- [ ] **Step 5: Run full test + typecheck to confirm Chunk 1 is green**

```bash
cd tools/radar-trace && npm test && npm run typecheck
```

Expected: all tests pass (≥143), typecheck clean.

- [ ] **Step 6: Commit Chunk 1**

```bash
git add -A tools/radar-trace
git commit -m "feat(radar-trace): rename + additive type/schema/cache changes (Chunk 1A.1.A)

- git mv tools/radar-enrich → tools/radar-trace
- Update package.json/.env.example/README for new name
- Add ModuleName, Company, PartialDossier types (additive, non-breaking)
- Add optional fields to Adapter<T>: module?, gate?, cacheTtlMs?, estimatedCostInr?
- Add costMeta? to AdapterResult<T>
- Add new env keys (Serper, Brave, Listen Notes, PageSpeed, Apify, USD_INR_RATE)
- Add CompanySchema, RadarTraceDossierSchema, ALL_MODULE_NAMES alongside existing schemas
- Cache.read() accepts optional ttlMs

Existing types/schemas preserved for backward compat — Chunk 2 removes them
when CLI cuts over."
```

---

## Chunk 1 complete checkpoint

After this chunk:
- Package renamed to `radar-trace`
- New types (`Company`, `PartialDossier`, `ModuleName`) and schemas (`RadarTraceDossierSchema`) exist alongside old ones
- `Cache.read()` supports per-call `ttlMs`
- All 143 tests still pass; typecheck clean
- Adapters/orchestrator/cli untouched

Verify before moving on:

```bash
cd tools/radar-trace && npm test && npm run typecheck
```

Both must exit 0. Test count ≥143.

---

## Chunk 2: Sub-phase 1A.1.B — Adapter refactor + orchestrator + CLI cutover

This chunk is the **breaking refactor**. Tasks 1.5-1.7 from the spec collapse into one chunk that:
1. Refactors 4 module-level adapters into 11 per-source adapters
2. Refactors the orchestrator for two-wave execution + frozen `partialDossier`
3. Updates `cli.ts` to use the new dossier shape (`RadarTraceDossierSchema`)
4. Removes old types (`CompanyInput`), old schemas (`EnrichedDossierSchema`), and synthesis layer
5. Makes the four "optional in Chunk 1" Adapter fields required (`module`, `estimatedCostInr`)

**End state of chunk:** all 143+ tests still pass (rewritten as part of refactor); typecheck clean; `radar-trace --company X --domain Y` produces the new dossier shape.

---

### Task 2.1: Refactor existing 4 adapters into per-source granularity (11 sub-adapters)

This is the largest task. We split each module-level adapter into 2-4 per-source adapters. To keep the plan focused, I describe the FIRST split (`hiring`) in full detail; subsequent splits follow the same pattern with file/payload differences.

**Files (created):**
- `tools/radar-trace/src/adapters/hiring/adzuna.ts`
- `tools/radar-trace/src/adapters/hiring/careers.ts`
- `tools/radar-trace/src/adapters/hiring/types.ts` (shared `Job` type)
- `tools/radar-trace/src/adapters/product/githubOrg.ts`
- `tools/radar-trace/src/adapters/product/githubEvents.ts`
- `tools/radar-trace/src/adapters/product/githubReleases.ts`
- `tools/radar-trace/src/adapters/product/changelog.ts`
- `tools/radar-trace/src/adapters/customer/logosCurrent.ts`
- `tools/radar-trace/src/adapters/customer/waybackDiff.ts`
- `tools/radar-trace/src/adapters/operational/techStack.ts`
- `tools/radar-trace/src/adapters/operational/crtsh.ts`
- `tools/radar-trace/src/adapters/operational/dns.ts`

**Files (deleted):**
- `tools/radar-trace/src/adapters/hiring.ts`
- `tools/radar-trace/src/adapters/product.ts`
- `tools/radar-trace/src/adapters/customer.ts`
- `tools/radar-trace/src/adapters/operational.ts`
- `tools/radar-trace/src/adapters/voice.stub.ts`
- `tools/radar-trace/src/adapters/positioning.stub.ts`

**Tests (created):**
- `tools/radar-trace/tests/adapters/hiring/adzuna.test.ts`
- `tools/radar-trace/tests/adapters/hiring/careers.test.ts`
- `tools/radar-trace/tests/adapters/product/githubOrg.test.ts`
- ...etc, one per new adapter file (12 total)

**Tests (deleted):**
- `tools/radar-trace/tests/adapters/hiring.test.ts`
- `tools/radar-trace/tests/adapters/product.test.ts`
- `tools/radar-trace/tests/adapters/customer.test.ts`
- `tools/radar-trace/tests/adapters/operational.test.ts`
- `tools/radar-trace/tests/adapters/stubs.test.ts`

#### Task 2.1.a: Split `hiring` (canonical pattern — read carefully before doing the others)

- [ ] **Step 1: Create the shared `Job` type**

Create `tools/radar-trace/src/adapters/hiring/types.ts`:

```ts
import { z } from 'zod';
import type { FunctionTag, SeniorityTag } from '../../lib/classify.js';

export const JobSchema = z.object({
  source: z.enum(['adzuna', 'careers']),
  title: z.string(),
  location: z.string().nullable(),
  date: z.string().nullable(),
  url: z.string().nullable(),
  function: z.string(),    // FunctionTag, but we accept string for forward-compat
  seniority: z.string(),   // SeniorityTag
});

export type Job = z.infer<typeof JobSchema>;
```

- [ ] **Step 2: Write the failing test for `hiring/adzuna.ts`**

Create `tools/radar-trace/tests/adapters/hiring/adzuna.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hiringAdzunaAdapter } from '../../../src/adapters/hiring/adzuna.js';
import type { AdapterContext } from '../../../src/types.js';

beforeAll(() => vi.useFakeTimers({ now: new Date('2026-05-01T12:00:00Z') }));
afterAll(() => vi.useRealTimers());

const adzunaFixture = JSON.parse(
  readFileSync(join(__dirname, '../../fixtures/hiring/adzuna-acme.json'), 'utf8'),
);

function ctxWith(http: typeof fetch, env = { ADZUNA_APP_ID: 'a', ADZUNA_APP_KEY: 'b' }): AdapterContext {
  const noop = () => {};
  return {
    input: { name: 'Acme Corp', domain: 'acme.com' },
    http,
    cache: { read: async () => null, write: async () => {}, clear: async () => {} },
    logger: { debug: noop, info: noop, warn: noop, error: noop, child: () => ctxWith(http, env).logger },
    env,
    signal: new AbortController().signal,
  };
}

function fakeFetch(routes: Record<string, () => Response>): typeof fetch {
  return (async (url: string | URL | Request) => {
    const u = typeof url === 'string' ? url : url.toString();
    for (const [match, factory] of Object.entries(routes)) {
      if (u.includes(match)) return factory();
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

describe('hiringAdzunaAdapter', () => {
  it('exposes new contract fields', () => {
    expect(hiringAdzunaAdapter.name).toBe('hiring.adzuna');
    expect(hiringAdzunaAdapter.module).toBe('hiring');
    expect(hiringAdzunaAdapter.requiredEnv).toEqual(['ADZUNA_APP_ID', 'ADZUNA_APP_KEY']);
    expect(hiringAdzunaAdapter.estimatedCostInr).toBe(0);
    expect(hiringAdzunaAdapter.gate).toBeUndefined();
  });

  it('returns ok with classified jobs', async () => {
    const http = fakeFetch({
      'api.adzuna.com': () => new Response(JSON.stringify(adzunaFixture), { status: 200 }),
    });
    const result = await hiringAdzunaAdapter.run(ctxWith(http));
    expect(result.status).toBe('ok');
    expect(result.payload).not.toBeNull();
    expect(result.payload!.jobs.length).toBe(3);
    expect(result.payload!.jobs[0]!.function).toBe('eng');
  });

  it('returns error on 5xx (after retry)', async () => {
    const http = fakeFetch({
      'api.adzuna.com': () => new Response('boom', { status: 500 }),
    });
    const result = await hiringAdzunaAdapter.run(ctxWith(http));
    expect(result.status).toBe('error');
    expect(result.errors?.[0]).toContain('adzuna');
  });

  it('returns empty (not error) when no results returned', async () => {
    const http = fakeFetch({
      'api.adzuna.com': () => new Response(JSON.stringify({ count: 0, results: [] }), { status: 200 }),
    });
    const result = await hiringAdzunaAdapter.run(ctxWith(http));
    expect(result.status).toBe('empty');
    expect(result.payload?.jobs).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd tools/radar-trace && npm test -- adapters/hiring/adzuna
```

Expected: FAIL — module not found.

- [ ] **Step 4: Create `hiring/adzuna.ts`**

Create `tools/radar-trace/src/adapters/hiring/adzuna.ts`:

```ts
import { z } from 'zod';
import type { Adapter, AdapterContext, AdapterResult } from '../../types.js';
import { classifyFunction, classifySeniority } from '../../lib/classify.js';
import { JobSchema, type Job } from './types.js';

export const HiringAdzunaPayloadSchema = z.object({
  jobs: z.array(JobSchema),
});

export type HiringAdzunaPayload = z.infer<typeof HiringAdzunaPayloadSchema>;

export const hiringAdzunaAdapter: Adapter<HiringAdzunaPayload> = {
  name: 'hiring.adzuna',
  module: 'hiring',
  version: '0.1.0',
  estimatedCostInr: 0,
  requiredEnv: ['ADZUNA_APP_ID', 'ADZUNA_APP_KEY'],
  schema: HiringAdzunaPayloadSchema,
  async run(ctx: AdapterContext): Promise<AdapterResult<HiringAdzunaPayload>> {
    const t0 = Date.now();
    const id = ctx.env.ADZUNA_APP_ID!;
    const key = ctx.env.ADZUNA_APP_KEY!;
    const company = encodeURIComponent(ctx.input.name);
    const url = `https://api.adzuna.com/v1/api/jobs/in/search/1?app_id=${id}&app_key=${key}&company=${company}&results_per_page=50`;
    try {
      const res = await ctx.http(url, { signal: ctx.signal });
      if (!res.ok) throw new Error(`adzuna http ${res.status}`);
      const json = await res.json() as {
        results?: Array<{
          title: string;
          location?: { display_name?: string };
          created?: string;
          redirect_url?: string;
        }>;
      };
      const jobs: Job[] = (json.results ?? []).map((r) => ({
        source: 'adzuna' as const,
        title: r.title,
        location: r.location?.display_name ?? null,
        date: r.created ? r.created.slice(0, 10) : null,
        url: r.redirect_url ?? null,
        function: classifyFunction(r.title),
        seniority: classifySeniority(r.title),
      }));
      const status = jobs.length === 0 ? 'empty' : 'ok';
      return {
        source: 'hiring.adzuna',
        fetchedAt: new Date().toISOString(),
        status,
        payload: { jobs },
        costPaise: 0,
        durationMs: Date.now() - t0,
      };
    } catch (err) {
      return {
        source: 'hiring.adzuna',
        fetchedAt: new Date().toISOString(),
        status: 'error',
        payload: null,
        errors: [`adzuna: ${(err as Error).message}`],
        costPaise: 0,
        durationMs: Date.now() - t0,
      };
    }
  },
};
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd tools/radar-trace && npm test -- adapters/hiring/adzuna
```

Expected: PASS — 4 assertions green.

- [ ] **Step 6: Repeat the pattern for `hiring/careers.ts`**

Follow the same TDD flow (failing test → implementation → passing test). The shape: take the careers-HTML logic from the old `hiring.ts` and put it in `hiring/careers.ts` as adapter `hiring.careers`, payload `{ jobs: Job[] }`, no `requiredEnv`. Use the existing `tests/fixtures/hiring/careers-acme.html` fixture.

The careers adapter should return:
- `status:'empty'` if 0 jobs extracted from HTML
- `status:'error'` if homepage fetch fails (404, etc.)
- `status:'ok'` otherwise

Schema:

```ts
export const HiringCareersPayloadSchema = z.object({
  jobs: z.array(JobSchema),
  url: z.string(),
});
```

Note that `url` is included (was `null` in the old `Job.url` for careers entries) — at the adapter level, it's the `/careers` URL we scraped.

#### Task 2.1.b: Split `product` (4 adapters)

**Source-of-truth approach: lift logic verbatim from existing `tools/radar-trace/src/adapters/product.ts`** (which was renamed from `radar-enrich` in Task 1.1 and still has the legacy module-level implementation). The legacy file has working code for GitHub org search, events fetch, releases extraction, and changelog scraping. Partition by output field:

| New adapter | name | What to lift from legacy `product.ts` |
|---|---|---|
| `product/githubOrg.ts` | `product.github_org` | The `findGithubOrg(ctx)` function. Output: `{ org: string \| null }` |
| `product/githubEvents.ts` | `product.github_events` | `findGithubOrg(ctx)` (inlined per "Decision" below) + `fetchEvents(ctx, org)` + the commit-velocity / release-extraction loops. Output: `{ commitVelocity30d: number, recentReleases: Release[] }` |
| `product/githubReleases.ts` | `product.github_releases` | `findGithubOrg(ctx)` + `fetchRepos(ctx, org)` + the recentNewRepos/languageDistribution computation. Output: `{ recentNewRepos: Repo[], publicRepos: Repo[], languageDistribution: Record<string,number> }` |
| `product/changelog.ts` | `product.changelog` | `fetchChangelog(ctx)`. Output: `{ entries: ChangelogEntry[], discoveredAt: string \| null }` |

**Decision: inline the GitHub org search in each of `github_events` and `github_releases` rather than gating them on `github_org`.** Reason: making them Wave 2 (gated) would require the partial dossier to be available, but Wave 2 should stay minimal (only the directories adapters in §4.9 of the spec). 4 redundant `findGithubOrg` calls per run is acceptable — GitHub search is cheap and rate-limit-tolerant. Each adapter file should have a top-of-file comment documenting this decision.

**Test strategy:** for each new adapter, lift the relevant assertions from existing `tests/adapters/product.test.ts` and partition them by output field. Re-use the existing `tests/fixtures/product/*` fixtures as-is. Pin `vi.useFakeTimers({ now: new Date('2026-05-01T12:00:00Z') })` in each new product test that has date-cohort assertions (only `github_events`, `github_releases`, `changelog` need this; `github_org` doesn't have date logic).

**Schemas:** declare each per-source schema in its respective adapter file. Move shared types (`Repo`, `Release`, `ChangelogEntry`) into `src/adapters/product/types.ts` similar to how `hiring/types.ts` is structured in Task 2.1.a.

#### Task 2.1.c: Split `customer` (2 adapters)

**Source-of-truth: lift from `tools/radar-trace/src/adapters/customer.ts`.** The legacy file has `findCustomersPage`, `extractLogos`, `waybackLookup`, `diffPricing`, `diffHero` helpers. Partition:

| New adapter | name | What to lift from legacy `customer.ts` |
|---|---|---|
| `customer/logosCurrent.ts` | `customer.logos_current` | `findCustomersPage()` + `extractLogos()`. Output: `{ customersPageUrl, currentLogos[] }` |
| `customer/waybackDiff.ts` | `customer.wayback_diff` | `findCustomersPage()` (inlined) + `extractLogos()` + `waybackLookup()` + `diffPricing()` + `diffHero()`. Output: `{ snapshotsAnalyzed, addedLogosLast90d, removedLogosLast90d, pricingChanges, heroChanges }` |

**Test strategy:** lift fixtures (`tests/fixtures/customer/*`) verbatim. Partition the existing `customer.test.ts` assertions: "extracts logos" tests go to `logosCurrent.test.ts`; "diffs against Wayback" / pricing / hero tests go to `waybackDiff.test.ts`.

**Note on duplicate fetches:** both adapters call `findCustomersPage()` independently. The redundancy is acceptable for Phase 1A — both adapters cache, so on a second run within 24h only one network fetch happens (the first one populates cache, the second hits it). `waybackDiff` could read its sibling's cached payload, but that creates Wave 1/Wave 2 ordering concerns we want to avoid.

#### Task 2.1.d: Split `operational` (3 adapters)

**Source-of-truth: lift from `tools/radar-trace/src/adapters/operational.ts`.** That file already has `makeOperationalAdapter(dns)` factory pattern + the `Promise.allSettled` parallel fetch logic. Partition:

| New adapter | name | What to lift from legacy `operational.ts` |
|---|---|---|
| `operational/techStack.ts` | `operational.tech_stack` | The homepage fetch + `detectTechStack()` call. Output: `{ techStack: DetectedTech[] }` |
| `operational/crtsh.ts` | `operational.crtsh` | The `fetchCrtSh()` function + the `NOTABLE_SUBDOMAIN_RE` filter. Output: `{ subdomains: string[], notableSubdomains: string[] }` |
| `operational/dns.ts` | `operational.dns` | The `dns.resolveMx()` + `dns.resolveTxt()` calls + `inferEmailProvider()` + `inferSaasVerifications()`. Output: `{ emailProvider: string \| null, knownSaaSVerifications: string[] }` |

**Critical: preserve the factory DI pattern for `operational/dns.ts`.** Export both:
- `operationalDnsAdapter` — default export, uses real `node:dns/promises`
- `makeOperationalDnsAdapter(dnsResolver)` — factory taking a DI'd resolver, used by tests

This pattern is already in legacy `operational.ts` as `makeOperationalAdapter(dns)`. Lift the `DnsResolver` interface unchanged.

**Test strategy:** lift fixtures (`tests/fixtures/operational/*`) verbatim. Partition `operational.test.ts` assertions:
- Tech stack detection assertions → `techStack.test.ts`
- crt.sh / subdomain tests → `crtsh.test.ts`
- DNS / email provider / SaaS verification tests → `dns.test.ts` (use the `makeOperationalDnsAdapter(fakeDns)` factory in tests)

**Note: parallelization.** The legacy `operational.ts` parallelized homepage / MX / TXT / crt.sh via `Promise.allSettled`. After splitting, each adapter is independent — the orchestrator's Wave 1 parallelism handles the equivalent. No coordination needed.

#### Task 2.1.e: Delete old monolithic adapter files

After all 11 new adapters are wired and tests passing:

```bash
cd tools/radar-trace
rm src/adapters/hiring.ts
rm src/adapters/product.ts
rm src/adapters/customer.ts
rm src/adapters/operational.ts
rm src/adapters/voice.stub.ts
rm src/adapters/positioning.stub.ts
rm tests/adapters/hiring.test.ts
rm tests/adapters/product.test.ts
rm tests/adapters/customer.test.ts
rm tests/adapters/operational.test.ts
rm tests/adapters/stubs.test.ts
```

#### Task 2.1.f: Delete the synthesis layer (Phase 2 deferred)

```bash
cd tools/radar-trace
rm -rf src/synthesis tests/synthesis
```

Also remove synthesis-related imports from `cli.ts` and any remaining test files. We re-introduce the synthesis layer in Phase 2.

**Verify no orphan files remain:**

```bash
cd tools/radar-trace && find tests -name "*.ts" -path "*/synthesis/*" 2>/dev/null
```

Expected: no output (the entire `tests/synthesis/` subtree is gone).

- [ ] **Step 1: Run the full suite to confirm everything compiles + passes**

```bash
cd tools/radar-trace && npm test && npm run typecheck
```

Expected: tests pass (count ≥143). Typecheck clean. Any failures here block the chunk.

---

### Task 2.2: Refactor orchestrator for two-wave execution + flat dossier output

**Files:**
- Modify: `tools/radar-trace/src/orchestrator.ts`
- Modify: `tools/radar-trace/tests/orchestrator.test.ts`

The orchestrator gains: two-wave execution (Wave 1 = ungated, Wave 2 = gated), `partialDossier` construction, integration with the new dossier shape, INR-primary cost tracking.

- [ ] **Step 1: Add new tests for the two-wave behavior**

Append to `tools/radar-trace/tests/orchestrator.test.ts`:

```ts
describe('two-wave execution', () => {
  it('Wave 2 adapter sees Wave 1 results in its gate', async () => {
    let observed: PartialDossier | null = null;
    const wave1: Adapter<unknown> = makeAdapter('foo.x', async () => ({
      source: 'foo.x', fetchedAt: 'x', status: 'ok',
      payload: { country: 'India' }, costPaise: 0, durationMs: 1,
    }));
    const wave2: Adapter<unknown> = {
      ...makeAdapter('bar.y', async () => ({ source: 'bar.y', fetchedAt: 'x', status: 'ok', payload: {}, costPaise: 0, durationMs: 1 })),
      gate(partial) {
        observed = partial;
        return (partial['foo.x']?.payload as { country?: string })?.country !== 'India';
      },
    };
    const out = await runEnrichment({
      input: fakeInput, env: fakeEnv, adapters: [wave1, wave2],
      cache: memoryCache(), logger: silentLogger(),
      http: globalThis.fetch, concurrency: 2, timeoutMs: 5000, useCache: true,
    });
    expect(observed).not.toBeNull();
    expect(observed!['foo.x']).toBeDefined();
    expect(out.results['bar.y']!.status).toBe('empty'); // gate returned false
    expect(out.results['bar.y']!.errors).toBeUndefined(); // intentional skip ≠ error
  });

  it('Wave 2 gate that throws is treated as false', async () => {
    const wave1 = makeAdapter('foo.x', async () => ({ source: 'foo.x', fetchedAt: 'x', status: 'ok', payload: null, costPaise: 0, durationMs: 1 }));
    const wave2: Adapter<unknown> = {
      ...makeAdapter('bar.y', async () => ({ source: 'bar.y', fetchedAt: 'x', status: 'ok', payload: {}, costPaise: 0, durationMs: 1 })),
      gate() { throw new Error('boom'); },
    };
    const out = await runEnrichment({
      input: fakeInput, env: fakeEnv, adapters: [wave1, wave2],
      cache: memoryCache(), logger: silentLogger(),
      http: globalThis.fetch, concurrency: 2, timeoutMs: 5000, useCache: true,
    });
    expect(out.results['bar.y']!.status).toBe('empty');
    expect(out.results['bar.y']!.errors?.[0]).toContain('gate threw: boom');
  });

  it('Wave 1 adapter without gate is included in partialDossier even when errored', async () => {
    let observed: PartialDossier | null = null;
    const wave1Errored = makeAdapter('foo.fails', async () => { throw new Error('flaky'); });
    const wave2: Adapter<unknown> = {
      ...makeAdapter('bar.y', async () => ({ source: 'bar.y', fetchedAt: 'x', status: 'ok', payload: {}, costPaise: 0, durationMs: 1 })),
      gate(partial) {
        observed = partial;
        return true;
      },
    };
    await runEnrichment({
      input: fakeInput, env: fakeEnv, adapters: [wave1Errored, wave2],
      cache: memoryCache(), logger: silentLogger(),
      http: globalThis.fetch, concurrency: 2, timeoutMs: 5000, useCache: true,
    });
    expect(observed!['foo.fails']?.status).toBe('error');
    expect(observed!['foo.fails']?.payload).toBeNull();
  });
});

describe('cost tracking', () => {
  it('summary.totalCostInr is sum of costPaise/100 across all adapters', async () => {
    const adapters = [
      makeAdapter('a.x', async () => ({ source: 'a.x', fetchedAt: 'x', status: 'ok', payload: {}, costPaise: 5000, durationMs: 1 })),
      makeAdapter('a.y', async () => ({ source: 'a.y', fetchedAt: 'x', status: 'ok', payload: {}, costPaise: 12000, durationMs: 1 })),
    ];
    const out = await runEnrichment({
      input: fakeInput, env: fakeEnv, adapters,
      cache: memoryCache(), logger: silentLogger(),
      http: globalThis.fetch, concurrency: 2, timeoutMs: 5000, useCache: true,
    });
    expect(out.summary.totalCostInr).toBe(170);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd tools/radar-trace && npm test -- orchestrator
```

Expected: FAIL — orchestrator doesn't have two-wave logic yet, doesn't expose `totalCostInr`.

- [ ] **Step 3: Refactor `orchestrator.ts` for two-wave execution**

Replace `tools/radar-trace/src/orchestrator.ts` with:

```ts
import pLimit from 'p-limit';
import { hashCompanyInput, todayStamp } from './cache.js';
import { assertRequiredEnv } from './env.js';
import type {
  Adapter, AdapterContext, AdapterResult, Cache, Company, Env, Logger, PartialDossier,
} from './types.js';

export interface RunOptions {
  input: Company;
  env: Env;
  adapters: ReadonlyArray<Adapter<unknown>>;
  cache: Cache;
  logger: Logger;
  http: typeof fetch;
  concurrency: number;
  timeoutMs: number;
  useCache: boolean;
}

export interface RunOutput {
  results: Record<string, AdapterResult<unknown>>;
  summary: {
    totalCostInr: number;
    totalDurationMs: number;
    perAdapter: Array<{
      name: string; status: string; durationMs: number; costInr: number; cached: boolean;
    }>;
  };
}

export async function runEnrichment(opts: RunOptions): Promise<RunOutput> {
  const limit = pLimit(opts.concurrency);
  const startWall = Date.now();
  const inputHash = hashCompanyInput(opts.input);
  const date = todayStamp();

  const wave1 = opts.adapters.filter((a) => !a.gate);
  const wave2 = opts.adapters.filter((a) => a.gate);

  // Wave 1
  const wave1Results = await Promise.all(
    wave1.map((a) => limit(() => runOneAdapter(a, opts, inputHash, date))),
  );

  // Build partial dossier (frozen at runtime)
  const partial: Record<string, AdapterResult<unknown>> = {};
  for (const { name, result } of wave1Results) partial[name] = result;
  const partialDossier: PartialDossier = Object.freeze(partial);

  // Wave 2
  const wave2Results = await Promise.all(
    wave2.map((a) => limit(() => runGatedAdapter(a, opts, inputHash, date, partialDossier))),
  );

  const all = [...wave1Results, ...wave2Results];
  const results: Record<string, AdapterResult<unknown>> = {};
  const perAdapter: RunOutput['summary']['perAdapter'] = [];
  let totalPaise = 0;
  for (const { name, result, cached } of all) {
    results[name] = result;
    totalPaise += result.costPaise;
    perAdapter.push({
      name, status: result.status, durationMs: result.durationMs,
      costInr: result.costPaise / 100, cached,
    });
  }

  return {
    results,
    summary: {
      totalCostInr: totalPaise / 100,
      totalDurationMs: Date.now() - startWall,
      perAdapter,
    },
  };
}

async function runGatedAdapter(
  adapter: Adapter<unknown>,
  opts: RunOptions,
  inputHash: string,
  date: string,
  partial: PartialDossier,
): Promise<{ name: string; result: AdapterResult<unknown>; cached: boolean }> {
  const log = opts.logger.child({ adapter: adapter.name });
  let gateResult = false;
  try {
    gateResult = adapter.gate!(partial);
  } catch (err) {
    log.warn('gate threw', { error: (err as Error).message });
    return {
      name: adapter.name,
      result: {
        source: adapter.name,
        fetchedAt: new Date().toISOString(),
        status: 'empty',
        payload: null,
        errors: [`gate threw: ${(err as Error).message}`],
        costPaise: 0,
        durationMs: 0,
      },
      cached: false,
    };
  }
  if (!gateResult) {
    return {
      name: adapter.name,
      result: {
        source: adapter.name,
        fetchedAt: new Date().toISOString(),
        status: 'empty',
        payload: null,
        costPaise: 0,
        durationMs: 0,
      },
      cached: false,
    };
  }
  return runOneAdapter(adapter, opts, inputHash, date);
}

async function runOneAdapter(
  adapter: Adapter<unknown>,
  opts: RunOptions,
  inputHash: string,
  date: string,
): Promise<{ name: string; result: AdapterResult<unknown>; cached: boolean }> {
  const log = opts.logger.child({ adapter: adapter.name });
  const cacheKey = { adapterName: adapter.name, adapterVersion: adapter.version, inputHash, date };

  if (opts.useCache) {
    const cached = await opts.cache.read<unknown>(cacheKey, adapter.cacheTtlMs);
    if (cached) {
      log.info('cache hit', { status: cached.status });
      return { name: adapter.name, result: cached, cached: true };
    }
  }

  try {
    assertRequiredEnv(opts.env, adapter.name, adapter.requiredEnv);
  } catch (err) {
    const result: AdapterResult<unknown> = {
      source: adapter.name, fetchedAt: new Date().toISOString(),
      status: 'error', payload: null,
      errors: [(err as Error).message],
      costPaise: 0, durationMs: 0,
    };
    log.warn('skipped: missing env', { errors: result.errors });
    return { name: adapter.name, result, cached: false };
  }

  const timeoutCtrl = new AbortController();
  const timer = setTimeout(() => timeoutCtrl.abort(new Error(`timeout after ${opts.timeoutMs}ms`)), opts.timeoutMs);
  const ctx: AdapterContext = {
    input: opts.input, http: opts.http, cache: opts.cache, logger: log,
    env: opts.env, signal: timeoutCtrl.signal,
  };

  log.info('start');
  const t0 = Date.now();
  let result: AdapterResult<unknown>;
  try {
    result = await adapter.run(ctx);
  } catch (err) {
    result = {
      source: adapter.name, fetchedAt: new Date().toISOString(),
      status: 'error', payload: null,
      errors: [(err as Error).message ?? String(err)],
      costPaise: 0, durationMs: Date.now() - t0,
    };
  } finally {
    clearTimeout(timer);
  }

  if (result.status === 'ok' && result.payload !== null) {
    const parsed = adapter.schema.safeParse(result.payload);
    if (!parsed.success) {
      result = {
        ...result, status: 'partial',
        errors: [...(result.errors ?? []), parsed.error.message],
      };
    }
  }

  log.info('done', { status: result.status, durationMs: result.durationMs, costPaise: result.costPaise });

  if (result.status !== 'error') {
    await opts.cache.write(cacheKey, result);
  }

  return { name: adapter.name, result, cached: false };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd tools/radar-trace && npm test -- orchestrator
```

Expected: PASS — all orchestrator tests green (existing + 4 new).

- [ ] **Step 5: Do NOT commit yet — cli.ts still needs updating in Task 1.7.**

---

### Task 2.3: Update cli.ts for new dossier shape + register all 11 adapters

**Files:**
- Modify: `tools/radar-trace/src/cli.ts`
- Modify: `tools/radar-trace/tests/cli.test.ts`

The CLI must:
- Import all 10 new per-source adapters
- Build the new flat-`adapters` + `modules` dossier shape (per spec §6)
- Compute `totalCostInr` and `totalCostBreakdown` from per-adapter results
- Emit `radarTraceVersion: '1.0.0'`, `signalSummary: null` (Phase 1A)

(For brevity: this task contains only the structural changes. New CLI flags `--skip-paid`, `--max-cost-inr`, `--adapters`, `--linkedin` are added in Chunk 6.)

- [ ] **Step 1: Update CLI tests to match new dossier shape**

Update `tools/radar-trace/tests/cli.test.ts` — replace the integration test assertions:

```ts
import { RadarTraceDossierSchema } from '../src/schemas.js';

// ... in the existing 'main() integration' describe block, replace assertion:
expect(EnrichedDossierSchema.safeParse(written).success).toBe(true);
// with:
expect(RadarTraceDossierSchema.safeParse(written).success).toBe(true);
expect(written.radarTraceVersion).toBe('1.0.0');
expect(written.signalSummary).toBeNull();
expect(Object.keys(written.modules).sort()).toEqual([
  'ads', 'customer', 'directories', 'hiring', 'operational',
  'positioning', 'product', 'social', 'voice',
]);
```

Remove the synthesis-tests block entirely (`describe('main() synthesis', ...)`) — synthesis is Phase 2.

- [ ] **Step 2: Update cli.ts**

Replace `tools/radar-trace/src/cli.ts` to:

1. Drop the `loadRealRegenerateHook` import + `MainDeps`/`signalSummary` synthesis block
2. Import the 10 new per-source adapters from their new paths
3. Construct the new dossier shape

Key replacement: the `STUB_ADAPTERS` block becomes a flat `ALL_ADAPTERS` array. Module groupings become `MODULE_OF_ADAPTER` lookup. Build the dossier:

```ts
import { hiringAdzunaAdapter } from './adapters/hiring/adzuna.js';
import { hiringCareersAdapter } from './adapters/hiring/careers.js';
import { productGithubOrgAdapter } from './adapters/product/githubOrg.js';
import { productGithubEventsAdapter } from './adapters/product/githubEvents.js';
import { productGithubReleasesAdapter } from './adapters/product/githubReleases.js';
import { productChangelogAdapter } from './adapters/product/changelog.js';
import { customerLogosCurrentAdapter } from './adapters/customer/logosCurrent.js';
import { customerWaybackDiffAdapter } from './adapters/customer/waybackDiff.js';
import { operationalTechStackAdapter } from './adapters/operational/techStack.js';
import { operationalCrtshAdapter } from './adapters/operational/crtsh.js';
import { operationalDnsAdapter } from './adapters/operational/dns.js';
// ... voice/positioning/social/ads/directories adapters added in chunks 3-5
import { ALL_MODULE_NAMES, type RadarTraceDossier } from './schemas.js';
import type { Adapter } from './types.js';

const ALL_ADAPTERS: ReadonlyArray<Adapter<unknown>> = [
  hiringAdzunaAdapter as Adapter<unknown>,
  hiringCareersAdapter as Adapter<unknown>,
  productGithubOrgAdapter as Adapter<unknown>,
  productGithubEventsAdapter as Adapter<unknown>,
  productGithubReleasesAdapter as Adapter<unknown>,
  productChangelogAdapter as Adapter<unknown>,
  customerLogosCurrentAdapter as Adapter<unknown>,
  customerWaybackDiffAdapter as Adapter<unknown>,
  operationalTechStackAdapter as Adapter<unknown>,
  operationalCrtshAdapter as Adapter<unknown>,
  operationalDnsAdapter as Adapter<unknown>,
  // voice/positioning/social/ads/directories added in chunks 3-5
];

// Build the modules block from adapter declarations
function buildModulesBlock(
  enabled: ReadonlyArray<Adapter<unknown>>,
): RadarTraceDossier['modules'] {
  const out = Object.fromEntries(
    ALL_MODULE_NAMES.map((m) => [m, { adapters: [] as string[] }]),
  ) as RadarTraceDossier['modules'];
  for (const a of enabled) {
    out[a.module]!.adapters.push(a.name);
  }
  return out;
}
```

Build the dossier (replace the old EnrichedDossier construction):

```ts
const usdToInr = parseFloat(env.USD_INR_RATE ?? '84.0');
const totalCostBreakdown = computeCostBreakdown(results, usdToInr);

const dossier: RadarTraceDossier = {
  radarTraceVersion: '1.0.0',
  company: opts.input,
  tracedAt: new Date().toISOString(),
  totalCostInr: summary.totalCostInr,
  totalCostBreakdown,
  totalDurationMs: summary.totalDurationMs,
  adapters: results,
  modules: buildModulesBlock(adapters),
  signalSummary: null,
};

const validated = RadarTraceDossierSchema.parse(dossier);
```

Add the `computeCostBreakdown` helper at the bottom of `cli.ts`:

```ts
function computeCostBreakdown(
  results: Record<string, AdapterResult<unknown>>,
  usdToInr: number,
): RadarTraceDossier['totalCostBreakdown'] {
  let serper = 0, brave = 0, listenNotes = 0, pagespeed = 0, apifyUsd = 0;
  for (const [name, r] of Object.entries(results)) {
    const inr = r.costPaise / 100;
    if (name.includes('apify')) apifyUsd += r.costMeta?.costUsd ?? 0;
    else if (name === 'voice.linkedin_pulse' || name.startsWith('voice.founder_') ||
             name === 'positioning.crunchbase_snippet' || name === 'positioning.serper_news' ||
             name === 'voice.youtube_channel') serper += inr;
    else if (name === 'positioning.brave_news') brave += inr;
    else if (name === 'voice.podcast_appearances') listenNotes += inr;
    else if (name === 'operational.pagespeed') pagespeed += inr;
  }
  return {
    serper, brave, listenNotes, pagespeed, apifyUsd,
    apifyInr: apifyUsd * usdToInr,
  };
}
```

Note: in Chunk 1 only the existing 11 adapters are wired (3 Adzuna+Careers+nothing for voice/positioning), so most of `computeCostBreakdown`'s branches return 0. That's fine — branches will fire as adapters land in chunks 3-5.

- [ ] **Step 3: Run all tests + typecheck**

```bash
cd tools/radar-trace && npm test && npm run typecheck
```

Expected: tests pass, typecheck clean.

- [ ] **Step 4: Smoke test the full CLI run**

```bash
cd tools/radar-trace && npx tsx src/cli.ts --company "Acme" --domain acme.com 2>/dev/null | jq '{version: .radarTraceVersion, modules: (.modules | keys | sort), adapterCount: (.adapters | length)}'
```

Expected:
```json
{
  "version": "1.0.0",
  "modules": ["ads","customer","directories","hiring","operational","positioning","product","social","voice"],
  "adapterCount": 11
}
```

(11 = 2 hiring + 4 product + 2 customer + 3 operational. Other modules are empty arrays in the modules block until Chunks 2-5.)

- [ ] **Step 5: Commit the entire chunk**

```bash
git add -A tools/radar-trace
git commit -m "feat(radar-trace): rename + refactor adapters to per-source granularity (Chunk 1A.1)

- git mv tools/radar-enrich → tools/radar-trace
- Add module/gate/cacheTtlMs/estimatedCostInr fields to Adapter<T> contract
- Define PartialDossier + Company + ModuleName types
- New RadarTraceDossierSchema with radarTraceVersion + totalCostBreakdown
- Two-wave orchestrator with frozen partialDossier passed to gate predicates
- Per-adapter cacheTtlMs override
- Refactor 4 module-level adapters into 11 per-source adapters:
  hiring → hiring.adzuna + hiring.careers
  product → product.github_org + github_events + github_releases + changelog
  customer → customer.logos_current + customer.wayback_diff
  operational → operational.tech_stack + crtsh + dns
- Delete voice + positioning stubs (re-introduced in chunk 3)
- Delete synthesis layer (Phase 2 deferred)
- Test count: ≥143"
```

---

### Task 2.4: Consolidation pass — remove old types/schemas, tighten optional fields

**Files:**
- Modify: `tools/radar-trace/src/types.ts`
- Modify: `tools/radar-trace/src/schemas.ts`
- Modify: any test files that imported the removed symbols

After Task 2.3, the new dossier shape is in active use; the old shape is no longer referenced. This task does the cleanup.

- [ ] **Step 1: Remove old type aliases / interfaces from types.ts**

In `tools/radar-trace/src/types.ts`:
- Delete the `CompanyInput` interface entirely (it's been superseded by `Company`)
- Change `Company extends CompanyInput` to a standalone `interface Company { name: string; domain: string; location?: string; founder?: string; founderLinkedinUrl?: string; }`

- [ ] **Step 2: Make new Adapter fields REQUIRED**

In the `Adapter<T>` interface, change:
```ts
  readonly module?: ModuleName;
  readonly estimatedCostInr?: number;
```
to:
```ts
  readonly module: ModuleName;
  readonly estimatedCostInr: number;
```

(`gate` and `cacheTtlMs` stay optional per spec §5.)

Remove the comment "Optional during Chunk 1; required after Chunk 2" lines.

- [ ] **Step 3: Remove old schemas from schemas.ts**

In `tools/radar-trace/src/schemas.ts`:
- Delete `EnrichedDossierSchema` (and its inferred type if exported)
- Delete `CompanyInputSchema` (superseded by `CompanySchema`)
- Delete the existing `SignalSummarySchema` (Phase 2 — was reused unchanged from radar-enrich; we'll re-introduce in Phase 2 with Phase 2's specific shape)
- Rename `AdapterResultSchemaV2` → `AdapterResultSchema` (consolidating: the V2 was a `.extend()` adding `costMeta`; just inline that into the canonical `AdapterResultSchema` and drop the V2 alias)
- Rename `SignalSummarySchemaV2` → `SignalSummarySchema` (consolidating)
- Update `RadarTraceDossierSchema` to reference the renamed schemas

- [ ] **Step 4: Fix any orphan imports**

Grep for any test file or source that still imports removed symbols:

```bash
cd tools/radar-trace && grep -rn "EnrichedDossierSchema\|CompanyInputSchema\|CompanyInput\|AdapterResultSchemaV2\|SignalSummarySchemaV2" src tests
```

Fix each (replace with the canonical name, or remove the unused import).

- [ ] **Step 5: Run all tests + typecheck**

```bash
cd tools/radar-trace && npm test && npm run typecheck
```

Expected: tests pass (~143+ depending on chunk additions), typecheck clean.

- [ ] **Step 6: Commit Task 2.4**

```bash
git add -A tools/radar-trace
git commit -m "refactor(radar-trace): consolidate types/schemas — drop CompanyInput, EnrichedDossier, V2 aliases (Chunk 2 cleanup)

- types.ts: delete CompanyInput; Company is now standalone; module + estimatedCostInr now required (no longer optional)
- schemas.ts: delete EnrichedDossierSchema + CompanyInputSchema + the Phase 1 SignalSummarySchema; rename AdapterResultSchemaV2 → AdapterResultSchema; rename SignalSummarySchemaV2 → SignalSummarySchema; RadarTraceDossierSchema is now the only top-level dossier schema"
```

---

## Chunk 2 complete checkpoint

After this chunk:
- 11 per-source adapters exist (split from 4 module-level ones); old monolithic adapter files deleted
- Voice + positioning stubs deleted (re-introduced in Chunk 4)
- Synthesis layer deleted (Phase 2)
- Two-wave orchestrator with `partialDossier` + gate predicates implemented
- `radar-trace --company X --domain Y` produces dossier validating against `RadarTraceDossierSchema`
- Old types (`CompanyInput`) and schemas (`EnrichedDossierSchema`, `AdapterResultSchemaV2`) consolidated; new fields (`module`, `estimatedCostInr`) are now required

Verify before moving on:

```bash
cd tools/radar-trace && npm test && npm run typecheck && npx tsx src/cli.ts --company "Acme" --domain acme.com 2>/dev/null | jq '.adapters | keys | sort'
```

Expected `keys`:
```json
[
  "customer.logos_current", "customer.wayback_diff",
  "hiring.adzuna", "hiring.careers",
  "operational.crtsh", "operational.dns", "operational.tech_stack",
  "product.changelog", "product.github_events", "product.github_org", "product.github_releases"
]
```

Test count target: ≥143 (per spec §3 floor).

---

## Chunk 3: Sub-phase 1A.2 — Operational + product free expansion

This chunk adds 6 new free adapters that extend existing modules. All are direct HTTP fetches against public APIs / sites — no Apify, no Serper, no paid keys (PageSpeed Insights has an optional key for higher quotas). Pattern is identical to Chunk 2's per-source adapters.

| Adapter | Module | Source |
|---|---|---|
| `product.rss` | product | RSS feed sniffing in `<head>` + RSS XML parse |
| `product.sitemap` | product | `sitemap.xml` parse → public page enumeration |
| `operational.pagespeed` | operational | PageSpeed Insights API |
| `operational.http_headers` | operational | HEAD / GET headers analysis |
| `operational.robots_txt` | operational | `/robots.txt` parsing |
| `operational.whois` | operational | RDAP / WHOIS API |

**End state of chunk:** ~17 adapters wired (11 from Chunk 2 + 6 new). Test count climbs to ~165-175. CLI dossier shows new adapter slots populated for the relevant companies.

---

### Task 3.1: product.rss adapter

**Files:**
- Create: `tools/radar-trace/src/adapters/product/rss.ts`
- Create: `tools/radar-trace/tests/adapters/product/rss.test.ts`
- Create: `tools/radar-trace/tests/fixtures/product/rss-with-link.html`
- Create: `tools/radar-trace/tests/fixtures/product/rss-feed.xml`

The adapter:
1. Fetches the homepage (or `/blog`/`/changelog` if homepage doesn't yield).
2. Sniffs `<link rel="alternate" type="application/rss+xml" href="...">` from `<head>`.
3. If found, fetches and parses the RSS XML, returns last 20 items.
4. If multiple feeds found (some sites have separate `/feed` for blog vs. release notes), returns all of them.

- [ ] **Step 1: Capture fixtures**

Create `tools/radar-trace/tests/fixtures/product/rss-with-link.html`:

```html
<!doctype html>
<html><head>
<title>Acme</title>
<link rel="alternate" type="application/rss+xml" href="/feed.xml" title="Acme Blog" />
<link rel="alternate" type="application/atom+xml" href="/atom.xml" title="Acme Releases" />
</head><body><h1>Acme</h1></body></html>
```

Create `tools/radar-trace/tests/fixtures/product/rss-feed.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Acme Blog</title>
    <link>https://acme.com/blog</link>
    <item>
      <title>Shipped: Multi-tenant subdomain support</title>
      <link>https://acme.com/blog/multitenant</link>
      <pubDate>Tue, 28 Apr 2026 00:00:00 GMT</pubDate>
      <description>Now each customer gets their own subdomain.</description>
    </item>
    <item>
      <title>Hiring: Senior Backend Engineer</title>
      <link>https://acme.com/blog/hiring-senior-be</link>
      <pubDate>Mon, 20 Apr 2026 00:00:00 GMT</pubDate>
      <description>We're hiring.</description>
    </item>
  </channel>
</rss>
```

- [ ] **Step 2: Write the failing tests**

Create `tools/radar-trace/tests/adapters/product/rss.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { productRssAdapter } from '../../../src/adapters/product/rss.js';
import type { AdapterContext } from '../../../src/types.js';

const homepageHtml = readFileSync(join(__dirname, '../../fixtures/product/rss-with-link.html'), 'utf8');
const feedXml = readFileSync(join(__dirname, '../../fixtures/product/rss-feed.xml'), 'utf8');

function ctxWith(http: typeof fetch): AdapterContext {
  const noop = () => {};
  return {
    input: { name: 'Acme', domain: 'acme.com' },
    http,
    cache: { read: async () => null, write: async () => {}, clear: async () => {} },
    logger: { debug: noop, info: noop, warn: noop, error: noop, child: () => ctxWith(http).logger },
    env: {},
    signal: new AbortController().signal,
  };
}

function fakeFetch(routes: Record<string, () => Response>): typeof fetch {
  return (async (url: string | URL | Request) => {
    const u = typeof url === 'string' ? url : url.toString();
    for (const [match, factory] of Object.entries(routes)) {
      if (u.includes(match)) return factory();
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

describe('productRssAdapter', () => {
  it('contract surface', () => {
    expect(productRssAdapter.name).toBe('product.rss');
    expect(productRssAdapter.module).toBe('product');
    expect(productRssAdapter.requiredEnv).toEqual([]);
    expect(productRssAdapter.estimatedCostInr).toBe(0);
  });

  it('finds RSS link in homepage <head> and parses feed', async () => {
    const http = fakeFetch({
      'acme.com/?$': () => new Response(homepageHtml, { status: 200, headers: { 'content-type': 'text/html' } }),
      'acme.com/$': () => new Response(homepageHtml, { status: 200 }),
      '/feed.xml': () => new Response(feedXml, { status: 200, headers: { 'content-type': 'application/rss+xml' } }),
      '/atom.xml': () => new Response('not found', { status: 404 }),
    });
    const result = await productRssAdapter.run(ctxWith(http));
    expect(result.status).toBe('ok');
    const p = result.payload!;
    expect(p.feeds.length).toBeGreaterThanOrEqual(1);
    expect(p.feeds[0]!.url).toContain('feed.xml');
    expect(p.feeds[0]!.items.length).toBe(2);
    expect(p.feeds[0]!.items[0]!.title).toContain('Shipped');
  });

  it('returns empty when homepage has no RSS link', async () => {
    const http = fakeFetch({
      'acme.com/?$': () => new Response('<html><head></head><body>nothing</body></html>', { status: 200 }),
    });
    const result = await productRssAdapter.run(ctxWith(http));
    expect(result.status).toBe('empty');
    expect(result.payload?.feeds).toEqual([]);
  });

  it('returns error when homepage fetch fails entirely', async () => {
    const http = fakeFetch({});
    const result = await productRssAdapter.run(ctxWith(http));
    expect(result.status).toBe('error');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd tools/radar-trace && npm test -- product/rss
```

Expected: FAIL — module not found.

- [ ] **Step 4: Create rss.ts**

Create `tools/radar-trace/src/adapters/product/rss.ts`:

```ts
import { z } from 'zod';
import * as cheerio from 'cheerio';
import type { Adapter, AdapterContext, AdapterResult } from '../../types.js';
import { toHttpsUrl } from '../../lib/domainUtils.js';

const RssItemSchema = z.object({
  title: z.string(),
  link: z.string().nullable(),
  date: z.string().nullable(),         // ISO if parseable, else raw pubDate string
  description: z.string().nullable(),
});

const RssFeedSchema = z.object({
  url: z.string(),
  title: z.string().nullable(),
  items: z.array(RssItemSchema),
});

export const ProductRssPayloadSchema = z.object({
  feeds: z.array(RssFeedSchema),
});

export type ProductRssPayload = z.infer<typeof ProductRssPayloadSchema>;

export const productRssAdapter: Adapter<ProductRssPayload> = {
  name: 'product.rss',
  module: 'product',
  version: '0.1.0',
  estimatedCostInr: 0,
  requiredEnv: [],
  schema: ProductRssPayloadSchema,
  async run(ctx: AdapterContext): Promise<AdapterResult<ProductRssPayload>> {
    const t0 = Date.now();
    const homepage = await ctx.http(toHttpsUrl(ctx.input.domain, '/'), { signal: ctx.signal });
    if (!homepage.ok) {
      return errorResult('homepage fetch failed: ' + homepage.status, t0);
    }
    const html = await homepage.text();
    const $ = cheerio.load(html);
    const feedLinks: Array<{ url: string; title: string | null }> = [];
    $('link[rel="alternate"]').each((_, el) => {
      const type = $(el).attr('type') ?? '';
      const href = $(el).attr('href');
      const title = $(el).attr('title') ?? null;
      if (!href) return;
      if (type.includes('rss') || type.includes('atom')) {
        const absoluteUrl = href.startsWith('http') ? href : toHttpsUrl(ctx.input.domain, href.startsWith('/') ? href : `/${href}`);
        feedLinks.push({ url: absoluteUrl, title });
      }
    });
    if (feedLinks.length === 0) {
      return {
        source: 'product.rss', fetchedAt: new Date().toISOString(),
        status: 'empty', payload: { feeds: [] },
        costPaise: 0, durationMs: Date.now() - t0,
      };
    }
    const feeds: ProductRssPayload['feeds'] = [];
    for (const link of feedLinks) {
      try {
        const res = await ctx.http(link.url, { signal: ctx.signal });
        if (!res.ok) continue;
        const xml = await res.text();
        const items = parseRssXml(xml);
        feeds.push({ url: link.url, title: link.title, items: items.slice(0, 20) });
      } catch { /* skip this feed */ }
    }
    return {
      source: 'product.rss', fetchedAt: new Date().toISOString(),
      status: feeds.length > 0 ? 'ok' : 'partial',
      payload: { feeds },
      costPaise: 0, durationMs: Date.now() - t0,
    };
  },
};

function parseRssXml(xml: string): Array<{ title: string; link: string | null; date: string | null; description: string | null }> {
  const $ = cheerio.load(xml, { xmlMode: true });
  const items: Array<{ title: string; link: string | null; date: string | null; description: string | null }> = [];
  $('item, entry').each((_, el) => {
    const title = $(el).find('title').first().text().trim();
    const link = $(el).find('link').first().text().trim() || $(el).find('link').first().attr('href') || null;
    const pubDate = $(el).find('pubDate, published, updated').first().text().trim() || null;
    const description = $(el).find('description, summary, content').first().text().trim() || null;
    if (title) {
      items.push({
        title,
        link: link || null,
        date: pubDate ? toIsoIfPossible(pubDate) : null,
        description: description ? description.slice(0, 500) : null,
      });
    }
  });
  return items;
}

function toIsoIfPossible(raw: string): string {
  const d = new Date(raw);
  return isNaN(d.getTime()) ? raw : d.toISOString();
}

function errorResult(msg: string, t0: number): AdapterResult<ProductRssPayload> {
  return {
    source: 'product.rss', fetchedAt: new Date().toISOString(),
    status: 'error', payload: null,
    errors: [msg], costPaise: 0, durationMs: Date.now() - t0,
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd tools/radar-trace && npm test -- product/rss
```

Expected: PASS — 4 tests green.

- [ ] **Step 6: Wire into cli.ts ALL_ADAPTERS array**

Edit `tools/radar-trace/src/cli.ts`. Add import:

```ts
import { productRssAdapter } from './adapters/product/rss.js';
```

Add to `ALL_ADAPTERS`:

```ts
  productRssAdapter as Adapter<unknown>,
```

- [ ] **Step 7: Commit**

```bash
git add tools/radar-trace/src/adapters/product/rss.ts \
        tools/radar-trace/tests/adapters/product/rss.test.ts \
        tools/radar-trace/tests/fixtures/product/rss-with-link.html \
        tools/radar-trace/tests/fixtures/product/rss-feed.xml \
        tools/radar-trace/src/cli.ts
git commit -m "feat(radar-trace): product.rss adapter (RSS feed sniffing + parse)"
```

---

### Task 3.2: product.sitemap adapter

**Files:**
- Create: `tools/radar-trace/src/adapters/product/sitemap.ts`
- Create: `tools/radar-trace/tests/adapters/product/sitemap.test.ts`
- Create: `tools/radar-trace/tests/fixtures/product/sitemap.xml`

Pattern follows `product.rss` exactly. Adapter fetches `https://{domain}/sitemap.xml`, parses XML, extracts `<loc>` URLs (max 100), categorizes by path prefix (e.g., `/blog/*`, `/products/*`, `/customers/*`).

Output shape:
```ts
{
  feeds: never;  // not used here
  url: string;             // sitemap URL
  totalUrls: number;
  urls: string[];          // up to 100
  byPathPrefix: Record<string, number>;  // e.g. { '/blog': 23, '/products': 8 }
}
```

Test cases (4):
1. Contract surface
2. Parses sitemap, computes byPathPrefix
3. Falls back to `/sitemap_index.xml` if `/sitemap.xml` 404s
4. Returns empty if no sitemap found

(Plan does not include the full code body — follow the `product.rss` pattern: cheerio in xml mode, parse `<urlset><url><loc>...</loc></url>...</urlset>`. Wire into `cli.ts` ALL_ADAPTERS.)

Commit message: `feat(radar-trace): product.sitemap adapter (sitemap.xml enumeration)`

---

### Task 3.3: operational.pagespeed adapter

**Files:**
- Create: `tools/radar-trace/src/adapters/operational/pagespeed.ts`
- Create: `tools/radar-trace/tests/adapters/operational/pagespeed.test.ts`
- Create: `tools/radar-trace/tests/fixtures/operational/pagespeed-response.json`

PageSpeed Insights API docs: `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url={URL}&strategy=mobile&category=performance`. Free tier works without API key (rate-limited); `PAGESPEED_API_KEY` improves quota.

Fixture: paste a real PSI response (sanitized) under `tests/fixtures/operational/pagespeed-response.json`. Extract these fields into payload:

```ts
{
  strategy: 'mobile' | 'desktop';
  performanceScore: number;      // 0-100
  metrics: {
    lcpMs: number | null;        // Largest Contentful Paint
    fcpMs: number | null;        // First Contentful Paint
    cls: number | null;          // Cumulative Layout Shift
    ttfbMs: number | null;       // Time to First Byte
    inpMs: number | null;        // Interaction to Next Paint
  };
  fetchedFrom: 'lab' | 'field';
}
```

Optional `PAGESPEED_API_KEY` is added to URL as `&key={KEY}` if present. **Do NOT add `requiredEnv: ['PAGESPEED_API_KEY']` — it's optional, not required.**

Test cases (4): contract, ok with full metrics, partial when some metrics missing, error on 5xx.

Commit message: `feat(radar-trace): operational.pagespeed adapter (PSI mobile + key metrics)`

---

### Task 3.4: operational.http_headers adapter

**Files:**
- Create: `tools/radar-trace/src/adapters/operational/httpHeaders.ts`
- Create: `tools/radar-trace/tests/adapters/operational/httpHeaders.test.ts`

Adapter does a HEAD request to `https://{domain}/` (falls back to GET if HEAD returns 405). Extracts:

```ts
{
  server: string | null;
  xPoweredBy: string | null;
  contentSecurityPolicy: string | null;
  strictTransportSecurity: string | null;
  xFrameOptions: string | null;
  xContentTypeOptions: string | null;
  referrerPolicy: string | null;
  permissionsPolicy: string | null;
  cacheControl: string | null;
}
```

Tests fake the `Response` constructor with synthetic headers. 3 tests: contract, all-headers-present, only-some-present (partial fallback).

Commit message: `feat(radar-trace): operational.http_headers adapter (Server/X-Powered-By/security headers)`

---

### Task 3.5: operational.robots_txt adapter

**Files:**
- Create: `tools/radar-trace/src/adapters/operational/robotsTxt.ts`
- Create: `tools/radar-trace/tests/adapters/operational/robotsTxt.test.ts`
- Create: `tools/radar-trace/tests/fixtures/operational/robots.txt` (sample WordPress + custom)

Fetches `/robots.txt`. Parses User-agent groups + Disallow lines. Sniffs known stack hints from disallow patterns (e.g., `Disallow: /wp-admin/` → WordPress; `Disallow: /admin/` → generic admin).

```ts
{
  raw: string;             // first 5KB of robots.txt
  userAgents: string[];    // unique User-agent lines
  disallows: string[];     // unique Disallow paths
  stackHints: string[];    // e.g. ['wordpress', 'shopify']
  hasSitemap: boolean;     // 'Sitemap:' line present
}
```

3 tests. Commit message: `feat(radar-trace): operational.robots_txt adapter (parse + stack hints)`

---

### Task 3.6: operational.whois adapter

**Files:**
- Create: `tools/radar-trace/src/adapters/operational/whois.ts`
- Create: `tools/radar-trace/tests/adapters/operational/whois.test.ts`
- Create: `tools/radar-trace/tests/fixtures/operational/rdap-response.json`

Use IANA's RDAP service (HTTP-based, JSON, free, no auth): `https://rdap.org/domain/{domain}`. Returns:

```ts
{
  domain: string;
  registrar: string | null;
  registeredOn: string | null;     // ISO
  expiresOn: string | null;        // ISO
  ageDays: number | null;          // computed
  status: string[];                // e.g. ['client transfer prohibited']
  nameservers: string[];
}
```

`cacheTtlMs: 30 * 86400000` (30 days — registration data is stable).

3 tests: contract, parses RDAP response, error on 404.

Commit message: `feat(radar-trace): operational.whois adapter (RDAP-based registration data)`

---

## Chunk 3 complete checkpoint

After this chunk:
- 17 adapters wired (11 from Chunk 2 + 6 new free ones)
- Test count ~165-175

Verify:

```bash
cd tools/radar-trace && npm test && npm run typecheck && npx tsx src/cli.ts --company "Acme" --domain acme.com 2>/dev/null | jq '.adapters | keys | length'
```

Expected: `17`.

---

## Chunk 4: Sub-phase 1A.3 — Voice + positioning + ads URLs + social links

This chunk adds 11 adapters across 4 modules (voice, positioning, ads URLs, social links). Most are Serper or Brave wrappers — high adapter count but low complexity per adapter once the shared clients are built. Two new shared clients land here: `SerperClient` and `BraveClient`.

| Adapter | Module | Source | Cost/lead |
|---|---|---|---|
| `voice.founder_linkedin_url` | voice | Serper | ~₹0.30 |
| `voice.founder_github_url` | voice | Serper | ~₹0.30 |
| `voice.linkedin_pulse` | voice | Serper search snippets | ~₹0.30 |
| `voice.podcast_appearances` | voice | Listen Notes | Free (free tier) |
| `voice.youtube_channel` | voice | Serper + YouTube RSS | ~₹0.30 |
| `positioning.crunchbase_snippet` | positioning | Serper site:crunchbase.com | ~₹0.30 |
| `positioning.brave_news` | positioning | Brave News API | ~₹0.50 |
| `positioning.serper_news` | positioning | Serper news search | ~₹0.30 |
| `ads.meta_library_url` | ads | URL constructor (no fetch) | Free |
| `ads.google_transparency_url` | ads | URL constructor (no fetch) | Free |
| `social.links` | social | Homepage regex extraction | Free |

**End state of chunk:** 28 adapters wired (17 from Chunk 3 + 11 new). Test count ~210-225. Voice and Positioning modules un-stubbed. New env vars: `SERPER_API_KEY`, `BRAVE_API_KEY`, `LISTEN_NOTES_KEY`.

---

### Task 4.1: SerperClient shared module

**Files:**
- Create: `tools/radar-trace/src/clients/serper.ts`
- Create: `tools/radar-trace/tests/clients/serper.test.ts`
- Create: `tools/radar-trace/tests/fixtures/serper/people-search.json`
- Create: `tools/radar-trace/tests/fixtures/serper/news-search.json`

Serper REST API: `POST https://google.serper.dev/search` with `X-API-KEY` header. Costs: roughly $0.0003 per search call (₹0.025). Used by 6 adapters in this chunk + Chunk 5's directories.

- [ ] **Step 1: Capture fixtures**

Create `tools/radar-trace/tests/fixtures/serper/people-search.json` with a sanitized real Serper response (key fields: `organic[].title`, `organic[].link`, `organic[].snippet`):

```json
{
  "searchParameters": { "q": "site:linkedin.com/in/ \"Jane Doe\" \"Acme\"", "type": "search", "engine": "google" },
  "organic": [
    {
      "title": "Jane Doe - Founder & CEO at Acme - LinkedIn",
      "link": "https://www.linkedin.com/in/janedoe/",
      "snippet": "Jane Doe is the founder of Acme...",
      "position": 1
    },
    {
      "title": "Jane Doe | Acme Corp",
      "link": "https://acme.com/about",
      "snippet": "Founded Acme in 2020...",
      "position": 2
    }
  ]
}
```

Create `tools/radar-trace/tests/fixtures/serper/news-search.json` similarly with a `news` field.

- [ ] **Step 2: Write the failing tests**

Create `tools/radar-trace/tests/clients/serper.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSerperClient } from '../../src/clients/serper.js';

const peopleFixture = JSON.parse(readFileSync(join(__dirname, '../fixtures/serper/people-search.json'), 'utf8'));
const newsFixture = JSON.parse(readFileSync(join(__dirname, '../fixtures/serper/news-search.json'), 'utf8'));

describe('SerperClient', () => {
  it('search() POSTs to /search with API key header and parses results', async () => {
    let seenInit: RequestInit | undefined;
    const fakeFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      seenInit = init;
      return new Response(JSON.stringify(peopleFixture), { status: 200 });
    }) as unknown as typeof fetch;
    const client = createSerperClient({ apiKey: 'fake-key', http: fakeFetch });
    const result = await client.search({ q: 'site:linkedin.com/in/ "Jane Doe"' });
    expect(seenInit?.method).toBe('POST');
    expect(new Headers(seenInit?.headers).get('x-api-key')).toBe('fake-key');
    expect(result.organic.length).toBeGreaterThan(0);
    expect(result.organic[0]!.link).toContain('linkedin.com/in/');
  });

  it('newsSearch() uses /news endpoint and returns news[]', async () => {
    let seenUrl = '';
    const fakeFetch = vi.fn(async (url: string | URL | Request) => {
      seenUrl = typeof url === 'string' ? url : url.toString();
      return new Response(JSON.stringify(newsFixture), { status: 200 });
    }) as unknown as typeof fetch;
    const client = createSerperClient({ apiKey: 'fake-key', http: fakeFetch });
    await client.newsSearch({ q: 'Acme funding' });
    expect(seenUrl).toContain('/news');
  });

  it('throws on non-2xx response', async () => {
    const fakeFetch = vi.fn(async () => new Response('rate limited', { status: 429 })) as unknown as typeof fetch;
    const client = createSerperClient({ apiKey: 'fake-key', http: fakeFetch });
    await expect(client.search({ q: 'x' })).rejects.toThrow(/serper.*429/i);
  });

  it('reports cost per call (~₹0.025 = 250 paise per 100 calls = 2.5 paise per call)', async () => {
    const fakeFetch = vi.fn(async () => new Response(JSON.stringify(peopleFixture), { status: 200 })) as unknown as typeof fetch;
    const client = createSerperClient({ apiKey: 'fake-key', http: fakeFetch });
    const result = await client.search({ q: 'x' });
    expect(result.costPaise).toBe(3); // rounded up; 2.5 paise per call → 3
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd tools/radar-trace && npm test -- clients/serper
```

Expected: FAIL — module not found.

- [ ] **Step 4: Create serper.ts**

Create `tools/radar-trace/src/clients/serper.ts`:

```ts
export interface SerperOrganicResult {
  title: string;
  link: string;
  snippet: string;
  position?: number;
}

export interface SerperNewsResult {
  title: string;
  link: string;
  snippet: string;
  date?: string;
  source?: string;
}

export interface SerperSearchResponse {
  organic: SerperOrganicResult[];
  costPaise: number;
}

export interface SerperNewsResponse {
  news: SerperNewsResult[];
  costPaise: number;
}

export interface SerperClient {
  search(opts: { q: string; gl?: string; hl?: string; num?: number; signal?: AbortSignal }): Promise<SerperSearchResponse>;
  newsSearch(opts: { q: string; gl?: string; signal?: AbortSignal }): Promise<SerperNewsResponse>;
}

export interface CreateSerperClientOptions {
  apiKey: string;
  http?: typeof fetch;
  /** Cost per call in paise. Default 3 (≈ ₹0.03 / call, slightly conservative). */
  costPerCallPaise?: number;
}

export function createSerperClient(opts: CreateSerperClientOptions): SerperClient {
  const http = opts.http ?? globalThis.fetch;
  const costPaise = opts.costPerCallPaise ?? 3;
  return {
    async search({ q, gl = 'in', hl = 'en', num = 10, signal }) {
      const res = await http('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'x-api-key': opts.apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({ q, gl, hl, num }),
        signal,
      });
      if (!res.ok) throw new Error(`serper ${res.status}: ${await res.text().catch(() => '')}`);
      const json = await res.json() as { organic?: SerperOrganicResult[] };
      return { organic: json.organic ?? [], costPaise };
    },
    async newsSearch({ q, gl = 'in', signal }) {
      const res = await http('https://google.serper.dev/news', {
        method: 'POST',
        headers: { 'x-api-key': opts.apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({ q, gl }),
        signal,
      });
      if (!res.ok) throw new Error(`serper ${res.status}: ${await res.text().catch(() => '')}`);
      const json = await res.json() as { news?: SerperNewsResult[] };
      return { news: json.news ?? [], costPaise };
    },
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd tools/radar-trace && npm test -- clients/serper
```

Expected: PASS — 4 tests green.

- [ ] **Step 6: Commit**

```bash
git add tools/radar-trace/src/clients/serper.ts tools/radar-trace/tests/clients/serper.test.ts tools/radar-trace/tests/fixtures/serper
git commit -m "feat(radar-trace): SerperClient shared module (search + news endpoints, cost tracking)"
```

---

### Task 4.2: BraveClient shared module

**Files:**
- Create: `tools/radar-trace/src/clients/brave.ts`
- Create: `tools/radar-trace/tests/clients/brave.test.ts`
- Create: `tools/radar-trace/tests/fixtures/brave/news-search.json`

Brave Search API: `GET https://api.search.brave.com/res/v1/news/search?q={Q}` with `X-Subscription-Token` header. Free tier 2k/mo, then $5/mo for 1k/day. Used by `positioning.brave_news` adapter.

Pattern follows SerperClient. Returns:

```ts
interface BraveNewsResponse {
  results: Array<{
    title: string;
    url: string;
    description: string;
    age: string;        // human-readable like "2 days ago"
    page_age: string;   // ISO if available
    profile?: { name: string };
  }>;
  costPaise: number;    // ~₹0.50 per call = 50 paise
}
```

3 tests: contract, parse fixture, throws on 4xx. Commit message: `feat(radar-trace): BraveClient shared module (news endpoint)`.

---

### Task 4.3: voice.founder_linkedin_url adapter (canonical Serper pattern)

**Files:**
- Create: `tools/radar-trace/src/adapters/voice/founderLinkedinUrl.ts`
- Create: `tools/radar-trace/tests/adapters/voice/founderLinkedinUrl.test.ts`

This is the canonical Serper-based adapter pattern. Subsequent voice/positioning adapters follow the same shape with query/output differences only.

The adapter:
1. Reads `ctx.input.founder` and `ctx.input.name`. If `ctx.input.founderLinkedinUrl` is already set, returns immediately with status:'ok' and that URL (no Serper call).
2. Otherwise, builds query: `site:linkedin.com/in/ "{founder}" "{company}"`.
3. Calls SerperClient via DI'd factory.
4. Filters organic results: first hit whose `link` matches `^https://(www\.)?linkedin\.com/in/`.
5. Returns `{ url: string | null, candidates: SerperOrganicResult[] }`.

If `ctx.input.founder` is missing, status:'empty' (no founder name to search for).

If Serper call fails, status:'error'.

Use the **factory pattern** for DI: export `makeVoiceFounderLinkedinUrlAdapter(serperFactory: (env: Env) => SerperClient)` so tests can inject a fake. Default export uses `createSerperClient` with `env.SERPER_API_KEY`.

```ts
export const VoiceFounderLinkedinUrlPayloadSchema = z.object({
  url: z.string().url().nullable(),
  candidates: z.array(z.object({
    title: z.string(),
    link: z.string().url(),
    snippet: z.string(),
  })).max(5),
});
```

`requiredEnv: ['SERPER_API_KEY']`. `estimatedCostInr: 0.03`. `module: 'voice'`.

Tests (5):
1. Contract surface
2. Returns ok with URL when Serper finds linkedin.com/in/ result
3. Returns empty when no founder name provided
4. Returns ok with URL when input.founderLinkedinUrl is already set (no Serper call)
5. Returns error when Serper throws

Commit message: `feat(radar-trace): voice.founder_linkedin_url adapter (Serper site-search for founder profile)`

---

### Task 4.4: voice.founder_github_url adapter

Same pattern as 4.3. Query: `site:github.com "{founder}" "{company}"`. Filter: first hit whose link matches `^https://github\.com/[^/]+/?$` (org page) or `^https://github\.com/[^/]+$` (user page).

Tests (4): contract, ok with URL, empty when no founder, error on serper failure.

Commit message: `feat(radar-trace): voice.founder_github_url adapter`

---

### Task 4.5: voice.linkedin_pulse adapter

Same pattern. Query: `site:linkedin.com/pulse/ "{founder}"` (or company name if no founder). Returns ALL filtered organic results (not just first):

```ts
{
  articles: Array<{
    title: string;
    url: string;
    snippet: string;
  }>;
}
```

Filter: links matching `^https://(www\.)?linkedin\.com/pulse/`.

Tests (3): contract, returns multiple articles, empty when no matches.

Commit message: `feat(radar-trace): voice.linkedin_pulse adapter (Serper snippet retrieval, no LinkedIn scrape)`

---

### Task 4.6: voice.podcast_appearances adapter

**Files:**
- Create: `tools/radar-trace/src/adapters/voice/podcastAppearances.ts`
- Create: `tools/radar-trace/tests/adapters/voice/podcastAppearances.test.ts`
- Create: `tools/radar-trace/tests/fixtures/voice/listennotes-search.json`

Listen Notes API: `GET https://listen-api.listennotes.com/api/v2/search?q={Q}&type=episode` with `X-ListenAPI-Key` header. Free tier: 1000 calls/mo. Returns episode objects with podcast title, episode title, audio_url, pub_date_ms.

Query: `"{founder}" OR "{company}"`. Filter: episodes (not podcasts). Top 10 by date.

Output:

```ts
{
  episodes: Array<{
    podcastName: string;
    episodeTitle: string;
    publishedAt: string;     // ISO from pub_date_ms
    listenNotesUrl: string;
    audioUrl: string | null;
    descriptionExcerpt: string;
  }>;
  totalFound: number;
}
```

`requiredEnv: ['LISTEN_NOTES_KEY']`. `estimatedCostInr: 0` (free tier — but note that beyond 1k/mo it becomes $0.0036/call).

3 tests: contract, parses fixture, error on 4xx.

Commit message: `feat(radar-trace): voice.podcast_appearances adapter (Listen Notes search)`

---

### Task 4.7: voice.youtube_channel adapter

**Files:**
- Create: `tools/radar-trace/src/adapters/voice/youtubeChannel.ts`
- Create: `tools/radar-trace/tests/adapters/voice/youtubeChannel.test.ts`

This adapter is unique: first uses Serper to find a YouTube channel URL (`site:youtube.com/@{handle}` or `site:youtube.com/channel/`), then fetches the channel's RSS feed.

YouTube channel RSS pattern: `https://www.youtube.com/feeds/videos.xml?channel_id={ID}` (for `/channel/` URLs) or `https://www.youtube.com/feeds/videos.xml?user={handle}` (legacy). The `@{handle}` URLs require an extra HTML fetch to extract the channel ID from the page meta tags.

Output:

```ts
{
  channelUrl: string | null;
  channelId: string | null;
  recentVideos: Array<{
    title: string;
    url: string;
    publishedAt: string;
    description: string;
  }>;
}
```

`requiredEnv: ['SERPER_API_KEY']`. `estimatedCostInr: 0.03` (one Serper call). Top 15 videos.

4 tests: contract, finds channel via @handle (with HTML extraction), finds channel via /channel/ID directly, empty when no YouTube presence.

Commit message: `feat(radar-trace): voice.youtube_channel adapter (Serper lookup + RSS feed)`

---

### Task 4.8: positioning.crunchbase_snippet adapter

Same Serper pattern as 4.3. Query: `site:crunchbase.com "{company}"`. Returns:

```ts
{
  crunchbaseUrl: string | null;
  snippet: string | null;     // first 200 chars of organic[0].snippet
  // Crunchbase pages are paywalled; we extract what we can from the snippet
  fundingHint: string | null; // regex match for "raised $X" / "Series A/B/C" patterns
}
```

3 tests: contract, finds URL + snippet, regex extracts funding hints.

Commit message: `feat(radar-trace): positioning.crunchbase_snippet adapter`

---

### Task 4.9: positioning.brave_news adapter

**Files:**
- Create: `tools/radar-trace/src/adapters/positioning/braveNews.ts`
- Create: `tools/radar-trace/tests/adapters/positioning/braveNews.test.ts`

Uses BraveClient (Task 4.2). Query: `"{company}" {domain}` (both terms increase precision for B2B targets). Top 10 news results.

Output:

```ts
{
  results: Array<{
    title: string;
    url: string;
    description: string;
    source: string;
    publishedAt: string | null;
  }>;
}
```

3 tests: contract, parses fixture, empty when no results.

Commit message: `feat(radar-trace): positioning.brave_news adapter`

---

### Task 4.10: positioning.serper_news adapter

Mirror of `brave_news` using SerperClient.newsSearch(). Same output shape. The two complement each other (different sources, different ranking) — operators can union the two for higher recall.

3 tests. Commit message: `feat(radar-trace): positioning.serper_news adapter`

---

### Task 4.11: ads.meta_library_url + ads.google_transparency_url adapters (URL constructors)

**Files:**
- Create: `tools/radar-trace/src/adapters/ads/metaLibraryUrl.ts`
- Create: `tools/radar-trace/src/adapters/ads/googleTransparencyUrl.ts`
- Create: `tools/radar-trace/tests/adapters/ads/urlConstructors.test.ts`

These two are the simplest adapters in the spec — they construct a URL and return it. No HTTP fetch. No external dependencies. ~30 lines each.

Meta Ad Library URL pattern:
```
https://www.facebook.com/ads/library/?active_status=all&search_type=keyword_unordered&q={URL-encoded company name}&country=ALL
```

Google Ads Transparency Center URL pattern:
```
https://adstransparency.google.com/?domain={domain}&region=anywhere
```

Output for both:

```ts
{ url: string }
```

`requiredEnv: []`. `estimatedCostInr: 0`. `module: 'ads'`. Always returns status:'ok' (URL construction can't fail short of empty inputs which schema validation catches).

2 tests for both: contract + URL is correctly constructed and URL-encoded.

Commit message: `feat(radar-trace): ads URL constructor adapters (Meta + Google transparency)`

---

### Task 4.12: social.links adapter

**Files:**
- Create: `tools/radar-trace/src/adapters/social/links.ts`
- Create: `tools/radar-trace/tests/adapters/social/links.test.ts`
- Create: `tools/radar-trace/tests/fixtures/social/homepage-with-social.html`

Adapter:
1. Fetches homepage.
2. Cheerio: extracts all `<a href>` URLs.
3. Filters/categorizes by host:
   - LinkedIn: `linkedin.com/company/...` (skip `/in/` since that's founder, captured by voice.founder_linkedin_url)
   - X/Twitter: `twitter.com/...` or `x.com/...`
   - Instagram: `instagram.com/...`
   - Facebook: `facebook.com/...`
   - YouTube: `youtube.com/...` (skip if matches @handle pattern — that's voice.youtube_channel's job)
4. Deduplicates per category.

Output:

```ts
{
  linkedinCompany: string | null;
  twitter: string | null;          // canonical handle URL
  instagram: string | null;
  facebook: string | null;
  youtube: string | null;
  otherSocial: string[];           // GitHub, Mastodon, Bluesky, etc. caught loosely
}
```

3 tests: contract, parses fixture with all 5 platforms, empty when no social links.

Commit message: `feat(radar-trace): social.links adapter (homepage social URL extraction)`

---

### Task 4.13: Wire all 11 new adapters into cli.ts

Add 11 imports + 11 entries in `ALL_ADAPTERS`. Update `computeCostBreakdown` if any new branches needed (Brave for `positioning.brave_news`, Listen Notes for `voice.podcast_appearances`).

Commit message: `feat(radar-trace): wire Chunk 4 adapters into CLI (voice + positioning + ads URLs + social links)`

---

## Chunk 4 complete checkpoint

After this chunk:
- 28 adapters wired (17 from Chunk 3 + 11 new)
- 2 new shared clients (`SerperClient`, `BraveClient`)
- Voice + Positioning modules un-stubbed
- Test count ~210-225

Verify:

```bash
cd tools/radar-trace && npm test && npm run typecheck && npx tsx src/cli.ts --company "Acme" --domain acme.com 2>/dev/null | jq '.adapters | keys | length'
```

Expected: `28`.

---

## Chunk 5: Sub-phase 1A.4 — Directories + first Apify + gate predicate logic

This chunk adds 6 directory adapters AND introduces the first paid Apify integration (LinkedIn Company Page scraper). It's also where the gate predicate pattern lands its first real use — `g2_capterra` and `glassdoor_apify` are gated.

Critical: the **shared `ApifyClient`** built in this chunk is reused by all 6 paid Apify adapters in Chunk 6. Get it right here.

| Adapter | Module | Method | Cost | Gate |
|---|---|---|---|---|
| `directories.zaubacorp` | directories | HTML scrape (port `src/core/signals/adapters/corpFilings.js`) | Free | None |
| `directories.ambitionbox` | directories | HTML scrape | Free | None |
| `directories.crunchbase_url` | directories | URL constructor | Free | None |
| `directories.linkedin_company_apify` | directories | Apify | ~₹50 | None |
| `directories.g2_capterra` | directories | HTML scrape | Free | `tech_stack` shows B2B SaaS markers |
| `directories.glassdoor_apify` | directories | Apify | ~₹100 | `zaubacorp.payload.country !== 'India'` |

**End state of chunk:** 34 adapters wired. Test count ~245-260. First Apify cost shows up in dossier. Two-wave gate execution observable in real runs.

---

### Task 5.1: ApifyClient shared module

**Files:**
- Create: `tools/radar-trace/src/clients/apify.ts`
- Create: `tools/radar-trace/tests/clients/apify.test.ts`
- Create: `tools/radar-trace/tests/fixtures/apify/run-sync-response.json`

Apify REST API: `POST https://api.apify.com/v2/acts/{actor}/run-sync-get-dataset-items?token={TOKEN}` returns the dataset rows directly. Cost is per-result, varies by actor ($5/1000 for most posts/profiles, $0.75/1000 for Meta Ad Library).

The client takes a generic `runActor(actor, input, options)` method that:
1. POSTs to the run-sync endpoint with the actor's `input` JSON
2. Awaits the response (Apify holds the connection until the run completes — typical 5-60s)
3. Parses the array of dataset rows
4. Returns `{ items: T[], costUsd: number }` where `costUsd` is the count × per-result rate

The PER-ACTOR per-result rate is parameterized — caller passes `costPerResultUsd` to `runActor()`.

```ts
export interface ApifyClient {
  runActor<T>(opts: {
    actor: string;                         // e.g. 'apimaestro/linkedin-profile-posts'
    input: Record<string, unknown>;        // actor-specific input JSON
    costPerResultUsd: number;              // e.g. 0.005 for $5/1000
    maxResults?: number;                   // safety cap; defaults 100
    signal?: AbortSignal;
    timeoutMs?: number;                    // default 90000
  }): Promise<{ items: T[]; costUsd: number; truncated: boolean }>;
}

export interface CreateApifyClientOptions {
  token: string;
  http?: typeof fetch;
}

export function createApifyClient(opts: CreateApifyClientOptions): ApifyClient { /* ... */ }
```

The `truncated: boolean` flag is set if the actor returned more than `maxResults` (we slice and report). This protects against a single run racking up surprise cost when an actor returns 10,000 results.

Tests (6):
1. Contract surface (the factory returns an object with `runActor`)
2. POSTs to the right URL with token in query string
3. Sends the input JSON in body
4. Parses returned dataset and computes cost (count × rate)
5. Truncates at `maxResults` and sets `truncated: true`
6. Throws on non-2xx

**This is the foundation for all 8 Apify adapters (2 in Chunk 5 — `linkedin_company_apify` + `glassdoor_apify` — plus 6 in Chunk 6). Take the time to get it right; consider establishing the same step-by-step TDD pattern that Task 4.1 SerperClient uses (failing test → impl → passing test, with full code bodies). The narrative-form description here is shorthand — when implementing, follow the SerperClient template.**

Commit message: `feat(radar-trace): ApifyClient shared module (run-sync API + cost tracking + truncation)`

---

### Task 5.2: directories.zaubacorp adapter (port from legacy)

**Files:**
- Create: `tools/radar-trace/src/adapters/directories/zaubacorp.ts`
- Create: `tools/radar-trace/tests/adapters/directories/zaubacorp.test.ts`
- Create: `tools/radar-trace/tests/fixtures/directories/zaubacorp-tofler.html`
- Read for reference: `src/core/signals/adapters/corpFilings.js`

The legacy adapter at `src/core/signals/adapters/corpFilings.js` already scrapes Tofler (which aggregates ZaubaCorp + ROC data). Port the scraping logic to TS, normalize the output, add the new `Adapter<T>` contract.

Output:

```ts
{
  toflerUrl: string | null;        // permalink to the company's Tofler page
  cin: string | null;              // Corporate Identification Number (India MCA)
  registeredOn: string | null;     // ISO
  registrar: string | null;
  status: string | null;           // e.g. "Active", "Strike Off"
  paidUpCapitalInr: number | null;
  authorizedCapitalInr: number | null;
  directors: Array<{ name: string; din: string | null; appointedOn: string | null }>;
  registeredAddress: string | null;
  country: string;                 // always 'India' for this adapter (used by glassdoor_apify gate)
}
```

The `country: 'India'` field is hardcoded since this adapter is India-specific. **This is what `glassdoor_apify`'s gate (Task 5.7) checks.**

`requiredEnv: []`. Anti-bot: Tofler has Cloudflare; expect occasional 403. Status:'error' on 403 is acceptable; mention this in adapter docstring. Add `cacheTtlMs: 7 * 86400000` (7 days — corporate data is stable; reduces Tofler rate-limit pressure).

3-4 tests: contract, parses fixture with full data, parses fixture with missing optional fields (partial), 403 → error.

Commit message: `feat(radar-trace): directories.zaubacorp adapter (Tofler India MCA scrape)`

---

### Task 5.3: directories.ambitionbox adapter

**Files:**
- Create: `tools/radar-trace/src/adapters/directories/ambitionbox.ts`
- Create: `tools/radar-trace/tests/adapters/directories/ambitionbox.test.ts`
- Create: `tools/radar-trace/tests/fixtures/directories/ambitionbox-acme.html`

URL pattern: `https://www.ambitionbox.com/overview/{slug}-overview`. Slug typically lowercases the company name with hyphens. Adapter tries `name.toLowerCase().replace(/\s+/g, '-')` first; if 404, tries with `-1` suffix; if still 404, status:'empty'.

Cheerio extraction:

```ts
{
  ambitionboxUrl: string | null;
  rating: number | null;          // overall rating /5
  reviewCount: number | null;
  industry: string | null;
  employeeCount: string | null;   // e.g. "501-1000 employees"
  headquarters: string | null;
  yearFounded: number | null;
  ceoName: string | null;
  ratings: {                      // category breakdown if visible
    salaryAndBenefits: number | null;
    workLifeBalance: number | null;
    cultureAndValues: number | null;
    careerGrowth: number | null;
  };
}
```

`cacheTtlMs: 3 * 86400000` (3 days — review counts move slowly). 3 tests.

Commit message: `feat(radar-trace): directories.ambitionbox adapter (Indian employer review aggregation)`

---

### Task 5.4: directories.crunchbase_url adapter

URL constructor only — no fetch. Pattern: `https://www.crunchbase.com/organization/{slug}`. Returns `{ url: string }`. 2 tests.

(Note: `positioning.crunchbase_snippet` from Chunk 4 fetches the actual snippet via Serper; this adapter just emits the URL for the dashboard to link to.)

Commit message: `feat(radar-trace): directories.crunchbase_url adapter (URL constructor)`

---

### Task 5.5: directories.linkedin_company_apify adapter (FIRST Apify integration)

**Files:**
- Create: `tools/radar-trace/src/adapters/directories/linkedinCompanyApify.ts`
- Create: `tools/radar-trace/tests/adapters/directories/linkedinCompanyApify.test.ts`
- Create: `tools/radar-trace/tests/fixtures/apify/linkedin-company.json`

This is the first paid Apify adapter. Pattern established here is reused by all of Chunk 6.

Actor: TBD during implementation — Apify has multiple LinkedIn Company scrapers. Default proposal: `apify/linkedin-company-scraper` or `dev_fusion/linkedin-company-scraper`. Pick based on reviews + cost during implementation; document choice in adapter file comment.

Input to actor:
```json
{
  "linkedinCompanyUrl": "https://www.linkedin.com/company/acme/",
  "limit": 1
}
```

If LinkedIn company URL is unknown, adapter first calls SerperClient with `site:linkedin.com/company/ "{name}"` to discover it, then runs Apify. (This makes the adapter optionally Serper-dependent — declare both `SERPER_API_KEY` and `APIFY_TOKEN` in `requiredEnv`.)

Alternative: rely on `social.links.linkedinCompany` from Chunk 4 — but that's a Wave 1 adapter, and `linkedin_company_apify` is also Wave 1 (no gate). They run in parallel, so we can't depend on its result. **Decision: do the Serper lookup inline in this adapter.** Costs an extra ₹0.03 in Serper but keeps Wave 1 simple.

Output:

```ts
{
  linkedinCompanyUrl: string | null;
  name: string | null;
  industry: string | null;
  description: string | null;     // company tagline
  employeeCountVerified: string | null;   // "501-1000 employees"
  headquarters: string | null;
  founded: number | null;
  specialties: string[];
  followerCount: number | null;
}
```

Use the **factory pattern**: `makeLinkedinCompanyApifyAdapter(deps: { serper: SerperFactory, apify: ApifyFactory })` so tests can inject fakes for both.

`cacheTtlMs: 7 * 86400000` (7 days). `estimatedCostInr: 50`. Cost computed: serper (~₹0.03) + Apify (1 result × $0.005 × ₹84 = ~₹0.42) ≈ ₹0.45 actual; estimate is conservative.

5 tests:
1. Contract surface
2. Discovers URL via Serper, then runs Apify, returns ok
3. Returns empty when Serper finds no LinkedIn company URL
4. Returns error when Apify throws
5. Cost is reported correctly in `costMeta.costUsd`

Commit message: `feat(radar-trace): directories.linkedin_company_apify adapter (first Apify integration; Serper lookup + Apify run)`

---

### Task 5.6: directories.g2_capterra adapter (FIRST gated adapter)

**Files:**
- Create: `tools/radar-trace/src/adapters/directories/g2Capterra.ts`
- Create: `tools/radar-trace/tests/adapters/directories/g2Capterra.test.ts`

This adapter is **gated** — it only runs when the company is detected as B2B SaaS. Gate logic:

```ts
gate(partial) {
  const techStack = partial['operational.tech_stack'];
  if (!techStack || techStack.status !== 'ok' || !techStack.payload) return false;
  const payload = techStack.payload as { techStack?: Array<{ category: string }> };
  const categories = new Set((payload.techStack ?? []).map((t) => t.category));
  // SaaS markers: payments + analytics + auth/CRM all together suggests product-on-the-web
  const saasMarkers = ['payments', 'cdp', 'crm', 'auth', 'monitoring'];
  const matchCount = saasMarkers.filter((m) => categories.has(m)).length;
  return matchCount >= 2;
}
```

The gate fires when the operational adapter (Wave 1) detects ≥2 of the SaaS markers in the company's tech stack.

Adapter logic: searches G2 (`https://www.g2.com/search?query={name}`) and Capterra (`https://www.capterra.com/search/?q={name}`). Both return search result pages; cheerio extracts the first product URL + rating + review count.

Output:

```ts
{
  g2: { url: string | null; rating: number | null; reviewCount: number | null; category: string | null } | null;
  capterra: { url: string | null; rating: number | null; reviewCount: number | null; category: string | null } | null;
}
```

If neither finds a match → status:'empty'.

Tests (4): contract, gate returns false when tech_stack is errored/missing, gate returns true when SaaS markers present, ok when search finds results.

Commit message: `feat(radar-trace): directories.g2_capterra adapter (gated on tech_stack SaaS markers)`

---

### Task 5.7: directories.glassdoor_apify adapter (gated, Apify)

Pattern: gated like 5.6, paid like 5.5. Gate:

```ts
gate(partial) {
  const zauba = partial['directories.zaubacorp'];
  if (!zauba || zauba.status !== 'ok' || !zauba.payload) return false;
  const payload = zauba.payload as { country?: string };
  // If we have Tofler data with country='India', the company is Indian — AmbitionBox covers it.
  // Glassdoor is more useful for global/US-headquartered targets.
  return payload.country !== 'India';
}
```

Apify actor TBD (multiple Glassdoor scrapers exist). Cost: ~$0.005/result. Output: ratings, review counts, CEO ratings, recent interview reviews summarized.

Tests (4): contract, gate returns false for Indian companies, gate returns true for non-Indian, ok with Apify result.

Commit message: `feat(radar-trace): directories.glassdoor_apify adapter (gated, runs only for non-India targets)`

---

### Task 5.8: Wire all 6 directory adapters into cli.ts; verify gates work end-to-end

Add 6 imports + 6 entries in `ALL_ADAPTERS`. Add Apify cost tracking in `computeCostBreakdown`.

End-to-end smoke test:

```bash
cd tools/radar-trace
APIFY_TOKEN=fake SERPER_API_KEY=fake npx tsx src/cli.ts --company "Mobcast" --domain mobcast.in --modules operational,directories 2>/dev/null | jq '{
  techStackOk: .adapters."operational.tech_stack".status,
  zaubaOk: .adapters."directories.zaubacorp".status,
  g2Status: .adapters."directories.g2_capterra".status,
  glassdoorStatus: .adapters."directories.glassdoor_apify".status
}'
```

Expected: g2 status either `ok` or `empty` (depending on tech stack detection); glassdoor status `empty` (gate returns false — Mobcast is Indian).

Commit message: `feat(radar-trace): wire Chunk 5 adapters into CLI (directories module + first gates)`

---

## Chunk 5 complete checkpoint

After this chunk:
- 34 adapters wired (28 from Chunk 4 + 6 new)
- ApifyClient operational; first paid scraper integrated
- Gate predicate pattern proven on `g2_capterra` and `glassdoor_apify`
- Test count ~245-260

Verify:

```bash
cd tools/radar-trace && npm test && npm run typecheck
```

Both green. Smoke test against Mobcast confirms gate logic works.

---

## Chunk 6: Sub-phase 1A.5 — Paid Apify scrapers (6 adapters)

This chunk adds 6 Apify-paid adapters. After Chunk 5 established the `ApifyClient` pattern and cost tracking, these are mostly templated work — each follows the same shape with input/output differences per actor.

| Adapter | Module | Apify actor | Cost/lead |
|---|---|---|---|
| `voice.linkedin_posts_apify` | voice | `apimaestro/linkedin-profile-posts` | ~₹100 |
| `social.twitter_posts_apify` | social | TBD (Apify Twitter scraper) | ~₹100 |
| `social.instagram_posts_apify` | social | TBD (Apify Instagram scraper) | ~₹100 |
| `social.facebook_posts_apify` | social | TBD (Apify Facebook page scraper) | ~₹100 |
| `ads.meta_creatives_apify` | ads | `curious_coder/facebook-ad-library-scraper` | ~₹15 |
| `ads.google_creatives_apify` | ads | `silva95gustavo/google-ads-scraper` | ~₹15-50 |

**End state of chunk:** 40 adapters wired (34 from Chunk 5 + 6 new). All 30 spec-defined adapters operational. Test count ~280-300.

Note: the spec said "30 adapters total" but the per-source split brought us to 40. The extras come from splitting `product.github_*` into 3 adapters and `customer.*` into 2 — both reflect real per-source granularity rather than "more features."

---

### Task 6.1: voice.linkedin_posts_apify adapter (canonical paid Apify pattern)

**Files:**
- Create: `tools/radar-trace/src/adapters/voice/linkedinPostsApify.ts`
- Create: `tools/radar-trace/tests/adapters/voice/linkedinPostsApify.test.ts`
- Create: `tools/radar-trace/tests/fixtures/apify/linkedin-posts.json`

This is the canonical pattern for paid Apify content scrapers. Subsequent adapters (Twitter, Instagram, Facebook, Meta ads, Google ads) follow the same structure with input/output differences.

The adapter:
1. Reads `ctx.input.founderLinkedinUrl` if set; else falls back to `partial['voice.founder_linkedin_url']?.payload?.url` if available; else status:'empty' with note "no founder URL".

   **Wait** — `voice.founder_linkedin_url` is Wave 1, and `voice.linkedin_posts_apify` is also Wave 1 (no gate). They run in parallel. So we can't read its result.

   **Two options:**
   - **A)** Make this adapter Wave 2 (gated on `voice.founder_linkedin_url` having an `ok` payload with a non-null URL). This adds a gate — but the gate is purely "is the founder URL known?" which is reasonable.
   - **B)** Have this adapter independently call Serper to find the URL (like `directories.linkedin_company_apify` does in Chunk 5). Cost: extra ₹0.03 in Serper, but avoids Wave 2 dependency.

   **Decision: B (independent Serper lookup).** Reason: Wave 2 should stay minimal. The Serper cost is negligible vs. the Apify cost for posts. Document this in the adapter file.

2. Calls Apify `apimaestro/linkedin-profile-posts` actor with `{ profileUrl, limit: 50 }`.
3. Parses returned post objects: text, reactions count, comments count, posted timestamp, media (image/video URL if present).

Output:

```ts
{
  founderLinkedinUrl: string | null;
  posts: Array<{
    text: string;                  // truncated to 1500 chars
    postedAt: string | null;       // ISO
    reactionsCount: number | null;
    commentsCount: number | null;
    sharesCount: number | null;
    postUrl: string | null;
    mediaType: 'image' | 'video' | 'article' | 'none';
    mediaUrl: string | null;
  }>;
  totalFetched: number;
}
```

Use the **factory pattern**:

```ts
export function makeVoiceLinkedinPostsApifyAdapter(deps: {
  serper: (env: Env) => SerperClient;
  apify: (env: Env) => ApifyClient;
}): Adapter<VoiceLinkedinPostsApifyPayload>
```

`requiredEnv: ['APIFY_TOKEN', 'SERPER_API_KEY']`. `estimatedCostInr: 100` (50 posts × $0.005 × ₹84 ≈ ₹21, but conservative cap accounts for higher post counts).

`cacheTtlMs: 6 * 60 * 60 * 1000` (6 hours — posts are time-sensitive; want fresher data than the default 24h).

Tests (5):
1. Contract surface
2. Discovers URL via Serper, runs Apify, returns posts
3. Returns empty when Serper finds no URL AND `founderLinkedinUrl` not provided
4. Returns ok with URL from `ctx.input.founderLinkedinUrl` (no Serper call)
5. Cost reported correctly in `costMeta.costUsd` and `costPaise`

Commit message: `feat(radar-trace): voice.linkedin_posts_apify adapter (canonical paid Apify pattern)`

---

### Task 6.2: social.twitter_posts_apify adapter

Same pattern as 6.1. Differences:
- Input: Twitter handle URL (extracted from `social.links.twitter` if available — but per the Wave 1 parallel constraint, this adapter does its own homepage fetch + regex extraction OR uses Serper if homepage fails).
- Apify actor: `apify/twitter-scraper-lite` or similar; choose during implementation. Document which one + cost-per-result.
- Output: array of tweets `{ text, postedAt, likes, retweets, quoteCount, tweetUrl, mediaType }`.

`cacheTtlMs: 6 * 60 * 60 * 1000`. Tests (4).

Commit message: `feat(radar-trace): social.twitter_posts_apify adapter`

---

### Task 6.3: social.instagram_posts_apify adapter

Same pattern. Apify actor: `apify/instagram-scraper`. Output: array of posts `{ caption, postedAt, likes, comments, mediaType, mediaUrl, postUrl }`. Tests (4).

Commit message: `feat(radar-trace): social.instagram_posts_apify adapter`

---

### Task 6.4: social.facebook_posts_apify adapter

Same pattern. Apify actor: choose Facebook page scraper. Tests (4).

Commit message: `feat(radar-trace): social.facebook_posts_apify adapter`

---

### Task 6.5: ads.meta_creatives_apify adapter

**Files:**
- Create: `tools/radar-trace/src/adapters/ads/metaCreativesApify.ts`
- Create: `tools/radar-trace/tests/adapters/ads/metaCreativesApify.test.ts`
- Create: `tools/radar-trace/tests/fixtures/apify/meta-creatives.json`

Apify actor: `curious_coder/facebook-ad-library-scraper` ($0.75/1000 — lowest-cost paid scraper in spec). Input: `{ keyword: companyName, country: 'IN', activeOnly: true, limit: 100 }`.

Output:

```ts
{
  totalActiveAds: number;
  creatives: Array<{
    adId: string;
    pageName: string;
    adText: string | null;        // primary text/copy
    headline: string | null;
    callToAction: string | null;
    landingUrl: string | null;
    mediaType: 'image' | 'video' | 'carousel';
    mediaUrl: string | null;
    targeting: {
      countries: string[];
      ageMin: number | null;
      ageMax: number | null;
      gender: string | null;
    };
    runningSinceDate: string | null;
    runningDays: number | null;
  }>;
}
```

`estimatedCostInr: 15` (`100 results × $0.00075 × ₹84 ≈ ₹6.30`; conservative cap ₹15). 4 tests.

Commit message: `feat(radar-trace): ads.meta_creatives_apify adapter (Meta Ad Library — public transparency surface)`

---

### Task 6.6: ads.google_creatives_apify adapter

Apify actor: `silva95gustavo/google-ads-scraper`. Input: `{ domain, region: 'anywhere' }`. Pricing TBD — verify during implementation. Output similar to Meta but Google-specific fields. Tests (4).

Commit message: `feat(radar-trace): ads.google_creatives_apify adapter (Google Ads Transparency Center)`

---

### Task 6.7: Wire all 6 paid adapters into cli.ts; final smoke test

Add 6 imports + 6 `ALL_ADAPTERS` entries. Update `computeCostBreakdown` — all 6 contribute to `apifyUsd`.

End-to-end smoke test (with `--skip-paid` since real Apify costs would burn budget — that flag is built in Chunk 7, but for now we run with stubbed APIFY_TOKEN that fails fast and returns errors):

```bash
cd tools/radar-trace && APIFY_TOKEN=fake-will-fail npx tsx src/cli.ts --company "Acme" --domain acme.com 2>/dev/null | jq '.adapters | to_entries | map({name: .key, status: .value.status}) | length'
```

Expected: `40` (all 40 adapters present in dossier). The Apify adapters return either `status:'error'` (fake token rejected by Apify) or `status:'empty'` (the gated `glassdoor_apify` may skip for Indian targets even without making an Apify call). The non-Apify adapters run normally with whatever data the network gives them.

Commit message: `feat(radar-trace): wire Chunk 6 adapters into CLI (all 6 paid Apify scrapers); 40 adapters total`

---

## Chunk 6 complete checkpoint

After this chunk:
- 40 adapters wired (34 from Chunk 5 + 6 new)
- All paid Apify scrapers operational (LinkedIn posts, Twitter/Instagram/Facebook posts, Meta + Google ad creatives)
- Test count ~280-300

Verify:

```bash
cd tools/radar-trace && npm test && npm run typecheck && APIFY_TOKEN=fake npx tsx src/cli.ts --company "Acme" --domain acme.com 2>/dev/null | jq '.adapters | length'
```

Expected: tests + typecheck green; adapter count = 40.

---

## Chunk 7: Sub-phase 1A.6 — CLI polish + pre-flight cost + validation runs

This final chunk adds the operator-facing CLI flags, the pre-flight cost ceiling, the README rewrite, and runs **5 real validation traces** against actual ready leads from your pipeline. It's the one chunk where real money may be spent (Apify-paid runs).

| Task | What it adds |
|---|---|
| 7.1 | `--skip-paid` flag — runs only the ~33 free + Serper + Brave + Listen Notes adapters |
| 7.2 | `--max-cost-inr <n>` flag — pre-flight worst-case cost check; aborts run if exceeded |
| 7.3 | `--adapters <list>` flag — granular adapter selection (existing was module-level only) |
| 7.4 | `--linkedin <url>` flag — pre-supplies founder LinkedIn URL, skips Serper resolution |
| 7.5 | README rewrite (drops radar-enrich validation framing) |
| 7.6 | 5 real validation traces |
| 7.7 | Bug fixes from real-data findings |

**End state of chunk:** Phase 1A complete. Ready for Phase 1.5 / Phase 2 promotion decision per spec §13.6 acceptance criterion.

---

### Task 7.1: --skip-paid flag

**Files:**
- Modify: `tools/radar-trace/src/cli.ts`
- Modify: `tools/radar-trace/tests/cli.test.ts`

Adds boolean flag to commander definition. When set, filters `ALL_ADAPTERS` to exclude any adapter whose name contains `_apify`. Pre-filter happens BEFORE the orchestrator runs (not as a gate).

Acceptance: `radar-trace --company X --domain Y --skip-paid` produces a dossier where all `*_apify` adapters appear with `status:'empty'` and `payload:null`. Cost should be ~₹2/lead (Serper + Brave only).

Test (1 new): `--skip-paid` excludes Apify adapters from the run.

Commit message: `feat(radar-trace): --skip-paid CLI flag for validation-cost mode`

---

### Task 7.2: --max-cost-inr flag with pre-flight check

**Files:**
- Modify: `tools/radar-trace/src/cli.ts`
- Modify: `tools/radar-trace/tests/cli.test.ts`

Adds `--max-cost-inr <n>` (default: undefined = no cap). Before adapters run:

1. Sum `estimatedCostInr` across enabled adapters (post `--modules` / `--adapters` / `--skip-paid` filtering).
2. If `--max-cost-inr` is set AND sum exceeds it → log error listing offenders, exit 1.
3. Otherwise log `pre-flight estimated cost (worst case): ₹X.YZ` and proceed.
4. After run, log `actual cost: ₹X.YZ`.

The pre-flight is **worst-case** because it doesn't know which gates will fire — it assumes all do. Document this in the help text.

Tests (3): pre-flight under threshold proceeds, pre-flight over threshold exits 1, actual cost may differ from pre-flight.

Commit message: `feat(radar-trace): --max-cost-inr pre-flight cost ceiling (worst-case, exits 1 if exceeded)`

---

### Task 7.3: --adapters flag (granular adapter selection)

Adds `--adapters hiring.adzuna,operational.crtsh,...`. When set, overrides `--modules` selection and runs ONLY the listed dotted-name adapters.

Validates each name against the `ALL_ADAPTERS` registry; unknown name → exit 1 with helpful error.

Test (2): runs only listed adapters, rejects unknown adapter name.

Commit message: `feat(radar-trace): --adapters CLI flag for granular per-source selection`

---

### Task 7.4: --linkedin flag (pre-supplied founder URL)

Adds `--linkedin <url>`. Sets `ctx.input.founderLinkedinUrl`. The voice + linkedin posts adapters check this field first and skip their Serper lookup if it's set.

Test (1): when set, the relevant adapters don't make Serper calls (assert via spy).

Commit message: `feat(radar-trace): --linkedin flag bypasses Serper founder URL resolution`

---

### Task 7.5: README rewrite

**Files:**
- Replace: `tools/radar-trace/README.md`

Drop the "validation prototype" framing entirely. Sections:

1. **What this is** — one-paragraph framing as production data collection layer (Phase 1A; Phase 2 deferred AI; Phase 1.5 deferred monitoring)
2. **Quick start** — `npm install`, `cp .env.example .env`, fill keys, basic `npm run trace -- --company X --domain Y`
3. **Modules and adapters** — table of all 9 modules + 40 adapters with brief description
4. **CLI reference** — all flags from spec §10
5. **Cost economics** — per-lead and per-month at production scale (numbers from spec §4.10)
6. **Troubleshooting** — what each non-`ok` status means, common Apify failure modes, how to use `--skip-paid` for cheap validation
7. **Promotion path** — when to invest in Phase 1.5 (temporal monitoring) and Phase 2 (Sonnet synthesis)

Don't include implementation details — the spec doc is the authoritative reference.

Commit message: `docs(radar-trace): full README — Phase 1A operator guide`

---

### Task 7.6: Real validation runs on 5 ready leads

**Manual operator step.** Pick 5 actual ready leads from the Radar pipeline. Populate `.env` with real keys (Adzuna, GitHub, Serper, Brave, Listen Notes, Apify). Run:

```bash
mkdir -p profiles
for entry in \
  "Lead1:lead1.com:Mumbai" \
  "Lead2:lead2.io:Bengaluru" \
  "Lead3:lead3.in:Delhi" \
  "Lead4:lead4.co:Hyderabad" \
  "Lead5:lead5.com:Pune"
do
  IFS=':' read -r name domain location <<< "$entry"
  npx tsx src/cli.ts \
    --company "$name" --domain "$domain" --location "$location, India" \
    --max-cost-inr 700 \
    --verbose \
    --out "profiles/${domain}.json" 2>"profiles/${domain}.log"
done
```

For each dossier:
- Operator reviews the 40 adapter outputs
- Operator marks each adapter as "informative" or "noise" for that specific lead
- Operator notes any anti-bot blocks or unexpected schema issues

**Spec §13.6 acceptance criterion (quantitative):**
- ✅ All 40 adapters runnable on 5 real leads without crashing
- ✅ Total cost per lead within ±20% of §4.10 estimate (₹400-744)
- ✅ ≥3 of 5 dossiers surface a signal an operator wouldn't have written manually

(Note: spec §13.6 wording says "all 30 adapters" — that figure reflects the original spec's per-module count before per-source granularity tripled some modules. The actual Phase 1A delivery is 40 adapters, reconciled by the count rollup in Chunk 2's intro and Chunk 6's intro. The acceptance gate applies to whichever count actually shipped — i.e., 40.)

Document findings in `tools/radar-trace/profiles/VALIDATION_REPORT.md` (new file).

---

### Task 7.7: Bug fixes from real-data findings

Based on Task 7.6 findings, fix bugs surfaced by real data. Likely categories:

- **Anti-bot blocks** — adjust User-Agent, add HTTP retry with backoff for specific sources, document failed sources
- **Schema drift** — adapters returning fields outside the schema (e.g., LinkedIn changed a field name) — update zod schemas
- **Edge cases** — companies with no GitHub org, no Wayback snapshots, multilingual sites, etc.
- **Cost overshoot** — if any adapter exceeds estimate by >20%, lower `estimatedCostInr` to be more conservative for next pre-flight

Cap iteration at 3 cycles (find/fix/re-run). If real-data issues exceed 3 cycles, surface to spec for explicit feature deferral or scope adjustment.

Commit messages: per-bug, e.g. `fix(radar-trace): handle missing pubDate in product.rss feeds`.

---

## Chunk 7 complete checkpoint — Phase 1A complete

After this chunk:
- All 40 adapters operational
- CLI has full operator-facing flag set
- README documents the production layer
- 5 validation runs prove the system on real data
- VALIDATION_REPORT.md captures findings

Verify Phase 1A acceptance:

```bash
cd tools/radar-trace
# Validation runs were already done in 7.6; re-run if needed
ls profiles/*.json | wc -l       # Expected: 5
cat profiles/VALIDATION_REPORT.md # Operator's qualitative findings
```

**Phase 1A done. Ready for Phase 1.5 / Phase 2 promotion decision.**

If Phase 1A validates (≥3 of 5 dossiers surface novel signals; cost projection at 34/day stays under ~₹20k):
1. **Phase 1.5** — temporal monitoring (Postgres + cron + diff engine)
2. **Phase 2** — Sonnet synthesis layer (structured profile + narrative brief)
3. **Promote `tools/radar-trace/` → `apps/trace/`** workspace package

If Phase 1A surfaces 5+ adapters consistently producing zero useful signal: cull those adapters in Phase 1.5 before adding monitoring infra on dead weight.

---

## Final notes

Total scope: 40 adapters across 7 chunks, ~6 weeks dev time, ~₹13-17k/mo operating cost at 34 leads/day production.

The spec at [docs/superpowers/specs/2026-05-01-radar-trace-design.md](../specs/2026-05-01-radar-trace-design.md) is the authoritative reference for any ambiguity that arises during implementation. When spec and plan disagree, plan defers to spec.
