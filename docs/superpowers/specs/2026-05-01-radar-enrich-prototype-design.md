# radar-enrich — Strategic-Signal Validation Prototype

**Status:** Design approved 2026-05-01, awaiting implementation plan
**Owner:** Darshan Parmar
**Validates:** "Do operational-truth signals (hiring / GitHub / Wayback / tech-stack) produce sharper cold-email hooks than LinkedIn-derived signals, when fed through Radar's existing Stage 10 hook prompt?"

---

## 1. Why this exists

Two paths were rejected for new signal sources:

- **LinkedIn deep-scraping** — ToS exposure, infrastructure cost, ban risk on the scraping accounts.
- **Apollo** — paid, anti-competitor API restrictions, and its data is the same firmographic / news layer everyone else also buys.

The hypothesis being validated: a **ToS-clean stack of operational-truth sources** (job boards, GitHub activity, Wayback diffs, tech-stack fingerprinting) produces *richer hooks* than the marketing-output sources LinkedIn and Apollo expose. "Richer" is judged subjectively by reading the generated hooks for 3–5 real ready leads from the existing Radar pipeline.

This prototype **is not** the production system. No DB, no queue, no Postgres, no integration with the existing BullMQ workers. Storage, scheduling, multi-tenancy, and integration with the Radar pipeline are all explicitly deferred until after the validation question is answered.

**Success criterion:** after running `radar-enrich` on 3–5 real ready leads, the generated `suggestedHooks` for at least 3 of them feel materially sharper than what the current production pipeline produces for the same leads. If yes → invest in the full pipeline. If no → the cost was ~1 week and `rm -rf tools/radar-enrich`.

## 2. Scope

### 2.1 In-scope (built fully)

Four "operational-truth" modules:

| # | Module | Sources |
|---|---|---|
| 1 | **Hiring Direction** | Adzuna API (India), company `/careers` HTML scrape |
| 2 | **Product Direction** | GitHub API (org repos, events, releases), changelog/RSS auto-discovery |
| 3 | **Customer Direction** | Wayback Machine snapshots — diff `/customers`, `/pricing`, homepage hero |
| 5 | **Operational Signals** | Tech-stack fingerprinting (~50-tool embedded dataset), DNS lookups, crt.sh subdomain discovery |

### 2.2 Stubbed (framework-wired, return `status: 'empty'`)

| # | Module | Why stubbed |
|---|---|---|
| 4 | **Strategic Voice** | Highest build cost (Listen Notes quota, founder-name resolution chain via Serper, Claude theme extraction). High-quality hooks but low marginal proof — defer until the cheaper modules validate the thesis. |
| 6 | **Market Positioning** | Lowest differential value — Apollo and Crunchbase already cover funding/news well. Building this proves nothing about the thesis. |

Stubs implement the same `Adapter<T>` interface, return `{ status: 'empty', payload: null }`, and document their intended sources in code comments. The final Claude synthesis call still receives all 6 results (with empty payloads from the stubs).

### 2.3 Explicit non-goals

- Postgres / Prisma integration
- BullMQ worker integration
- Multi-tenancy / per-org scoping
- Web UI
- Persistent storage of dossiers (file-cache only)
- Cost-cap enforcement (visibility only — no `--max-cost` abort)
- Email sending or any mutation of Radar production data

## 3. Location & language

**Path:** `tools/radar-enrich/` — outside the npm workspace tree.

**Reasoning:**

- Outside `apps/` keeps it from being installed/built by `npm install` at the repo root. Zero risk of cross-contamination with `apps/api` or `apps/web` builds, tests, or type-checking.
- `tools/` over a sibling repo because the validation pulls from `src/core/pipeline/` (Stage 10 prompt — see §6) — it needs to live in the same checkout to import the prompt without packaging.
- If validation succeeds → promote to `apps/enrich-cli/` later (mechanical `git mv`).
- If validation fails → `rm -rf tools/radar-enrich/` is a clean undo.

**Language:** TypeScript.

**Reasoning:**

- 6 module contracts to keep aligned against one shared `Adapter<TPayload>` interface — TS catches shape drift across adapters during iteration, which is exactly the bug class you don't want chasing during a 1-week prototype.
- `apps/api` is already TS — same toolchain, same vitest setup, no new context to learn.
- The legacy `src/core/signals/` adapters are JS with JSDoc — explicitly **not reused** to avoid muddling the prototype with the existing adapter contract (different shape, different sources, different tenancy assumptions).

