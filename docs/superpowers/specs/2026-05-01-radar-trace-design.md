# Radar Trace — Phase 1A Design

**Status:** Design approved 2026-05-01, awaiting implementation plan
**Owner:** Darshan Parmar (Simple Inc)
**Replaces:** `tools/radar-enrich/` (the validation prototype is superseded by this production-scoped sub-product)
**Validates (Phase 1A):** "Can we collect a comprehensive ToS-clean structured digital footprint per company across ~30 data sources, at ~₹720/lead, in <60s wall time?"
**Phase 2 (deferred):** Sonnet synthesis layer (structured profile + narrative brief).
**Phase 1.5 (deferred):** Temporal monitoring (DB + cron + diff engine).

---

## 1. What this is and why

Radar Trace is a sub-product within Radar that produces a structured **digital footprint dossier** for a single company on demand. It replaces the `radar-enrich` validation prototype and absorbs its 27 commits of working code as the foundation.

**Why it exists:** the radar-enrich validation surfaced two problems:

1. The data-collection surface was too narrow — only 4 real adapters covering ~10 signal types. For a real Indian B2B target (Mobcast), the produced hooks hallucinated because too few signals reached the synthesis layer.
2. The single biggest signal (subdomain enumeration revealed 9+ customer-name subdomains) wasn't surfaced as a signal at all — the contextMapper only flattened deltas.

**The strategic decision:** instead of incrementally expanding radar-enrich, productize it. Rename to Radar Trace, expand to ~30 adapters across 9 modules, build the full ToS-clean digital footprint surface in one focused 6-week build. **Validation of "do these signals work?" is deferred** — the user has explicitly chosen to commit to the build before validating, accepting the risk that some adapters may produce low marginal lift.

**Critical scope constraints (carried forward from radar-enrich):**

- ToS-clean approach is preferred. **Apify-paid scrapers are accepted** for sources where Apify takes on the ToS risk (LinkedIn posts, Instagram, Facebook page posts, Twitter posts, Glassdoor, Meta Ad Library, Google Ads Transparency).
- **Direct LinkedIn / Instagram / Facebook scraping by Radar accounts is forbidden.** Apify-only. This protects Simple Inc's accounts from bans.
- **No partnership-required signals.** Cut entirely: website visits / page-level intent, product usage telemetry, event attendance, real ad spend numbers, real-time job change notifications. These cannot be obtained via scraping at any reasonable price.

## 2. Phase scoping

**This spec is Phase 1A only.** Three deferred phases are documented as future work:

| Phase | Scope | Effort | Cost impact |
|---|---|---|---|
| **1A (this spec)** | ~30 adapters collecting ToS-clean structured data, snapshot-only, no AI | ~6 weeks | ~₹19k/mo at production (34 leads/day) |
| **1.5 (deferred)** | Temporal monitoring layer: Postgres schema, cron-driven re-scans, diff engine, change-as-signal | +3-4 weeks | +₹0 data; +infrastructure |
| **2 (deferred)** | AI synthesis: Sonnet call producing structured strategic profile + narrative brief | +1-2 weeks | +~₹6k/mo at production |

The phasing principle is **validate before invest**:

- Phase 1A validates "can we collect comprehensive footprint data within budget?" before investing in monitoring infra (1.5) or AI synthesis (2).
- Phase 1.5 validates "is change-as-signal worth the storage/cron overhead?" before AI synthesis (2).
- Phase 2 validates "does AI synthesis produce hook-worthy intelligence?" before scaling beyond the prototype.

**Cost: ~₹500-620/lead at production scale (~₹13-17k/mo at 34 leads/day).** See §4.10 for the per-module breakdown. (Earlier draft estimates of ~₹720/lead and ~₹19k/mo were before Apify ad-creative pricing was nailed at $0.75/1000.)

**Phase 1A explicit non-goals** (do not creep into the spec):

- No DB writes; no Postgres schema design; no migrations
- No BullMQ enqueue; no cron-driven re-scans; no diff engine
- No Sonnet/Claude synthesis call; no `signalSummary` generation; no hook generation
- No multi-tenancy / per-org scoping
- No web UI / dashboard
- No persistent storage of dossiers (file output to disk; gitignored `profiles/` directory only)
- No integration with the existing Radar pipeline (Stage 10 / `regenerateHook` is **not called** in Phase 1A)

## 3. Naming + relationship to existing radar-enrich

**Decision: rename in place via `git mv`.** The `tools/radar-enrich/` directory becomes `tools/radar-trace/`. The 27 commits of validation-prototype work become the foundation of Radar Trace; commit history is preserved.

**Cleanup actions during Sub-phase 1A.1:**

- `git mv tools/radar-enrich tools/radar-trace`
- Rename `package.json` `name` field: `radar-enrich` → `radar-trace`
- Update `bin` entry: `radar-enrich` → `radar-trace`
- Replace README — drop "validation prototype" framing entirely; describe Radar Trace as the production data collection layer
- Update `.env.example` with new env vars (Serper, Brave, Listen Notes, Apify, PageSpeed)
- Update `docs/superpowers/specs/2026-05-01-radar-enrich-prototype-design.md` — add a note at top redirecting to this spec
- Existing test suite is **rewritten as part of the refactor** to match the new per-source adapter granularity. Test count post-1A.1 should be **≥143** (likely higher — splitting one product adapter into 4 sub-adapters yields more test cases). The principle is: equivalent or better coverage of pre-existing behavior, plus tests for the new fields/contract. "143 tests green" is a floor, not strict identity.

