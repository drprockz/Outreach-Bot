# Competitor Analysis — Stage 9.5

**Date:** 2026-04-25  
**Status:** Approved  
**Feature:** Free competitor analysis injected into lead pipeline (stage 9.5)

---

## Overview

Add a competitor analysis stage (9.5) to the `findLeads` pipeline that runs after ICP scoring and before hook generation. For each ICP A/B lead, Radar identifies the lead's top 3 competitors, scrapes their client/portfolio presence, and produces a pros/cons gap comparison. This data is stored on the lead record and silently injected into hook generation to produce sharper, more competitive email copy.

Everything runs on Gemini 2.5 Flash grounded search — no additional cost.

---

## Goals

- Surface competitive gaps that make cold email hooks more credible and specific
- Store structured competitor data on leads for future dashboard display (Phase 2)
- Stay within Gemini free tier (1,500 RPD) — ~100 extra calls/day for 34 leads

---

## Non-Goals

- Dashboard UI for competitor data (Phase 2)
- Running on ICP C leads (they go to nurture, skip analysis)
- Quoting competitor data verbatim in emails (AI uses it as context only)

---

## Architecture

### Placement in Pipeline

```
Stage 9  → ICP scoring
Stage 9.5 → Competitor analysis  ← NEW (ICP A/B only)
Stage 10 → Hook generation       ← receives competitor context
Stage 11 → Email body
```

Stage 9.5 runs **after the spend-cap gate** (same position as signal collection) — only for leads that will actually reach stages 10/11. Wasting Gemini calls on leads that will be skipped by the Claude spend cap is avoided. Stage 9.5 is non-blocking: any failure returns `null` and logs to `error_log`. The pipeline continues with hook generation — just without competitor context.

### New Module

`src/core/ai/competitorAnalysis.js` exports a single function:

```js
export async function analyzeCompetitors(lead): Promise<CompetitorAnalysis | null>
```

Called from `findLeads.js` as one `await analyzeCompetitors(lead)` call. Keeps pipeline stage logic thin.

### Three Gemini Calls

**Call 1 — Competitor Discovery** (grounded search)
- Input: `businessName`, `category`, `city`
- Prompt: find top 3 direct competitors of this business in the same market
- Output: `[{ name, website }]`

**Call 2 — Client/Portfolio Scrape** (grounded search, 3 parallel via `withConcurrency(3)`)
- Input: each competitor `name` + `website`
- Prompt: find notable clients, case studies, or portfolio work listed by this competitor
- Output per competitor: `{ clients: [], portfolioHighlights: [] }`
- Each lambda inside `withConcurrency` must catch its own errors and return `null` on failure (per `concurrency.js` contract: callers must never let `fn` throw)

**Call 3 — Gap Comparison** (single call, full context)
- Input: lead's `websiteProblems`, `techStack`, all competitor profiles from calls 1–2
- Prompt: structured comparison of lead vs competitors
- Output: `{ pros, cons, gaps, opportunityHook }`

Total: ~5 Gemini calls per lead (1 + 3 parallel + 1). At 34 leads/day = ~170 calls, bringing daily total from ~150 to ~320 — well within 1,500/day free tier.

---

## Data Model

New nullable column on `Lead`:

```prisma
competitorAnalysis Json?
```

Stored JSON shape:

```json
{
  "competitors": [
    {
      "name": "Acme Designs",
      "website": "acmedesigns.in",
      "clients": ["Tata Motors", "HDFC Bank"],
      "portfolioHighlights": ["e-commerce for 20+ brands", "fintech UI work"]
    }
  ],
  "pros": ["Active Instagram presence", "Good Google rating (4.6)"],
  "cons": ["No SSL", "Site loads in 8s", "No case studies listed"],
  "gaps": ["Top competitor lists enterprise clients; lead has none visible"],
  "opportunityHook": "Your top competitor Acme Designs already serves Tata Motors — a faster, modern site could help you compete for that tier of client."
}
```

---

## Hook Generation Integration (Stage 10)

When `competitorAnalysis` is non-null, the competitor context is appended to **both variant A and variant B** prompts inside `buildHookPrompt`:

```
Competitor context (use naturally, do not quote directly):
- Hook insight: [opportunityHook]
- Key gaps: [top 2 cons]
```

`buildHookPrompt` receives a new 5th positional parameter with default null:
```js
function buildHookPrompt(variant, lead, persona, signals, competitorAnalysis = null)
```
Null-safe: the competitor context block is only appended when `competitorAnalysis` is non-null. The AI uses it to write a more pointed hook — no changes to prompt structure, just additional context.

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| Any Gemini call fails / times out | Return `null`, log to `error_log` (engine=`findLeads`) |
| Malformed JSON response | Parse error caught → return `null` |
| Call 2 partial failure (one competitor) | Include successful competitors (non-null results), skip failed one |
| Free-tier budget exhausted | No cap check in Phase 1 — current usage (~320/day) is well within the 1,500/day limit. Add a `geminiCallCount` metric column and gate if this approaches 1,200 in a future phase. |

---

## Cost Tracking

`analyzeCompetitors` returns `{ ..., costUsd: number }`. In `findLeads.js`, after the call the cost is attached to the lead object via `Object.assign(lead, { competitorCost: result.costUsd })` — consistent with the `icpCost` pattern. `insertLead` is updated to include it:

```js
geminiCostUsd: (lead.extractCost || 0) + (lead.icpCost || 0) + (lead.competitorCost || 0)
```

Immediately after stage 9.5 completes, both cost metrics are bumped:

```js
await bumpMetric('geminiCostUsd', costUsd);
await bumpMetric('totalApiCostUsd', costUsd);
```

This keeps `totalApiCostUsd` accurate for spend-cap accounting and cost reporting (consistent with all other Gemini call sites in `findLeads.js`).

---

## Tests

File: `tests/core/ai/competitorAnalysis.test.js`

| Test | Description |
|---|---|
| Happy path | Mock 3 Gemini responses → correct JSON shape returned, `costUsd` accumulated |
| Malformed JSON | Gemini returns non-JSON → returns `null`, no throw |
| Partial call 2 failure | One competitor scrape lambda returns `null` → remaining competitors included in result |

---

## Schema Migration

```bash
# Local dev
npx prisma migrate dev --name add_competitor_analysis

# VPS (production)
npx prisma migrate deploy
```

`competitorAnalysis` is only written on **ready-path lead inserts** (after stage 9.5 runs). Early-exit paths (e.g. `email_invalid` inserts that bypass stages 9–11) pass `competitorAnalysis: null`. No breaking changes — all existing leads default to `null`.

---

## Future (Phase 2)

- Dashboard lead detail: expandable "Competitors" panel showing competitor cards with clients, pros/cons table
- Could feed into ICP scoring refinement (leads whose competitors have enterprise clients score higher)