**Standalone `package.json`** — own `node_modules`, own `tsconfig.json`, own `vitest.config.ts`. Not a workspace member.

## 4. Repository layout

```
tools/radar-enrich/
├── package.json              # standalone, own node_modules
├── tsconfig.json             # NodeNext, strict, target ES2022
├── vitest.config.ts
├── .env.example              # all keys documented, links to register
├── README.md                 # how to run, key acquisition links, sample output
├── cache/                    # gitignored — file cache, 24h TTL
├── profiles/                 # gitignored — output dossiers from --out runs
├── src/
│   ├── cli.ts                # commander entrypoint
│   ├── orchestrator.ts       # runs adapters via p-limit, assembles output
│   ├── types.ts              # Adapter, AdapterResult, AdapterContext, CompanyInput, Env
│   ├── schemas.ts            # zod schemas: every payload + final output
│   ├── cache.ts              # file cache (./cache/<adapter>-<hash>-<version>-<YYYYMMDD>.json)
│   ├── logger.ts             # pino, pretty when stdout.isTTY, JSON otherwise, always to stderr
│   ├── env.ts                # zod-validated env loader, fails fast on missing required keys
│   ├── http.ts               # tiny fetch wrapper: timeout, retry-once-on-5xx, UA header
│   ├── adapters/
│   │   ├── hiring.ts         # Module 1
│   │   ├── product.ts        # Module 2
│   │   ├── customer.ts       # Module 3
│   │   ├── voice.stub.ts     # Module 4 — returns status:'empty'
│   │   ├── operational.ts    # Module 5
│   │   └── positioning.stub.ts # Module 6 — returns status:'empty'
│   ├── fingerprints/
│   │   └── techstack.ts      # embedded ~50-tool fingerprint dataset
│   ├── synthesis/
│   │   ├── contextMapper.ts  # 4-module output → synthetic LeadContext
│   │   └── hookGenerator.ts  # imports + calls Stage 10 prompt
│   └── lib/
│       ├── classify.ts       # function/seniority keyword classifiers (Module 1)
│       └── domainUtils.ts    # normalize, extract registered domain, etc.
└── tests/
    ├── adapters/             # one spec per adapter w/ HTTP fixtures
    ├── fixtures/             # recorded sanitized HTTP responses, per adapter
    ├── schemas.test.ts       # zod round-trip for every payload
    └── orchestrator.test.ts  # adapter failure isolation + final shape
```

## 5. Adapter contract

```ts
export interface CompanyInput {
  name: string;
  domain: string;
  location?: string;
  founder?: string;
}

export interface AdapterContext {
  input: CompanyInput;
  http: typeof fetch;       // wrapped fetch w/ timeout
  cache: Cache;
  logger: Logger;
  env: Env;                 // typed, validated
  signal: AbortSignal;      // global timeout from orchestrator
}

export interface Adapter<TPayload> {
  readonly name: string;                          // 'hiring' | 'product' | ...
  readonly version: string;                       // bump on contract change → cache busts
  readonly estimatedCostPaise: number;            // visibility only
  readonly requiredEnv: readonly (keyof Env)[];   // fail-fast surface
  readonly schema: z.ZodType<TPayload>;           // payload validator
  run(ctx: AdapterContext): Promise<AdapterResult<TPayload>>;
}

export interface AdapterResult<T> {
  source: string;
  fetchedAt: string;       // ISO
  status: 'ok' | 'partial' | 'empty' | 'error';
  payload: T | null;
  errors?: string[];
  costPaise: number;
  durationMs: number;
}
```

**Two additions to the original spec, both load-bearing:**

1. **`requiredEnv`** on each adapter — orchestrator checks before running, so a missing `ADZUNA_APP_ID` produces *"hiring adapter skipped: missing ADZUNA_APP_ID"* instead of a runtime fetch error mid-pipeline.
2. **`version`** on each adapter — included in cache key, so when the careers parser changes, old cached results don't shadow the fix. Cheap insurance for an iteration-heavy prototype.

## 6. Validation step (the actual point of the prototype)

**Approach: reuse Radar's existing Stage 10 hook generator** (`src/core/pipeline/regenerateHook.js`) unchanged. Apples-to-apples comparison — same callable, same model (Sonnet via `callClaude('sonnet', …, { maxTokens: 60 })`), same A/B variant framework; only the signal payload differs.