## 4. Module structure (9 modules, ~30 adapters)

Modules are **logical groupings** for the output dossier and dashboard navigation. Adapters are the **execution units**. Each adapter declares which module it belongs to.

### 4.1 Module 1: Hiring (existing, unchanged)

| Adapter | Source | Cost | Required env |
|---|---|---|---|
| `hiring.adzuna` | Adzuna India search API | Free | `ADZUNA_APP_ID`, `ADZUNA_APP_KEY` |
| `hiring.careers` | Direct HTML scrape of `/careers` | Free | None |

Returns: active job postings, function/seniority/location buckets, 30d/90d cohort counts, raw job list.

### 4.2 Module 2: Product (existing, expanded)

| Adapter | Source | Cost | Required env |
|---|---|---|---|
| `product.github_org` | GitHub API search → org login | Free | `GITHUB_TOKEN` |
| `product.github_events` | `/users/{org}/events` | Free | `GITHUB_TOKEN` |
| `product.github_releases` | Recent releases via events | Free | `GITHUB_TOKEN` |
| `product.changelog` | HTML scrape of `/changelog`, `/blog`, `/release-notes`, `/whats-new` | Free | None |
| `product.rss` (NEW) | RSS feed sniffing in `<head>` + RSS XML parse | Free | None |
| `product.sitemap` (NEW) | `sitemap.xml` parse → public page enumeration | Free | None |

### 4.3 Module 3: Customer (existing, unchanged in Phase 1A)

| Adapter | Source | Cost | Required env |
|---|---|---|---|
| `customer.logos_current` | HTML scrape of `/customers`, `/clients`, `/case-studies`, `/our-customers` | Free | None |
| `customer.wayback_diff` | Wayback Machine `availability` API; diffs logos / pricing / hero against 90-day-old snapshot | Free | None |

(Note: the proposed `customer_roster` and `subdomain_customer_pattern` *signal emitters* discussed during Mobcast post-mortem are part of the **synthesis layer** and belong in Phase 2. The underlying *data* — current logos and subdomains — is collected by these adapters and `operational.crtsh`.)

### 4.4 Module 4: Voice (un-stubbed, all new)

Founder/exec digital footprint.

| Adapter | Source | Cost/lead | Required env |
|---|---|---|---|
| `voice.founder_linkedin_url` | Serper `site:linkedin.com/in/ "Founder Name" "Company"` | ~₹0.30 | `SERPER_API_KEY` |
| `voice.founder_github_url` | Serper `site:github.com "Founder Name"` | ~₹0.30 | `SERPER_API_KEY` |
| `voice.linkedin_pulse` | Serper `site:linkedin.com/pulse/` search snippets (NOT scraping) | ~₹0.30 | `SERPER_API_KEY` |
| `voice.podcast_appearances` | Listen Notes API (free tier 1k/mo) | Free | `LISTEN_NOTES_KEY` |
| `voice.youtube_channel` | YouTube RSS for known channel ID (lookup via Serper if needed) | Free | `SERPER_API_KEY` (for lookup) |
| `voice.linkedin_posts_apify` | Apify `apimaestro/linkedin-profile-posts` ($5/1000) | ~₹100 | `APIFY_TOKEN` |

ToS posture: all Serper calls are search-snippet retrieval (zero scraping of LinkedIn). Apify takes the ToS risk for the LinkedIn posts scraper.

### 4.5 Module 5: Operational (existing, expanded)

| Adapter | Source | Cost | Required env |
|---|---|---|---|
| `operational.tech_stack` | Homepage HTML + `detectTechStack()` against ~50-tool fingerprint set | Free | None |
| `operational.crtsh` | crt.sh certificate transparency logs | Free | None |
| `operational.dns` | Node `dns/promises` MX + TXT lookups | Free | None |
| `operational.pagespeed` (NEW) | Google PageSpeed Insights API | Free (with optional key for rate) | `PAGESPEED_API_KEY` (optional) |
| `operational.http_headers` (NEW) | Direct `fetch` HEAD; capture X-Powered-By, Server, security headers | Free | None |
| `operational.robots_txt` (NEW) | `/robots.txt` GET + parse (disallow patterns reveal stack hints) | Free | None |
| `operational.whois` (NEW) | RDAP / WHOIS API for registration date, registrar | Free | None |

### 4.6 Module 6: Positioning (un-stubbed, all new)

Market signals: funding, news, press.

| Adapter | Source | Cost/lead | Required env |
|---|---|---|---|
| `positioning.crunchbase_snippet` | Serper `site:crunchbase.com "Company"` snippets (no page fetch — paywalled) | ~₹0.30 | `SERPER_API_KEY` |
| `positioning.brave_news` | Brave Search News API | ~₹0.50 | `BRAVE_API_KEY` |
| `positioning.serper_news` | Serper news search | ~₹0.30 | `SERPER_API_KEY` |

### 4.7 Module 7: Social (NEW)

Social media presence + recent posts.

