# Signal Aggregator — Specification

**Date:** 2026-04-24
**Owner:** Darshan Parmar
**Status:** Draft → for review before plan
**Related:** Move #1 from the AiSDR-inspired roadmap (see conversation 2026-04-24)

---

## 1. Problem

Radar's hook generation (stage 10) and quality judge (stage 5) currently use only what Gemini can extract from a company's own website + a fixed Gemini grounding query. There are no structured, diverse, time-sensitive signals (funding, hiring, launches, press, tech changes) feeding Claude Sonnet when it writes the hook.

Result: hooks sound templated to recipients. Reply rate is capped by personalization ceiling, not deliverability (deliverability is already engineered well).

AiSDR and peers close this gap with expensive LinkedIn scraping + enterprise intent data. Proxycurl's 2025 shutdown proved LinkedIn-dependent stacks are brittle. We need a **LinkedIn-independent, free/cheap, pluggable signal layer** that reads the Indian + global public web.

## 2. Goal

One-sentence: **Give Claude Sonnet 2–3 high-confidence, time-sensitive signals per lead at hook-generation time, from a pluggable set of free/cheap public-web adapters, without introducing any LinkedIn ToS exposure.**

## 3. Non-Goals (v1)

- Paid adapters (LinkdAPI, Serper.dev, Apify X) — build as stubs, enable only if free-tier lift is insufficient after 4 weeks of A/B data.
- Autonomous reply agent (Move #2 — separate spec).
- Writing-style exemplar few-shot (Move #3 — separate spec).
- Multi-tenant (phase 1.5).
- LinkedIn content scraping — URL-only surfacing via Gemini grounding citations, never content.
- Full rewrite of findLeads.js — signal aggregation slots in between existing stages, not replacing them.

## 4. Success Criteria

Primary (4 weeks post-launch, vs pre-change 4-week baseline):
- **Reply rate lift: ≥ +20% relative** (target +30–50%).
- **Bounce rate: ≤ baseline** (no regression — content validator still runs).
- **Spam-complaint rate: ≤ baseline.**

Secondary:
- ≥ 60% of leads reaching stage 10 have ≥ 1 signal of confidence ≥ 0.6.
- Signal aggregation adds ≤ 15 seconds of wall-clock time per lead in findLeads engine.
- Zero pipeline failures caused by adapter errors (graceful-fail invariant holds).

Rollback trigger:
- Reply rate lift < +5% AND bounce rate up by any measurable amount after 2 weeks.
- Set `SIGNALS_ENABLED=false` → findLeads reverts to pre-change behavior.

## 5. Scope (v1 adapters — all free)

| # | Source | Signal types | Freshness |
|---|---|---|---|
| 1 | Google News RSS (per-company query) | funding, hiring, launch, press, exec-change | live |
| 2 | Company blog RSS (auto-discovery) | blog_post | last 90 days |
| 3 | Indian press RSS (Inc42, YourStory, Entrackr, VCCircle) | funding, launch, press (India moat) | live |
| 4 | Tech stack (Wappalyzer CLI) | tech (informs Gate 1) | on-fetch |
| 5 | Certificate transparency (crt.sh) | subdomain (new product signal) | live |
| 6 | PageSpeed Insights API | performance (performance-pain hook angle) | on-fetch |
| 7 | Company careers page fetch | hiring | on-fetch |
| 8 | Product Hunt public API | launch | live |
| 9 | GitHub Organization API | github_activity | live |
| 10 | Indian corporate filings (MCA + Tofler free + Zauba) | corp_legitimacy, revenue_proxy | monthly |

All Phase-0 monthly cost: **₹0**.

Stub-only (disabled by feature flag in v1):
- `linkdApi.js` — LinkedIn URLs enrichment
- `serperFallback.js` — SERP fallback when Gemini grounding returns empty
- `apifyX.js` — Twitter/X scraping for Indian founders

## 6. Architecture

### 6.1 Directory layout

```
src/core/signals/
├── index.js               # orchestrator — collectSignals(lead, opts)
├── registry.js            # adapter registry + enabled flags
├── types.js               # JSDoc type declarations
├── persistence.js         # Prisma write helpers (upsert + dedup)
├── adapters/
│   ├── googleNews.js
│   ├── companyBlog.js
│   ├── indianPress.js
│   ├── techStack.js
│   ├── certTransparency.js
│   ├── pagespeed.js
│   ├── careersPage.js
│   ├── productHunt.js
│   ├── github.js
│   └── corpFilings.js
└── disabled/              # stubs for paid adapters (not called in v1)
    ├── linkdApi.js
    ├── serperFallback.js
    └── apifyX.js
```

### 6.2 Adapter contract

Every enabled adapter in `adapters/` exports:

```js
/** @type {string} */
export const name;              // stable identifier, e.g. 'google_news'

/** @type {number} */
export const timeoutMs;         // per-adapter timeout, default 10_000

/**
 * @param {LeadContext} lead
 * @returns {Promise<AdapterResult>}
 */
export async function fetch(lead) { ... }
```

Types:

```js
/**
 * @typedef {Object} LeadContext
 * @property {number} id
 * @property {string} businessName
 * @property {string|null} websiteUrl
 * @property {string|null} ownerName
 * @property {string|null} city
 * @property {string|null} country
 * @property {string|null} category
 */

/**
 * @typedef {Object} Signal
 * @property {string} signalType    - 'funding' | 'hiring' | 'launch' | 'press' | 'tech' | 'subdomain' | 'performance' | 'blog_post' | 'github_activity' | 'corp_legitimacy'
 * @property {string} headline      - human-readable, ≤120 chars
 * @property {string|null} url
 * @property {Object} payload       - structured data for downstream analysis
 * @property {number} confidence    - [0.0, 1.0]
 * @property {string|null} signalDate - ISO 8601 if source has a date
 */

/**
 * @typedef {Object} AdapterResult
 * @property {string} source
 * @property {Signal[]} signals
 * @property {string|null} error
 * @property {number} durationMs
 */
```

### 6.3 Orchestrator contract

```js
// src/core/signals/index.js
/**
 * @param {LeadContext} lead
 * @param {{ adapters?: string[], globalTimeoutMs?: number }} options
 * @returns {Promise<Signal[]>}  // sorted by confidence DESC, already persisted
 */
export async function collectSignals(lead, options = {}) { ... }
```

Invariants:
- Runs enabled adapters in parallel via `Promise.allSettled`.
- Each adapter bounded by its own `timeoutMs` (via `AbortController`).
- Global timeout fallback via `options.globalTimeoutMs` (default 20_000).
- Never throws — all adapter errors logged to `cron_log.errorMessage` via a new `signal_adapter_error` notes entry.
- Persists via a single Prisma transaction using `upsert` on the `(leadId, source, signalType, url)` unique constraint.
- Returns flat `Signal[]` sorted by `confidence` desc.

### 6.4 Integration point in findLeads.js

- **Insert after Gate 1** (stage 4.5 → new stage 4.6 "collect signals") so we only spend time on leads that passed basic qualification.
- **Stage 5 (quality judge)** prompt extended: receives top-3 signals as JSON context. Prompt-engineered to use signals to validate fit, but not to auto-accept purely on signals.
- **Stage 10 (hook gen Sonnet)** prompt extended: receives top-3 signals + `manualHookNote` if present. Returns `signalsUsed: string[]` in response JSON so we can audit which signals Claude actually leveraged.
- Feature flag: `SIGNALS_ENABLED` env. Default `false` on deploy, flip to `true` after chunks 1–4 merge and smoke test passes.

### 6.5 DB changes (Prisma)

**New model:**
```prisma
model LeadSignal {
  id           Int       @id @default(autoincrement())
  leadId       Int       @map("lead_id")
  source       String    // adapter name
  signalType   String    @map("signal_type")
  headline     String?
  url          String?
  payloadJson  Json?     @map("payload_json")
  confidence   Float
  signalDate   DateTime? @db.Timestamptz(6) @map("signal_date")
  collectedAt  DateTime  @default(now()) @db.Timestamptz(6) @map("collected_at")

  lead Lead @relation(fields: [leadId], references: [id], onDelete: Cascade)

  @@unique([leadId, source, signalType, url], map: "uq_lead_signals_dedup")
  @@index([leadId])
  @@index([leadId, confidence(sort: Desc)])
  @@map("lead_signals")
}
```

**Lead additions:**
```prisma
// added fields
dmLinkedinUrl       String?      @map("dm_linkedin_url")
companyLinkedinUrl  String?      @map("company_linkedin_url")
founderLinkedinUrl  String?      @map("founder_linkedin_url")
manualHookNote      String?      @map("manual_hook_note")

// added relation
signals             LeadSignal[]
```

**Email additions (prep for A/B in later chunk):**
```prisma
hookVariantId       String?      @map("hook_variant_id")
signalsUsedJson     Json?        @map("signals_used_json")
```

All additive, all nullable → zero-risk migration.

### 6.6 Dashboard changes

`web/src/pages/LeadPipeline.jsx`:
- New column "Signals" — badge count + hover-tooltip listing top 3 (type, headline).
- New icons column: `[🔗 LI-co] [🔗 LI-dm]` if URLs present, `target="_blank"`.
- Inline expandable row: `<textarea name="manual_hook_note">` — PATCH on blur.
- Existing approve/reject flow untouched.

New API routes:
- `GET /api/leads/:id/signals` → `Signal[]`
- `PATCH /api/leads/:id` → accepts `{ manualHookNote, status }` only (whitelist)

## 7. Feature Flag + Rollback

`.env`:
```
SIGNALS_ENABLED=false
SIGNALS_GLOBAL_TIMEOUT_MS=20000
SIGNALS_ADAPTERS_ENABLED=google_news,company_blog,indian_press,tech_stack,cert_transparency,pagespeed,careers_page,product_hunt,github,corp_filings
```

When `SIGNALS_ENABLED=false`:
- findLeads.js skips stage 4.6 entirely.
- Stage 5 + 10 prompts omit the signals section from their context (backwards-compatible prompt template).
- Dashboard signals column renders "—".

## 8. Non-Functional Requirements

- **Performance:** 10 adapters × 10s timeout ÷ parallel = ~10–12s added per lead worst case. Acceptable against findLeads daily runtime (~60min total for ~150 leads).
- **Reliability:** any single adapter failure logs + continues. If ≥50% of adapters fail on a lead, log a warning but proceed.
- **Security:** no adapter stores raw secrets; all env vars referenced via existing `src/core/config` pattern. HTTP calls use existing `axios` dep, no new auth surface.
- **Observability:** per-adapter timing + success/failure counts written to `cron_log.notes` as JSON suffix when findLeads completes.
- **Cost:** ₹0 added at Phase 0. Paid adapters gated behind separate env flags, off by default.
- **Testability:** every adapter has a unit test with fixtured HTTP response; orchestrator has integration test with 3 mocked adapters (success, timeout, throw).

## 9. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| An RSS source changes format | Adapter breaks | Graceful-fail + log; weekly canary test |
| crt.sh rate limits | subdomain signals empty | Use cached DNS + HEAD fallback, not critical signal |
| PageSpeed API quota hit (25k/day) | Performance signal missing | At 34 leads/day we use <100/day, no risk |
| Gemini grounding returns no LI URLs for Indian SMBs | Dashboard LI icons empty | Expected ~50% coverage; fall through to Google search manual |
| Claude uses signals to hallucinate facts | Bad hook, bad reputation | Stage 10 prompt forces `signalsUsed: string[]` declaration — audit field catches drift; content validator still runs |
| Cross-tenant data leakage (future phase) | Data integrity | `leadId` foreign key enforced; LeadSignal has no tenantId yet but inherits through Lead when tenantId is added in phase 1.5 |

## 10. Out-of-Band Concern

**CLAUDE.md is stale on DB layer** — still says "better-sqlite3 WAL mode" but repo is on Prisma + Postgres. Not blocking this spec, but worth a separate small update to CLAUDE.md section 1 + section 9. Noted for follow-up task, not included in this plan's scope.

---

## Open Questions

1. Should `manualHookNote` block the send if unset, or be purely optional? **Proposed: optional.** Human-in-loop is a workflow enhancement not a gate.
2. Should we run signals on *all* findLeads stages or only post-Gate-1? **Proposed: only post-Gate-1 for cost/time efficiency.**
3. A/B testing (hook variants) — should v1 include it or defer? **Proposed: defer to Chunk 6, after free signals prove lift.**

Answered-by-default unless reviewer objects.