### 6.1 Stage 10 actual contract (verified at spec-write time)

`regenerateHook.js` exports:

```js
// Generates two hook variants in parallel, picks one at random.
// Returns ONE hook + chosen variant id + total cost.
export async function regenerateHook(lead, persona, signals = [], competitorAnalysis = null)
  → { hook: string, costUsd: number, model: string, hookVariantId: 'A' | 'B' }
```

Input shapes consumed by `regenerateHook` and its internal `buildHookPrompt`:

```ts
// 'lead' fields actually read:
{ business_name: string, website_url: string, manual_hook_note?: string }

// 'persona' fields actually read:
{ role: string }   // e.g. "B2B SaaS founder", "ecommerce operator"

// 'signals' element shape actually read (only top 3 used):
{ signalType: string, headline: string, url?: string }

// 'competitorAnalysis' — leave null for prototype runs
```

The synthetic LeadContext zod schema in `schemas.ts` is **derived from these field lists**. Implementation step zero is opening `regenerateHook.js`, confirming the field names haven't changed since spec-write, and writing the zod schema to match. Drift in either direction (Stage 10 adds a required field; prototype mis-spells one) is caught at the schema boundary.

### 6.2 Synthesis pipeline

1. **`contextMapper.ts`** — pure function that takes the 4 real `AdapterResult<T>` payloads and produces:

   ```ts
   { lead: { business_name, website_url, manual_hook_note: null },
     persona: { role: string },
     signals: Array<{ signalType, headline, url? }> }
   ```

   Mapping rules:

   | Stage 10 input field | Synthesized from |
   |---|---|
   | `lead.business_name`, `lead.website_url` | From `--company`, `--domain` |
   | `lead.manual_hook_note` | Always null (operator-only field) |
   | `persona.role` | Inferred from operational module's tech stack: "B2B SaaS founder" if Stripe+Segment+dashboard-subdomain present; "ecommerce operator" if Shopify/WooCommerce; "agency owner" if portfolio page detected; default "founder" |
   | `signals[]` | Flatten module outputs into individual Signal records, each becoming one `{signalType, headline, url}` — see §6.3 below |

2. **`hookGenerator.ts`** — imports `regenerateHook` from `../../src/core/pipeline/regenerateHook.js` (relative path; reachable on disk even though `tools/` is outside the workspace). Calls it 3 times in parallel to produce 3 hook candidates (each call internally generates A+B variants and picks one — so 3 calls give 3 production-equivalent hooks for review). Returns `{ topSignals: string[], suggestedHooks: string[], totalCostUsd: number }`.

   - `suggestedHooks` = the 3 returned hook strings.
   - `topSignals` = derived **without** an extra Claude call — sort the synthesized `signals[]` array by `confidence` (set during Module → Signal flattening), take top 5, format as `"[signalType] headline"`. Cheap, deterministic, lets the user see exactly which signals fed each hook.

3. **`--debug-context` flag** — when set, output JSON includes `signalSummary._debug.synthesizedContext` (the mapped lead+persona+signals object actually passed to `regenerateHook`) and `signalSummary._debug.stage10` (`{ path: 'src/core/pipeline/regenerateHook.js', gitSha: '...' }`). When a hook comes out flat you can see whether the signals failed to fire, the mapping dropped them, or `buildHookPrompt`'s top-3-signals truncation dropped the interesting one.

### 6.3 Module → Signal flattening rules

Each module's payload becomes 0–N Signal records during the contextMapper step. `confidence` is set per-source; higher = more likely to surface in `signals[]` top 3 inside Stage 10.

| Source | signalType | headline template | confidence |
|---|---|---|---|
| Hiring — new senior role last 30d | `hiring_senior` | `"Opened {role} role in {city} ({date})"` | 0.85 |
| Hiring — net new function | `hiring_new_function` | `"First {function} hire in 90d"` | 0.9 |
| Product — new public repo last 30d | `product_repo_new` | `"New public repo: {name} ({date})"` | 0.7 |
| Product — release tagged last 14d | `product_release` | `"Released {tag}: {title}"` | 0.85 |
| Product — changelog entry last 14d | `product_changelog` | `"Shipped: {title}"` | 0.8 |
| Customer — added logo | `customer_added` | `"Added logo: {logoName}"` | 0.9 |
| Customer — pricing change | `pricing_change` | `"Pricing changed on {date}"` | 0.75 |
| Customer — hero rewrite | `positioning_change` | `"Homepage hero changed on {date}"` | 0.7 |
| Operational — new tech detected | `tech_added` | `"Added {toolName} to stack"` | 0.6 |
| Operational — notable subdomain | `subdomain_notable` | `"Subdomain {sub}.{domain} is live"` | 0.75 |