| Adapter | Source | Cost/lead | Required env |
|---|---|---|---|
| `social.links` | Homepage regex extraction of LinkedIn / X / Instagram / Facebook URLs | Free | None |
| `social.twitter_posts_apify` | Apify Twitter scraper (actor TBD during 1A.5) | ~₹100 | `APIFY_TOKEN` |
| `social.instagram_posts_apify` | Apify Instagram scraper | ~₹100 | `APIFY_TOKEN` |
| `social.facebook_posts_apify` | Apify Facebook page scraper | ~₹100 | `APIFY_TOKEN` |

Note: `voice.linkedin_posts_apify` (Module 4) covers the LinkedIn posts case. Module 7 covers the other 3 platforms.

### 4.8 Module 8: Ads (NEW)

Active ad creatives — **NOT spend numbers** (those are not publicly available).

| Adapter | Source | Cost/lead | Required env |
|---|---|---|---|
| `ads.meta_library_url` | Constructed URL (free, no fetch) | Free | None |
| `ads.google_transparency_url` | Constructed URL (free, no fetch) | Free | None |
| `ads.meta_creatives_apify` | Apify `curious_coder/facebook-ad-library-scraper` ($0.75/1000) | ~₹15 | `APIFY_TOKEN` |
| `ads.google_creatives_apify` | Apify `silva95gustavo/google-ads-scraper` (pricing TBD during 1A.5) | ~₹15-50 | `APIFY_TOKEN` |

ToS posture: **lowest-risk paid scraping in the spec.** Both Apify actors scrape Google's and Meta's *public transparency tools* (not authenticated user surfaces). These tools exist precisely so the public can inspect ad activity.

### 4.9 Module 9: Directories (NEW)

Public corporate registries + employer/product review sites.

| Adapter | Source | Cost/lead | Required env | Gate |
|---|---|---|---|---|
| `directories.zaubacorp` | Tofler/ZaubaCorp HTML scrape (port from `src/core/signals/adapters/corpFilings.js`) | Free | None | None |
| `directories.ambitionbox` | AmbitionBox HTML scrape | Free | None | None |
| `directories.crunchbase_url` | Constructed URL (no fetch) | Free | None | None |
| `directories.linkedin_company_apify` | Apify LinkedIn company page scraper ($5/1000) | ~₹50 | `APIFY_TOKEN` | None |
| `directories.g2_capterra` | G2 / Capterra HTML scrape | Free | None | `operational.tech_stack` shows B2B SaaS markers |
| `directories.glassdoor_apify` | Apify Glassdoor scraper ($5/1000) | ~₹100 | `APIFY_TOKEN` | `directories.zaubacorp.payload.country !== 'India'` (i.e., target is not Indian — AmbitionBox is the better Indian-target choice) |

### 4.10 Total cost per fully-traced lead

| Module | Always-on cost | Conditional cost (when gate fires) |
|---|---|---|
| 1. Hiring | ₹0 | — |
| 2. Product | ₹0 | — |
| 3. Customer | ₹0 | — |
| 4. Voice | ~₹101 | — |
| 5. Operational | ₹0 | — |
| 6. Positioning | ~₹1.10 | — |
| 7. Social | ~₹300 | — |
| 8. Ads | ~₹30-65 | — |
| 9. Directories | ~₹50 | +₹0 (G2 free) or +₹100 (Glassdoor) |
| **Total per lead** | **~₹482-517** | up to ~₹617 with both conditional adapters firing |

Original estimate was ~₹720/lead; revised down to ~₹500-620 after Apify pricing was nailed for ad creatives ($0.75/1000 not $5/1000). At 34 leads/day production: ~₹13-17k/mo (down from initial ~₹19k estimate). Validation cost (5 leads, all paid included): ~₹2,500-3,000 (~$30-37).

## 5. Adapter contract (expanded from radar-enrich)

```ts
export interface Adapter<TPayload> {
  /** Dotted name: 'module.source' (e.g. 'hiring.adzuna'). */
  readonly name: string;

  /** Module this adapter belongs to. Used for output grouping. */
  readonly module: 'hiring' | 'product' | 'customer' | 'voice' | 'operational'
                 | 'positioning' | 'social' | 'ads' | 'directories';

  /** Semver. Bumped on contract change → invalidates that adapter's cache. */
  readonly version: string;

  /** Estimated cost per run, in INR. Used by --max-cost-inr preflight. */
  readonly estimatedCostInr: number;

  /** Required env vars; orchestrator skips with status:'error' if missing. */
  readonly requiredEnv: readonly (keyof Env)[];

  /** Zod schema validates the payload at orchestrator boundary. */
  readonly schema: z.ZodType<TPayload>;

  /**
   * Per-adapter cache TTL in ms. Default 24h. Override for time-sensitive
   * data (e.g., LinkedIn posts → 6h; Wayback diffs → 7d).
   */
  readonly cacheTtlMs?: number;

  /**
   * Optional gate predicate. Receives the partial dossier (results from
   * Wave 1 adapters). If returns false, adapter is skipped (status:'empty',
   * cost:0). Wave 2 adapters typically declare a gate.
   */
  gate?(partial: PartialDossier): boolean;

  run(ctx: AdapterContext): Promise<AdapterResult<TPayload>>;
}
```

**New fields vs. radar-enrich:**

- `module` — declares logical grouping
- `estimatedCostInr` — replaces `estimatedCostPaise` (rupees primary, pluralized; paise was awkward)
- `cacheTtlMs` — per-adapter TTL override
- `gate` — conditional execution predicate