Confidences are best-effort starting values; tunable in code as the prototype runs against real leads.

### 6.4 Live-import vs snapshot decision

**Decision: live import** from `src/core/pipeline/regenerateHook.js`.

- The validation question is "does this work *with our actual production hook generator*". Snapshotting freezes it and undermines the comparison.
- If `regenerateHook` evolves during the validation window, the prototype evolves with it — feature, not bug.
- Trade-off accepted: results may drift if Stage 10 changes mid-validation. Mitigated by `_debug.stage10.gitSha` capturing the SHA at run time.

## 7. CLI surface

```
radar-enrich --company "Acme Corp" --domain acme.com [options]

Required:
  -c, --company <name>       Company name
  -d, --domain <domain>      Primary domain (e.g. acme.com)

Optional:
  -l, --location <location>  "City, Country" — improves Adzuna + news scoping
  -f, --founder <name>       Founder/CEO name — currently ignored (voice stub)
  -m, --modules <list>       Comma-separated, default: all
                             (hiring,product,customer,voice,operational,positioning)
  -o, --out <path>           Write JSON to file; defaults to stdout
      --no-cache             Skip cache reads (still writes)
      --clear-cache          Wipe ./cache/ then exit
      --debug-context        Include synthetic LeadContext in output
      --concurrency <n>      Adapter parallelism, default 4
      --timeout <ms>         Per-adapter timeout, default 30000
  -v, --verbose              Per-adapter progress, timing, cost
  -h, --help
```

## 8. Runtime flow

1. **Parse + validate args** (commander → zod).
2. **Load + validate env** — only the keys required by requested modules. Missing required key → fail fast with the missing key name and the URL to register for it.
3. **Resolve adapters** from `--modules`. Stubs always resolve and return `status: 'empty'`.
4. **Spawn orchestrator** with `p-limit(concurrency)`. Each adapter runs inside:
   - A `try/catch` (errors caught, `status: 'error'` returned, run continues)
   - An `AbortController` wired to `--timeout` (timeout → `status: 'error'`, message `"timeout after Nms"`)
   - The cache layer (read-through if cached for today and `--no-cache` not set)
5. **Validate payloads** through each adapter's zod schema. Schema failure → `status: 'partial'` + zod error message in `errors[]` + payload preserved as-is. (Don't drop data when validation fails — the *whole point* of running this on real leads is seeing what real responses look like.)
6. **Synthesize** — build LeadContext from the 4 real-module payloads, call Claude.
7. **Assemble final output** through the top-level zod schema.
8. **Emit** — JSON to stdout or `--out` file. Logs always go to **stderr** so `--out` and stdout-piping stay clean.

## 9. Caching

- **Path:** `./cache/<adapter>-<inputHash>-<adapterVersion>-<YYYYMMDD>.json`
- **`inputHash`:** sha256 of normalized `{name, domain, location, founder}` (truncated 12 chars)
- **TTL:** 24h via the date suffix — rolling over a day naturally invalidates
- **Stores the full `AdapterResult`**, including errors — so a flaky run during the day doesn't keep retrying expensive APIs
- **`--no-cache` skips reads only** — writes still happen, so the second run that day is cheap
- **`--clear-cache`** wipes the directory and exits 0

## 10. Error handling philosophy

- Adapter failures are **isolated and surfaced**, never fatal to the run. The point of the dossier is partial results.
- **Exit codes:**
  - `0` — run completed, even if some adapters errored
  - `1` — unrecoverable: missing required env, invalid args, write failure
- This matters when wrapping in a shell loop over 5 leads — you want all 5 dossiers regardless of individual adapter flakes.
- `--verbose` mode prints a final matrix: which adapters succeeded / partial / empty / errored, with timing + cost per row.

## 11. Logging

- `pino`, level `info` default, `debug` with `--verbose`
- **Always to stderr** so stdout JSON output is uncontaminated
- Pretty (`pino-pretty`) when `process.stdout.isTTY`, structured JSON otherwise (e.g. when running under a script)
- One line per adapter start, one per adapter end with status + timing + cost