**Unchanged:** `name`, `version`, `requiredEnv`, `schema`, `run()`.

### 5.1 PartialDossier type

The argument to `gate(partial)` is a **flat read-only snapshot of Wave 1 results, keyed by dotted adapter name across all modules.** It is constructed AFTER Wave 1 finishes and BEFORE any Wave 2 adapter runs (gates are evaluated against the same snapshot, regardless of Wave 2 sibling order):

```ts
export type PartialDossier = Readonly<Record<string, AdapterResult<unknown>>>;
```

Every Wave 1 adapter is present in `partial`, including ones with `status: 'error'` (where `payload` is null) and `status: 'empty'`. **Gate predicates MUST defensively handle null payloads** — accessing `partial['directories.zaubacorp']?.payload?.country` is required, not `partial['directories.zaubacorp'].payload.country`. Gates that throw are treated as `false` (adapter skipped, error recorded as `gate threw: <message>`).

Recommended pattern for gates referencing other adapters:

```ts
gate(partial) {
  const zauba = partial['directories.zaubacorp'];
  if (!zauba || zauba.status !== 'ok' || !zauba.payload) return false;
  return (zauba.payload as ZaubaPayload).country !== 'India';
}
```

### 5.2 Company type

```ts
export interface Company {
  name: string;
  domain: string;
  location?: string;          // "City, Country" — improves Adzuna scoping, news search
  founder?: string;           // Founder/CEO name — improves voice.* adapter accuracy
  founderLinkedinUrl?: string; // Bypass Serper resolution if known (passed via --linkedin)
}
```

## 6. Output shape

```jsonc
{
  "radarTraceVersion": "1.0.0",  // bump on output-shape contract change
  "company": { "name": "Mobcast", "domain": "mobcast.in", "location": "Mumbai, India" },
  "tracedAt": "2026-05-01T12:00:00Z",
  "totalCostInr": 482.10,        // illustrative low-end; matches §4.10 always-on sum
  "totalCostBreakdown": {
    "serper": 1.20,              // INR sum across Serper-using adapters
    "brave": 0.50,               // INR sum across Brave-using adapters
    "listenNotes": 0,            // INR sum (0 unless free-tier exhausted)
    "pagespeed": 0,              // INR sum (0 unless paid tier)
    "apifyUsd": 5.72,            // raw USD spent on Apify (₹480.48 at USD_INR_RATE=84)
    "apifyInr": 480.48           // apifyUsd × USD_INR_RATE, for total reconciliation
  },
  "totalDurationMs": 45000,

  // Flat: one entry per adapter, keyed by dotted name.
  // ALL adapters appear here — including those that errored, were gated out, or were skipped.
  "adapters": {
    "hiring.adzuna":       { /* AdapterResult<HiringJobs> */ },
    "hiring.careers":      { /* AdapterResult<CareersJobs> */ },
    "product.github_org":  { /* AdapterResult<GitHubOrg> */ },
    "product.github_events": { /* ... */ },
    "product.github_releases": { /* ... */ },
    "product.changelog":   { /* ... */ },
    "product.rss":         { /* ... */ },
    "product.sitemap":     { /* ... */ },
    "customer.logos_current": { /* ... */ },
    "customer.wayback_diff": { /* ... */ },
    "voice.founder_linkedin_url": { /* ... */ },
    "voice.founder_github_url": { /* ... */ },
    "voice.linkedin_pulse": { /* ... */ },
    "voice.podcast_appearances": { /* ... */ },
    "voice.youtube_channel": { /* ... */ },
    "voice.linkedin_posts_apify": { /* ... */ },
    "operational.tech_stack": { /* ... */ },
    "operational.crtsh":   { /* ... */ },
    "operational.dns":     { /* ... */ },
    "operational.pagespeed": { /* ... */ },
    "operational.http_headers": { /* ... */ },
    "operational.robots_txt": { /* ... */ },
    "operational.whois":   { /* ... */ },
    "positioning.crunchbase_snippet": { /* ... */ },
    "positioning.brave_news": { /* ... */ },
    "positioning.serper_news": { /* ... */ },
    "social.links":        { /* ... */ },
    "social.twitter_posts_apify": { /* ... */ },
    "social.instagram_posts_apify": { /* ... */ },
    "social.facebook_posts_apify": { /* ... */ },
    "ads.meta_library_url": { /* ... */ },
    "ads.google_transparency_url": { /* ... */ },
    "ads.meta_creatives_apify": { /* ... */ },
    "ads.google_creatives_apify": { /* ... */ },
    "directories.zaubacorp": { /* ... */ },
    "directories.ambitionbox": { /* ... */ },
    "directories.crunchbase_url": { /* ... */ },
    "directories.linkedin_company_apify": { /* ... */ },
    "directories.g2_capterra": { /* ... */ },
    "directories.glassdoor_apify": { /* ... */ }
  },

  // Module grouping — pointers into adapters[]. NOT a payload container.
  "modules": {
    "hiring":      { "adapters": ["hiring.adzuna", "hiring.careers"] },
    "product":     { "adapters": ["product.github_org", "product.github_events", "product.github_releases", "product.changelog", "product.rss", "product.sitemap"] },
    "customer":    { "adapters": ["customer.logos_current", "customer.wayback_diff"] },
    "voice":       { "adapters": ["voice.founder_linkedin_url", "voice.founder_github_url", "voice.linkedin_pulse", "voice.podcast_appearances", "voice.youtube_channel", "voice.linkedin_posts_apify"] },
    "operational": { "adapters": ["operational.tech_stack", "operational.crtsh", "operational.dns", "operational.pagespeed", "operational.http_headers", "operational.robots_txt", "operational.whois"] },
    "positioning": { "adapters": ["positioning.crunchbase_snippet", "positioning.brave_news", "positioning.serper_news"] },
    "social":      { "adapters": ["social.links", "social.twitter_posts_apify", "social.instagram_posts_apify", "social.facebook_posts_apify"] },
    "ads":         { "adapters": ["ads.meta_library_url", "ads.google_transparency_url", "ads.meta_creatives_apify", "ads.google_creatives_apify"] },
    "directories": { "adapters": ["directories.zaubacorp", "directories.ambitionbox", "directories.crunchbase_url", "directories.linkedin_company_apify", "directories.g2_capterra", "directories.glassdoor_apify"] }
  },

  // Phase 1A: always null. Phase 2 will populate.
  "signalSummary": null
}
```

**Typed signature:**

```ts
export interface RadarTraceDossier {
  radarTraceVersion: string;
  company: Company;
  tracedAt: string;             // ISO timestamp
  totalCostInr: number;
  totalCostBreakdown: {
    serper: number;             // INR
    brave: number;              // INR
    listenNotes: number;        // INR (free tier → 0)
    pagespeed: number;          // INR (free tier → 0)
    apifyUsd: number;           // raw USD
    apifyInr: number;           // apifyUsd × USD_INR_RATE
  };
  totalDurationMs: number;
  adapters: Record<string, AdapterResult<unknown>>;
  modules: Record<ModuleName, { adapters: string[] }>;
  /** Phase 1A always null; Phase 2 populates. */
  signalSummary: SignalSummary | null;
}

/** Phase 2 deliverable; Phase 1A treats as `unknown` placeholder so schema compiles. */
export interface SignalSummary { /* defined in Phase 2 spec */ }
```

**Design decisions:**

- **`radarTraceVersion`.** Top-level version field on the dossier. Bumped when the output-shape contract changes. Lets Phase 1.5 diff engine and Phase 2 synthesis detect schema breaks across runs and refuse to compare incompatible dossiers.
- **Flat `adapters` map + `modules` pointer block.** The flat map is the source of truth; modules block is for navigation only. The dashboard renders by iterating `modules.<name>.adapters` and looking up each in `adapters`.
- **Always emit all 30 adapters.** Even for adapters that didn't run (gate returned false → `status:'empty'`, payload null). The dossier shape is stable across runs; consumers don't need to defensively check key existence.
- **`signalSummary: null`.** Phase 1A explicitly emits null. Phase 2 will replace.

## 7. Orchestrator: two-wave execution

**Wave assignment is GLOBAL across all modules, not module-internal.** Adapters from different modules can sit in the same wave. The partition is purely on `gate` presence:

- **Wave 1**: every adapter with no `gate` predicate (currently 28 of 30 — includes ALL adapters from modules 1, 2, 3, 4, 5, 6, 7, 8, plus `zaubacorp/ambitionbox/crunchbase_url/linkedin_company_apify` from module 9).
- **Wave 2**: every adapter with a `gate` predicate (currently 2: `directories.g2_capterra` and `directories.glassdoor_apify`).

This means a Wave 2 gate can reference any Wave 1 adapter regardless of module — e.g., `glassdoor_apify` (Module 9) gates on `zaubacorp` (also Module 9, but in Wave 1) or could equivalently gate on `operational.tech_stack` (Module 5, also Wave 1).

**Execution flow:**

1. Build the adapter list from `--modules` + `--adapters` flags.
2. Partition into Wave 1 (no gate) and Wave 2 (has gate).
3. **Wave 1** runs in parallel via `p-limit(concurrency)`. Each adapter:
   - Cache read (if `--use-cache`): skip if hit
   - Required env check: status:'error' on missing
   - Run with timeout + try/catch
   - Schema validation: status:'partial' on zod failure (payload preserved)
   - Cache write (if status !== 'error')
4. **Build `partialDossier`** — a flat `Record<string, AdapterResult<unknown>>` of all Wave 1 results, including errored and empty ones (per §5.1). Frozen / read-only.
5. **Wave 2** runs in parallel. Each Wave 2 adapter:
   - Evaluate `gate(partialDossier)`. Throws caught and treated as `false` (adapter records `status:'empty'` with `errors: ['gate threw: <message>']`).
   - If gate returns false → status:'empty', no run, cost:0.
   - If gate returns true → execute through the same flow as Wave 1.
6. Final dossier emitted with all 30 adapter slots populated.

**Wall time:** roughly `wave1_max + wave2_max` (slowest in each wave). For Mobcast: Wave 1 ~30s (bounded by Wayback or slowest Apify), Wave 2 ~10s (just G2 or Glassdoor). Total ~40s per lead.

**Concurrency:** default `--concurrency 6` (up from 4 in radar-enrich since adapter count tripled). Apify scrapers self-rate-limit; concurrency cap is for HTTP-based adapters.