## 12. Output shape

```json
{
  "company": { "name": "...", "domain": "...", "location": "...", "founder": "..." },
  "enrichedAt": "2026-05-01T12:00:00Z",
  "totalCostPaise": 4250,
  "totalDurationMs": 18400,
  "modules": {
    "hiring":      { /* AdapterResult<HiringPayload> */ },
    "product":     { /* AdapterResult<ProductPayload> */ },
    "customer":    { /* AdapterResult<CustomerPayload> */ },
    "voice":       { /* AdapterResult<null> — status:'empty' */ },
    "operational": { /* AdapterResult<OperationalPayload> */ },
    "positioning": { /* AdapterResult<null> — status:'empty' */ }
  },
  "signalSummary": {
    "topSignals":     ["[customer_added] Added logo: Acme Inc", "..."],
    "suggestedHooks": ["...", "...", "..."],
    "totalCostUsd":   0.012,
    "_debug": {
      "synthesizedContext": { /* present only with --debug-context */ },
      "stage10":            { "path": "src/core/pipeline/regenerateHook.js", "gitSha": "..." }
    }
  }
}
```

## 13. Module specifications

### 13.1 Module 1 — Hiring Direction (`adapters/hiring.ts`)

- **Sources:** Adzuna India (`https://api.adzuna.com/v1/api/jobs/in/search/1?app_id=...&app_key=...&company=...`), best-effort `cheerio` parse of `https://{domain}/careers`
- **Required env:** `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`
- **Payload:** `{ totalActiveJobs, jobsLast30Days, jobsLast90Days, byFunction: Record<string,number>, bySeniority: Record<string,number>, byLocation: Record<string,number>, newRoleTypes: string[], rawJobs: Job[] }`
- **Function classifier:** keyword on title — eng / sales / marketing / ops / finance / product / design / cs / legal / hr (default `other`)
- **Seniority classifier:** keyword on title — intern / junior / mid / senior / staff / principal / director / vp / c-level (default `mid`)
- **Estimated cost:** 0 paise (Adzuna free tier)

### 13.2 Module 2 — Product Direction (`adapters/product.ts`)

- **Sources:** GitHub API (`/search/users?q={company}+type:org`, then `/orgs/{org}/repos`, `/orgs/{org}/events`, `/repos/{org}/{repo}/releases`); changelog auto-discovery on `/changelog`, `/blog`, `/release-notes`, `/whats-new` with RSS link sniffing in `<head>`, fallback to scraping recent post titles+dates with cheerio
- **Required env:** `GITHUB_TOKEN`
- **Payload:** `{ githubOrg: string|null, publicRepos: Repo[], recentNewRepos: Repo[], commitVelocity30d: number, languageDistribution: Record<string,number>, recentReleases: Release[], changelogEntries: Entry[] }`
- **Estimated cost:** 0 paise

### 13.3 Module 3 — Customer Direction (`adapters/customer.ts`)

- **Sources:** Wayback Machine (`http://archive.org/wayback/available?url=...&timestamp=...`)
- **Required env:** none
- **Payload:**
  ```ts
  {
    customersPageUrl: string | null;
    currentLogos: string[] | null;            // logo names extracted from alt + img src
    snapshotsAnalyzed: { url: string; timestamp: string; waybackUrl: string }[];
    addedLogosLast90d: string[];
    removedLogosLast90d: string[];
    pricingChanges: {
      detectedAt: string;                     // ISO of the snapshot where change appeared
      previousSnapshotUrl: string;            // wayback URL of "before"
      currentSnapshotUrl: string;             // wayback URL of "after"
      changeSummary: string;                  // e.g. "Starter price changed: $29 → $39"
    }[];
    heroChanges: {
      detectedAt: string;
      previousH1: string | null;
      currentH1: string | null;
      previousFirstParagraph: string | null;
      currentFirstParagraph: string | null;
    }[];
  }
  ```
- **Logic:** fetch current `/customers` (try `/clients`, `/case-studies`, `/our-customers` as fallbacks) → extract logo `alt` attributes and image filenames → fetch Wayback snapshots from 30, 60, 90 days ago → diff. Same diff for `/pricing` (text snapshot, naive line-level diff with regex extraction of price tokens) and homepage (h1 + first `<p>`, exact-string equality).
- **Estimated cost:** 0 paise

### 13.4 Module 4 — Strategic Voice (`adapters/voice.stub.ts`)