## 8. Caching

**Path:** `./cache/<adapter-name>-<inputHash>-<adapterVersion>-<YYYYMMDD>.json` (unchanged from radar-enrich).

**TTL:** default 24h via the date suffix. Per-adapter override via `cacheTtlMs`. Examples:

- `voice.linkedin_posts_apify`: 6h (posts move quickly; want fresh signal for outreach)
- `customer.wayback_diff`: 7d (Wayback snapshots don't change daily)
- `operational.whois`: 30d (registration data is stable)
- Default: 24h

**Implementation:** when `cacheTtlMs` is set, the cache file's mtime is compared to `Date.now()`; entries older than TTL are treated as missing.

**Errored results NOT cached** (unchanged from radar-enrich) — flaky API calls auto-retry next run.

**Partial results ARE cached** (unchanged) — schema-validation failures don't burn re-run budget. **For paid Apify adapters, the partial result preserves the recorded `costInr` along with the payload**; subsequent reads from cache do NOT re-bill. This means a same-day re-run of a partial Apify result is free, even though the original cost was real.

**`--clear-cache`:** wipes `./cache/` and exits 0.

**`--no-cache`:** skips reads, still writes (so subsequent runs benefit).

## 9. Cost tracking

**Primary unit: INR** (consistent with the rest of Radar's cost reporting).

**Apify costs are USD-denominated** — track in USD per adapter, convert to INR at top level using a configurable rate (env: `USD_INR_RATE`, default 84.0).

**Top-level fields** (matches the `RadarTraceDossier` interface in §6):

- `totalCostInr` — sum across all adapters
- `totalCostBreakdown.serper` — INR sum of Serper-using adapters
- `totalCostBreakdown.brave` — INR sum of Brave-using adapters
- `totalCostBreakdown.listenNotes` — INR sum (likely 0 if within free tier)
- `totalCostBreakdown.pagespeed` — INR sum (likely 0 — free tier)
- `totalCostBreakdown.apifyUsd` — raw USD spent on Apify (for direct Apify dashboard reconciliation)
- `totalCostBreakdown.apifyInr` — `apifyUsd × USD_INR_RATE` (so the breakdown sums to `totalCostInr`)

Free adapters (Adzuna, GitHub, Wayback, crt.sh, DNS, etc.) do not contribute to any breakdown bucket — they're free, not "free-bucketed."

**Per-adapter:**

- `costInr` field on every `AdapterResult`
- `costMeta?` optional field for extra detail (e.g., `{ apifyResults: 47, costUsd: 0.235 }`)

## 10. CLI surface

```
radar-trace --company "Acme" --domain acme.com [options]

Required:
  -c, --company <name>       Company name
  -d, --domain <domain>      Primary domain

Optional:
  -l, --location <location>  "City, Country"
  -f, --founder <name>       Founder/CEO name (improves voice.* adapter accuracy)
      --linkedin <url>       Skip Serper resolution; pass founder LinkedIn URL directly
  -m, --modules <list>       Comma-separated module subset (default: all 9)
  -a, --adapters <list>      Override: run only these adapters (e.g. "hiring.adzuna,operational.crtsh")
      --skip-paid            Skip all Apify-paid adapters (validation-cost mode; ~₹2/lead)
      --max-cost-inr <n>     Abort run if PRE-FLIGHT estimated cost exceeds threshold
  -o, --out <path>           Write JSON to file (default: stdout)
      --no-cache             Skip cache reads
      --clear-cache          Wipe ./cache/ and exit
      --concurrency <n>      Wave parallelism (default 6)
      --timeout <ms>         Per-adapter timeout (default 30000)
  -v, --verbose              Per-adapter timing/cost summary on stderr
  -h, --help
```

**New flags vs. radar-enrich:**

- `--linkedin <url>` — bypass Serper-based founder LinkedIn URL resolution if you already have it
- `--adapters <list>` — granular adapter selection (vs. only module-level previously)
- `--skip-paid` — skip-all-Apify mode for cheap validation runs
- `--max-cost-inr <n>` — pre-flight cost ceiling protects against runaway Apify usage

**Pre-flight cost check (new):**

1. After arg parsing, sum `estimatedCostInr` across enabled adapters. **This is a worst-case estimate** — it assumes every Wave 2 gated adapter fires (gates evaluate to true). Actual cost is typically lower because some gates won't fire (e.g., `glassdoor_apify` skipped for Indian targets).
2. If `--max-cost-inr` set and sum exceeds threshold → exit 1 with error listing offenders.
3. Otherwise, log `pre-flight estimated cost (worst case): ₹X.YZ` and proceed.
4. `totalCostInr` in the final dossier reflects **actual** cost, which may be lower than the pre-flight estimate.

## 11. Error handling

Unchanged philosophy from radar-enrich:

- **Adapter failures isolated**, not fatal. status:'error' for the failing adapter; other adapters proceed.
- **Exit codes**:
  - `0` — run completed (even if some adapters errored)
  - `1` — unrecoverable: missing required arg, write failure, pre-flight cost ceiling exceeded
- **`--verbose`** prints final adapter matrix on stderr (status, timing, cost per adapter).
- **`--max-cost-inr` violations** are exit 1 because they're a pre-flight gate, not an adapter error.

## 12. Logging

`pino` to **stderr** (so stdout JSON output stays clean). Pretty when `process.stdout.isTTY`, structured JSON otherwise. One line per adapter start, one per adapter end with status + timing + cost. Final summary line at run end.

## 13. Sub-phasing within Phase 1A

Six sub-phases, ~1 week each. Each ends with green tests + at least one runnable smoke test.

### 13.1 Sub-phase 1A.1 — Foundation rename + refactor (Week 1)
- `git mv tools/radar-enrich tools/radar-trace`
- Rename package, scripts, env, README
- Refactor existing 4 adapters from per-module to per-source granularity (10 sub-adapters)
- Add `module`, `estimatedCostInr`, `cacheTtlMs`, `gate` fields to `Adapter<T>` type
- Orchestrator: two-wave execution scaffold (no gates yet)
- Output shape: flat `adapters` map + `modules` pointers
- Cost tracking: INR-primary, USD breakdown
- All existing 143 tests still green

**Acceptance:** `radar-trace --company "Acme" --domain acme.com` produces new output shape with same data as today, just decomposed. Test count ≥143 (per §3 floor), all green, typecheck clean.

### 13.2 Sub-phase 1A.2 — Operational + product free expansion (Week 2)
6 new free adapters: `product.rss`, `product.sitemap`, `operational.pagespeed`, `operational.http_headers`, `operational.robots_txt`, `operational.whois`.

**Acceptance:** dossier shows 6 more adapter slots with real data. Test count climbs to ~165.

### 13.3 Sub-phase 1A.3 — Voice + Positioning + Ads URLs + Social links (Week 3)
11 adapters, mostly Serper/Brave wrappers.

- New shared `SerperClient` and `BraveClient` (depend on `http.ts`)
- New env vars: `SERPER_API_KEY`, `BRAVE_API_KEY`, `LISTEN_NOTES_KEY`
- Voice (5): `founder_linkedin_url`, `founder_github_url`, `linkedin_pulse`, `podcast_appearances`, `youtube_channel`
- Positioning (3): `crunchbase_snippet`, `brave_news`, `serper_news`
- Ads URLs (2): `meta_library_url`, `google_transparency_url` (URL constructors only)
- Social links (1): `social.links`

**Acceptance:** ~21 adapters wired. Dossier covers founder digital footprint, news, ad library URLs.

### 13.4 Sub-phase 1A.4 — Directories + first Apify integration + gate logic (Week 4)
6 directory adapters + ApifyClient + gate predicate orchestrator support.

- Build shared `ApifyClient` (REST API integration with cost tracking)
- New env var: `APIFY_TOKEN`
- Adapters: `zaubacorp`, `ambitionbox`, `crunchbase_url`, `linkedin_company_apify`, `g2_capterra` (gated), `glassdoor_apify` (gated)
- Implement gate predicate logic in orchestrator
- First Apify-paid adapter live (LinkedIn Company)

**Acceptance:** gated adapters skip correctly when predicate false; LinkedIn Company Apify run produces real cost telemetry.

### 13.5 Sub-phase 1A.5 — Paid Apify scrapers (Week 5)
6 Apify scrapers, mostly templated against the 1A.4 client.

- `voice.linkedin_posts_apify`
- `social.twitter_posts_apify`
- `social.instagram_posts_apify`
- `social.facebook_posts_apify`
- `ads.meta_creatives_apify`
- `ads.google_creatives_apify`

**Acceptance:** all 30 adapters wired. Full `radar-trace --company X --domain Y` produces complete dossier at expected cost (~₹500-620/lead).

### 13.6 Sub-phase 1A.6 — CLI polish + validation (Week 6)
- `--skip-paid`, `--max-cost-inr`, `--adapters`, `--linkedin` flags
- Pre-flight cost estimation + abort logic
- Final output schema validation
- README rewrite (drop validation-prototype framing)
- **5 real validation runs** against your actual ready leads
- Bug fixes from real-data findings

**Acceptance:** Phase 1A complete. Specifically: (1) all 30 adapters runnable on real leads without crashing, (2) total cost per lead within ±20% of §4.10 estimate, (3) **≥3 of 5 validation dossiers surface a signal an operator wouldn't have written manually** (qualitative gate, but operator-judged before Phase 1.5/Phase 2 promotion). Ready for Phase 1.5 / Phase 2 decision.

## 14. Testing approach

Inherits from radar-enrich:

- **vitest** runs in <2s, no real network. HTTP fetch DI'd, DNS DI'd, Apify DI'd via the same factory pattern as `makeOperationalAdapter(dns)`.
- **Per-adapter spec**: 3-6 tests per adapter (contract surface, ok path, partial path, error path, schema-failure path).
- **Per-shared-client spec**: SerperClient, BraveClient, ApifyClient each get their own test file with 4-8 tests.
- **Orchestrator tests**: extended for two-wave gating (gate true vs. false; gate's partial dossier shape; cost summation; pre-flight enforcement).
- **Schema round-trip tests**: top-level dossier schema validates a known-good complete dossier; rejects malformed.
- **CLI integration tests**: `main()` invoked with fake adapters/clients; asserts exit codes, output shape, cost gating behavior.
- **Date-sensitive tests use `vi.useFakeTimers()`** with pinned epoch (lesson from radar-enrich product test fix).
- **No real network in tests.** All HTTP fixtures sanitized and stored under `tests/fixtures/<adapter>/`.

Target test count: ~250-300 tests by Sub-phase 1A.6 (vs. radar-enrich's 143).

## 15. Required env vars (combined)

```env
# .env.example
ADZUNA_APP_ID=                 # Module 1
ADZUNA_APP_KEY=                # Module 1
GITHUB_TOKEN=                  # Module 2
SERPER_API_KEY=                # Modules 4, 6
BRAVE_API_KEY=                 # Module 6
LISTEN_NOTES_KEY=              # Module 4 (free tier 1k/mo)
PAGESPEED_API_KEY=             # Module 5 (optional — free tier works without)
APIFY_TOKEN=                   # Modules 4, 7, 8, 9 (paid scrapers)

# Cost-conversion
USD_INR_RATE=84.0              # Override if INR rate moves materially

# UNUSED IN PHASE 1A — kept in .env.example for Phase 2 forward-compatibility.
# Operators can leave these blank during Phase 1A; nothing reads them.
ANTHROPIC_API_KEY=             # Phase 2 only
ANTHROPIC_DISABLED=            # Phase 2 only — falls back to Gemini if true
GEMINI_API_KEY=                # Phase 2 only — used by regenerateHook fallback
```

`--skip-paid` still requires the free-tier keys (Adzuna, GitHub, Serper, Brave, Listen Notes, optional PageSpeed). Validation runs without Apify cost: ~₹2/lead.

## 16. Out-of-scope confirmations (locked, do not creep)

- ❌ DB writes (no Postgres tables, no migrations) — Phase 1.5
- ❌ BullMQ / cron / scheduled re-scans — Phase 1.5
- ❌ Diff engine / change-as-signal — Phase 1.5
- ❌ Sonnet / Claude / Gemini synthesis call — Phase 2
- ❌ Hook generation / `signalSummary` population — Phase 2
- ❌ Multi-tenancy / per-org scoping
- ❌ Web UI / dashboard
- ❌ Persistent dossier storage beyond `./profiles/` files (gitignored)
- ❌ Stage 10 (`regenerateHook`) integration
- ❌ Direct LinkedIn / Instagram / Facebook scraping by Radar accounts (Apify only)
- ❌ Real ad spend numbers (no public API; SimilarWeb-style estimators are paid third parties)
- ❌ Real-time job change / promotion / executive movement detection (LinkedIn paid feature only)
- ❌ Website visits / page-level intent (requires pixel deployment)
- ❌ Product usage telemetry (first-party only)
- ❌ Event attendance (no public source)

## 17. Open questions / deferred decisions

- **Apify rate-limit / failure handling** — what's the right retry / backoff policy for Apify? Decide during Sub-phase 1A.4 when first integration lands.
- **Twitter / X actor selection** — multiple Apify actors exist (`apify/twitter-scraper`, `quacker/twitter-scraper`, etc.); pick the one with best uptime/cost ratio during Sub-phase 1A.5.
- **Instagram actor selection** — Apify offers `apify/instagram-scraper` and several alternatives; select during Sub-phase 1A.5 based on field coverage + cost.
- **Facebook page actor selection** — same.
- **`google_creatives_apify` precise pricing** — Apify page didn't publicly list pricing for `silva95gustavo/google-ads-scraper`; verify during Sub-phase 1A.5 (estimate ₹15-50 in §4.8 reflects this uncertainty).
- **`directories.g2_capterra` HTML structure stability** — G2 occasionally restructures their pages; if anti-bot becomes hostile, fall back to Apify (would add ~₹50/lead for SaaS-target leads).
- **`directories.glassdoor_apify` actor selection** — Apify has multiple Glassdoor scrapers; pick during Sub-phase 1A.4 based on field coverage + cost.
- **Adapter version-bump cache invalidation** — if an adapter's version is bumped on a subsequent commit (e.g. `0.1.0` → `0.2.0`), all cached entries become invalid by design. Document this in the adapter README so changes don't surprise operators.
- **Pre-flight cost rate updates** — `USD_INR_RATE` is a static env var. If forex moves materially over the validation period, costs may diverge from estimates. Acceptable for prototype; revisit at Phase 1.5.

**Decided (not open):**

- **Apify SDK vs. raw fetch** — Phase 1A uses raw `fetch` against the Apify REST API (`https://api.apify.com/v2/acts/{actor}/run-sync-get-dataset-items`) for consistency with the existing `http.ts` wrapper. The Apify JS SDK adds dependency weight and Apify-specific abstractions that aren't needed for the run-actor-and-get-results use case. Revisit only if Apify-specific features (e.g., webhook callbacks, dataset-streaming) become useful in a later phase.

## 18. Promotion path

If Phase 1A validates (5 real lead runs produce dossiers an operator finds informative, AND total monthly cost projection at 34 leads/day stays under ~₹20k):

1. **Phase 1.5** — temporal monitoring layer (DB + cron + diff engine)
2. **Phase 2** — Sonnet synthesis layer (structured profile + narrative brief)
3. **Promote `tools/radar-trace/` → `apps/trace/`** workspace package, integrate into BullMQ workers, wire into existing dashboard pages

If Phase 1A surfaces that 5+ adapters consistently produce zero useful signal: cull those adapters in Phase 1.5 before adding monitoring infrastructure on dead weight.