- **Status:** stub — returns `{ status: 'empty', payload: null }`
- **Documented intent:** Listen Notes API (`LISTEN_NOTES_KEY`), YouTube RSS for known channel IDs, Substack/Medium discovery via Serper, LinkedIn `/pulse/` articles via Serper. Founder name resolution chain via Serper if `--founder` not provided.
- **Estimated cost (when built):** ~50 paise per run

### 13.5 Module 5 — Operational Signals (`adapters/operational.ts`)

- **Sources:** direct `fetch` of `https://{domain}/`, parse `<script src>` and `<link href>` against embedded fingerprint dataset (`fingerprints/techstack.ts`, ~50 tools — Stripe, Segment, Mixpanel, Amplitude, Intercom, HubSpot, Salesforce, Algolia, etc.); `dns/promises` for MX (email provider inference) + TXT (SaaS verifications); `crt.sh` (`https://crt.sh/?q=%25.{domain}&output=json`) for subdomain enumeration
- **Required env:** none
- **Payload:** `{ techStack: {name, category, confidence}[], emailProvider: string|null, knownSaaSVerifications: string[], subdomains: string[], notableSubdomains: string[] }`
- **"Notable subdomain" heuristic:** matches `staging|app|api|dashboard|admin|beta` or any of the company's known product names (extracted from homepage `<title>`)
- **Estimated cost:** 0 paise

### 13.6 Module 6 — Market Positioning (`adapters/positioning.stub.ts`)

- **Status:** stub — returns `{ status: 'empty', payload: null }`
- **Documented intent:** Serper news (`SERPER_API_KEY`), Brave Search news (`BRAVE_API_KEY`), Crunchbase via Serper snippets, Meta Ad Library URL (returned, not scraped), Google Ads Transparency URL
- **Estimated cost (when built):** ~30 paise per run

## 14. Required env vars

```env
# .env.example
ADZUNA_APP_ID=                 # https://developer.adzuna.com/
ADZUNA_APP_KEY=
GITHUB_TOKEN=                  # https://github.com/settings/tokens (public_repo scope sufficient)
ANTHROPIC_API_KEY=             # for Stage 10 hook generation

# Stub modules — only needed once Module 4 / 6 are un-stubbed
SERPER_API_KEY=
BRAVE_API_KEY=
LISTEN_NOTES_KEY=
```

CLI fails fast with the exact missing key name + registration URL if a required key is missing for a requested module.

## 15. Testing approach

- **vitest**, esm + Node env, mirroring `apps/api`'s setup
- **Per-adapter spec** in `tests/adapters/<name>.test.ts`:
  - HTTP fixtures (recorded real responses, sanitized) under `tests/fixtures/<adapter>/`
  - Asserts: (a) zod schema passes on fixture, (b) classifier outputs are deterministic, (c) error-status branch fires on injected fetch failure
- **Schema round-trip** in `tests/schemas.test.ts`: top-level output schema parses a known-good complete dossier fixture; fails informatively on missing required fields
- **Orchestrator isolation test**: inject a failing adapter, assert (a) other adapters still produce results, (b) failed adapter has `status: 'error'`, (c) exit code is still 0, (d) cache is not written for the failed adapter
- **No network in tests** — `http.ts` fetch wrapper is dependency-injected via `AdapterContext`, fixtures loaded by the test harness
- **Synthesis test**: mock the Anthropic SDK call, assert the synthetic LeadContext shape matches Stage 10's actual input contract (catches drift if Stage 10 evolves)
- **Manual validation**: 3–5 real ready leads, eyeball hook quality. No automated quality assertion — that's the prototype's whole purpose.

## 16. Open questions / deferred decisions

- **Founder-name resolution chain** — only relevant once Module 4 is un-stubbed
- **Cost-cap enforcement** — visibility only for now; if per-run cost grows past ~5 INR, revisit
- **Output retention** — `./profiles/` is gitignored; manual hygiene for now
- **Promotion path** — if validation succeeds, design doc for `apps/enrich-cli/` workspace migration is a separate spec

## 17. Out-of-scope confirmations (locked, do not creep)

- No DB writes
- No BullMQ enqueue
- No multi-tenancy
- No web UI
- No production-pipeline integration (Stage 10 prompt is *read*, never *modified*)
- No new env vars added to the main Radar `.env.example` — `tools/radar-enrich/.env.example` is its own file
