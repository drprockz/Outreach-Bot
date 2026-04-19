# ICP Framework Refactor — Design Spec

**Date:** 2026-04-19
**Status:** Draft — pending user review
**Owner:** Darshan Parmar
**Scope:** single-tenant; multi-tenancy parked for Phase 2

---

## 1. Problem

Radar's current ICP scorer is a flat list of 8 heuristic rules (`icp_rules` table) with points ∈ {-3..+3}, concatenated into a Gemini prompt that returns a 0–10 score and A/B/C bucket. It works but has three weaknesses:

1. **No structured notion of what we're selling** — the scorer implicitly encodes the offer through rule wording. Changing pricing, positioning, or target pain requires rewriting cryptic rules.
2. **No analytical visibility** — a lead scores 7; nobody can see *why*. Was it tech fit? Intent? A breakdown would make the scorer debuggable.
3. **Hard drops are ad-hoc** — Gate 1 hard-codes a modern-stack drop; there's no general mechanism for "disqualifiers" that should eject a lead regardless of score.

The goal is to replace the scorer with a structured offer-discovery + ICP-scoring framework that produces a 0–100 weighted score across 6 factors, with per-factor breakdown, key matches, key gaps, and explicit disqualifiers. Two new records — **OFFER** (what we sell) and **ICP_PROFILE** (who we target) — become first-class editable entities in the dashboard.

---

## 2. Scoping Decisions

Five clarifying decisions set the shape of this work:

| # | Decision | Choice |
|---|---|---|
| 1 | How does 0–100 score connect to A/B/C funnel? | **Keep A/B/C**, derive from 0–100 via configurable thresholds (A≥70, B≥40, C<40). |
| 2 | How are OFFER and ICP edited? | **Two JSON-blob tables, one form per blob in dashboard** (single-row `offer` and `icp_profile`). |
| 3 | What LEAD fields feed the scorer? | **Hybrid** — extend extraction to add `employees_estimate` and `business_stage` only. Skip revenue/budget (unknowable for Indian MSME from public data). |
| 4 | Are disqualifiers strict? | **Hard disqualifiers override score.** Scorer emits disqualifiers; lead routed to `status='disqualified'` regardless of points total. |
| 5 | What about existing scored leads? | **Rescore all existing leads in place** via one-off script. |

Out of scope:
- Multi-tenancy (Phase 2). Schema stays single-row-per-table; `tenant_id` added later.
- New status workflows for `disqualified` beyond routing (no alerts, no review UI).
- Offer variants / A-B-tested ICPs. One OFFER, one ICP_PROFILE.
- Re-prompting Gemini with different templates per niche.

---

## 3. Data Model

### 3.1 New tables

```sql
-- What we sell. Always exactly 1 row.
CREATE TABLE IF NOT EXISTS offer (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  problem         TEXT,
  outcome         TEXT,
  category        TEXT,
  use_cases       TEXT,          -- JSON array
  triggers        TEXT,          -- JSON array
  alternatives    TEXT,          -- JSON array
  differentiation TEXT,
  price_range     TEXT,
  sales_cycle     TEXT,
  criticality     TEXT,          -- "mission-critical" | "optional"
  inaction_cost   TEXT,
  required_inputs TEXT,          -- JSON array
  proof_points    TEXT,          -- JSON array
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Who we target. Always exactly 1 row.
CREATE TABLE IF NOT EXISTS icp_profile (
  id                     INTEGER PRIMARY KEY CHECK (id = 1),
  industries             TEXT,  -- JSON array
  company_size           TEXT,
  revenue_range          TEXT,
  geography              TEXT,  -- JSON array
  stage                  TEXT,  -- JSON array
  tech_stack             TEXT,  -- JSON array (preferred stacks)
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
  hard_disqualifiers     TEXT,  -- JSON array: strings that, if matched on a lead, force disqualification
  updated_at             DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 3.2 Leads table additions (ALTER TABLE)

Added via idempotent `addColumnIfMissing()` helper in `initSchema()`:

```sql
ALTER TABLE leads ADD COLUMN icp_breakdown       TEXT;  -- JSON {firmographic,problem,intent,tech,economic,buying}
ALTER TABLE leads ADD COLUMN icp_key_matches     TEXT;  -- JSON array
ALTER TABLE leads ADD COLUMN icp_key_gaps        TEXT;  -- JSON array
ALTER TABLE leads ADD COLUMN icp_disqualifiers   TEXT;  -- JSON array
ALTER TABLE leads ADD COLUMN employees_estimate  TEXT;  -- "1-10" | "10-50" | "50-200" | "unknown"
ALTER TABLE leads ADD COLUMN business_stage      TEXT;  -- "owner-operated" | "growing" | "established" | "unknown"
```

Semantic change: `icp_score` now represents 0–100 (was 0–10). No column rename to minimize code churn; rescore script populates new scale.

### 3.3 New `status` value

`leads.status` gains `'disqualified'` alongside existing statuses. The authoritative enum is the comment block at `db/schema.sql:49-51` (currently: `discovered/extraction_failed/judge_skipped/email_not_found/email_invalid/icp_c/deduped/ready/queued/sent/replied/unsubscribed/bounced/nurture`). Migration updates that comment to include `disqualified`. Leads with disqualifiers from the scorer are inserted with this status; they are *not* nurtured (distinct from C-priority).

### 3.4 Config additions

New rows in `config` table (populated by `initSchema`):

| key | default |
|---|---|
| `icp_threshold_a` | `70` |
| `icp_threshold_b` | `40` |
| `icp_weights` | `{"firmographic":20,"problem":20,"intent":15,"tech":15,"economic":15,"buying":15}` (JSON — values must sum to 100; validated at PUT time via `/api/config`) |

### 3.5 Deprecation

`icp_rules` table and `src/api/routes/icpRules.js` stay in place during migration but are no longer consumed. Removed in a follow-up PR after the new flow is verified in prod.

---

## 4. Scoring Flow

### 4.1 New module: `src/core/ai/icpScorer.js`

Encapsulates scoring logic, isolated from the engine so it can be unit-tested without the pipeline.

```js
// Load once per pipeline run
export function loadScoringContext(db) {
  const offer = db.prepare('SELECT * FROM offer WHERE id = 1').get();
  const icp   = db.prepare('SELECT * FROM icp_profile WHERE id = 1').get();
  if (!offer || !icp) {
    throw new Error('ICP scoring requires offer + icp_profile rows to exist');
  }
  const parsedOffer = parseJsonFields(offer, OFFER_JSON_FIELDS);
  const parsedIcp   = parseJsonFields(icp, ICP_JSON_FIELDS);

  // Configured-ness check (see §6.2) — rows exist but may be seeded-empty.
  // Require the two smell-test fields to be non-empty before the engine will run.
  if (!parsedOffer.problem || !Array.isArray(parsedIcp.industries) || parsedIcp.industries.length === 0) {
    throw new Error('ICP scoring requires offer.problem and icp_profile.industries to be configured');
  }
  return { offer: parsedOffer, icp: parsedIcp };
}

// Score one lead
export async function scoreLead(lead, ctx) {
  const prompt = buildScorerPrompt(lead, ctx.offer, ctx.icp, ctx.weights);
  const result = await callGemini(prompt);
  const parsed = parseScorerJson(result.text);  // may fall through to fallback on error
  return {
    icp_score:         clampInt(parsed.score, 0, 100),
    icp_priority:      bucket(parsed.score, ctx.threshA, ctx.threshB),
    icp_breakdown:     parsed.breakdown,
    icp_key_matches:   parsed.key_matches,
    icp_key_gaps:      parsed.key_gaps,
    icp_disqualifiers: parsed.disqualifiers,
    icp_reason:        summarize(parsed),
    costUsd:           result.costUsd,
  };
}

// Helpers (exported for tests)
export function bucket(score, threshA, threshB) { /* score >= threshA → 'A'; >= threshB → 'B'; else 'C' */ }
export function clampInt(n, lo, hi) { /* ... */ }
```

### 4.2 Prompt structure

```
You are an ICP scoring engine.

OFFER: <JSON-serialized offer record>
ICP_PROFILE: <JSON-serialized icp_profile record>
LEAD: {
  business_name, industry (from category), employees_estimate,
  business_stage, geography (city), tech_stack, known_tools,
  roles_present (owner_role), signals (business_signals +
  website_problems), observed_pains (judge_reason)
}

Score LEAD 0-100 using these weights: <weights JSON>.

Scoring method:
- Firmographic Fit (0-20): match industry, size, stage, geography
- Problem Intensity (0-20): evidence of pains aligned to OFFER.problem and ICP.problem_cost/frequency
- Intent/Trigger (0-15): presence of ICP.intent_signals or OFFER.triggers
- Tech/Environment Fit (0-15): overlap with ICP.tech_stack and required_inputs
- Economic Fit (0-15): inferred capacity vs price_range (use business_stage/employees as proxy)
- Buying Readiness (0-15): presence of initiator_roles, decision_roles, compatible buying_process

For each factor, award points proportional to evidence.
Missing evidence counts as a key_gap, not a penalty.
If LEAD matches any ICP.hard_disqualifiers, list them in disqualifiers.

Return JSON ONLY:
{
  "score": <int 0-100>,
  "breakdown": {"firmographic":n,"problem":n,"intent":n,"tech":n,"economic":n,"buying":n},
  "key_matches": [<strings>],
  "key_gaps": [<strings>],
  "disqualifiers": [<strings>]
}
```

### 4.3 Gate 3 rewrite in `findLeads.js`

Replaces the current ICP worker (`src/engines/findLeads.js:349-395`; nurture INSERT block at `:362-386`):

```js
const icp = await scoreLead(lead, ctx);
totalCost += icp.costUsd;
bumpMetric('gemini_cost_usd', icp.costUsd);
bumpMetric('total_api_cost_usd', icp.costUsd);

Object.assign(lead, icp);

// NEW: disqualifiers override score (Decision 4)
if (icp.icp_disqualifiers.length > 0) {
  insertLead(db, lead, niche, 'disqualified');
  bumpMetric('leads_disqualified');
  leadsSkipped++;
  return null;
}

// Bucketing by score (Decision 1)
if (icp.icp_priority === 'C') {
  insertLead(db, lead, niche, 'nurture');
  leadsSkipped++;
  return null;
}

bumpMetric('leads_icp_ab');
return lead;
```

`insertLead()` is a new helper in `src/engines/findLeads.js` that centralizes the three-status fork (ready/nurture/disqualified) and reduces the ~25-column-INSERT duplication. Signature:

```js
// status ∈ {'ready', 'nurture', 'disqualified'}
// Ready leads additionally require hook/body/subject to be generated (by Stage 10/11)
// and insert into BOTH `leads` and `emails` tables. Helper handles only the `leads` INSERT;
// the emails INSERT stays inline in the ready branch since it's status-specific.
function insertLead(db, lead, niche, status) {
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

Column-set coverage:
- All three statuses write the same columns. Disqualified/nurture have `email_verified_at = NULL` (never proceeded to verification context of a live campaign), ready gets `datetime('now')`. This is a minor difference from current behavior — today nurture leads get `email_verified_at` set; the change is intentional (the lead didn't enter the sending pipeline, so the verification timestamp is semantically wrong to carry).
- For `ready`, the separate `INSERT INTO emails (...)` for hook/body/subject stays inline after the `insertLead()` call (same structure as today at `findLeads.js:465-476`).

### 4.4 Stage 2–6 extraction changes

Extend `stages2to6_extract` prompt (`src/engines/findLeads.js:58-84`) to also return:
- `employees_estimate`: string, one of `"1-10" | "10-50" | "50-200" | "unknown"`
- `business_stage`: string, one of `"owner-operated" | "growing" | "established" | "unknown"`

Both default to `"unknown"` on extraction ambiguity — fed to scorer as-is, which penalizes nothing but records them as key_gaps.

Revenue and budget estimation is intentionally NOT added to extraction (Decision 3): for MSME/SME Indian businesses, those fields are genuinely unknowable from public data and would contaminate the score.

### 4.5 Scoring context lifecycle

`loadScoringContext(db)` is called **once** at the start of the Stage 9 phase in `findLeads.js`, not per lead. The returned context is passed to each concurrent `scoreLead` worker. Weights and thresholds are read from config alongside the OFFER/ICP rows.

---

## 5. API + Dashboard

### 5.1 New API routes

```
GET  /api/offer          → {offer: {...}} (nulls if not yet configured)
PUT  /api/offer          → body = full offer object; full replacement
GET  /api/icp-profile    → {profile: {...}}
PUT  /api/icp-profile    → body = full profile object; full replacement
```

Files:
- `src/api/routes/offer.js`
- `src/api/routes/icpProfile.js`

Both wired in `src/api/server.js` following the existing route mount pattern.

Validation at PUT time:
- JSON-array fields validated as arrays (not strings)
- Unknown keys ignored (forward-compat)
- Full replacement, not PATCH — consistent with single-row semantics

Auth: protected by the existing `requireAuth` middleware (default on all `/api/*` except `/api/auth/login`).

### 5.2 Deprecated route

`src/api/routes/icpRules.js` kept mounted during migration — nothing consumes it after rollout step 4, but removing it is a separate follow-up PR to avoid a broken intermediate state.

### 5.3 Dashboard pages

Replaces `ICP Rules` page with two new pages:

**`web/src/pages/Offer.jsx`** — 13 fields grouped:
- *What:* problem, outcome, category, differentiation
- *Who benefits:* use_cases[], triggers[]
- *Commercial:* price_range, sales_cycle, criticality, inaction_cost, alternatives[]
- *Proof:* proof_points[], required_inputs[]

**`web/src/pages/IcpProfile.jsx`** — 21 fields grouped:
- *Company fit:* industries[], company_size, revenue_range, geography[], stage[], tech_stack[], internal_capabilities[], budget_range
- *Problem intensity:* problem_frequency, problem_cost, impacted_kpis[]
- *Buying behavior:* initiator_roles[], decision_roles[], objections[], buying_process, intent_signals[]
- *Current solutions:* current_tools[], workarounds[], frustrations[], switching_barriers[]
- *Hard disqualifiers:* hard_disqualifiers[]

Both pages follow the layout conventions of `web/src/pages/EngineConfig.jsx` — controlled inputs, section headers, single Save button that does a full PUT. Array fields use an add/remove chip UI (same as tag-input patterns).

### 5.4 Nav changes

`web/src/App.jsx`: replace `ICP Rules` nav entry with two entries — `Offer` and `ICP Profile`.

### 5.5 LeadPipeline.jsx enhancements

Lead detail drawer at `web/src/pages/LeadPipeline.jsx:222` currently shows `{icp_score} / {icp_priority}`. Extend to show:
- Score on 0–100 scale
- Per-factor breakdown (6 bars, labeled)
- Key matches (chip list)
- Key gaps (chip list, muted)
- Disqualifiers (chip list, red) if present

### 5.6 FunnelAnalytics.jsx

Line 240 has inline color thresholds `>= 7 : green, >= 4 : amber, else muted`. Update to `>= 70 : green, >= 40 : amber, else muted` to match the new scale.

---

## 6. Error Handling

### 6.1 Scorer JSON parse failure

Gemini occasionally returns malformed JSON. Fallback:

```js
{
  icp_score: 0,
  icp_priority: 'C',
  icp_breakdown: null,
  icp_key_matches: [],
  icp_key_gaps: ['scorer_parse_error'],
  icp_disqualifiers: [],
  icp_reason: 'parse error'
}
```

- Lead routed to `nurture` (score=0 → C-priority, no disqualifiers)
- Raw Gemini response logged via `logError('findLeads.icpScore', err, { rawResponse, leadId })`
- `bumpMetric('icp_parse_errors')` for dashboard visibility
- No Telegram alert — occasional parse errors are normal

### 6.2 Missing OFFER or ICP_PROFILE row

`loadScoringContext` throws a clear error; `findLeads.js` catches it at the top-level try/finally, logs to `error_log`, finishes cron with `status='failed'`, and sends a Telegram alert:

> `findLeads failed: OFFER and ICP_PROFILE must be configured in dashboard before scoring can run`

No fallback to "generic" scoring — silent bad scoring is worse than loud failure.

### 6.3 Malformed JSON in DB array fields

- Validated at PUT time: API route rejects requests that would write bad JSON
- `parseJsonFields()` in the engine returns `[]` on parse error and logs a warning — engine never crashes on corrupted config

### 6.4 Empty disqualifiers list

Fine. Means no hard disqualifiers configured; scorer still emits soft `key_gaps`. No special handling needed.

### 6.5 Out-of-range scores from Gemini

`clampInt(score, 0, 100)` applied before bucketing. Log a warning if clamping actually modifies the value.

### 6.6 Breakdown sum ≠ score

Don't validate. `score` is authoritative; `breakdown` is analytical. UI shows both as returned. Because Gemini can produce an overall `score` that doesn't numerically match the sum of its own `breakdown`, the LeadPipeline drawer (§5.5) includes a subtle caption under the breakdown bars — e.g. "Per-factor evidence from scorer (may not sum exactly to score)" — to avoid user confusion.

### 6.7 New telemetry counters

- `leads_disqualified` — parallel to existing `leads_icp_ab`
- `icp_parse_errors`

---

## 7. Migration & Rescore

### 7.1 Schema migration

Added to `db/schema.sql` and `src/core/db/index.js` `initSchema()`:

1. `CREATE TABLE IF NOT EXISTS offer` and `CREATE TABLE IF NOT EXISTS icp_profile`
2. `addColumnIfMissing()` helper:

   ```js
   function addColumnIfMissing(db, table, column, type) {
     const cols = db.prepare(`PRAGMA table_info(${table})`).all();
     if (!cols.some(c => c.name === column)) {
       db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`).run();
     }
   }
   ```

3. Call `addColumnIfMissing` for all 6 new `leads` columns (4 scoring + 2 extraction)
4. Seed `offer` and `icp_profile` with a single row of **null/empty fields** if the table is empty, using `INSERT OR IGNORE INTO offer (id) VALUES (1)` (and the same for `icp_profile`). This guarantees exactly one row exists so the dashboard always has something to PUT against. The `loadScoringContext` check in §4.1 rejects the seeded-empty state by requiring `offer.problem` and `icp_profile.industries` to be non-empty — so the engine refuses to score until the human has filled minimum fields via the dashboard.
5. Insert default config rows for `icp_threshold_a`, `icp_threshold_b`, `icp_weights` if missing.

### 7.2 Rescore script

`scripts/rescoreLeads.js` — one-off manual run, not cron-invoked.

```
1. Load offer + icp_profile — exit with error if either unset
2. SELECT all leads WHERE status IN ('ready','sent','replied','nurture','bounced')
   (skip 'email_invalid' — never scored originally; skip 'disqualified' — didn't exist yet)
3. For each lead:
   - Build LEAD record from existing columns
   - Call scoreLead() with the shared context
   - UPDATE leads SET icp_score, icp_priority, icp_breakdown,
                      icp_key_matches, icp_key_gaps,
                      icp_disqualifiers, icp_reason WHERE id = ?
   - Status handling when rescoring surfaces a disqualifier:
     - `sent` / `replied` / `bounced` / `unsubscribed` → DO NOT change status (history is sacred — already contacted)
     - `nurture` → DO NOT change status (keep the distinction between "C-priority" and "disqualified" only for *newly* scored leads)
     - `ready` → **move to `disqualified`** (not yet contacted; having the disqualifier means we shouldn't send). Also delete the corresponding row in `emails` where `status='pending'` so `sendEmails.js` won't pick it up.
4. Print progress every 50 leads
5. Final summary: A/B/C/disqualified counts + total Gemini cost + `ready→disqualified` transitions
```

Cost bound: ~$0.001 × N Gemini Flash calls. Re-runnable (UPDATE-only).

### 7.3 Rollout sequence

| Step | Action | Gate |
|---|---|---|
| 0 | **Human:** set `config.find_leads_enabled=0` via dashboard | prevents cron from running during rollout |
| 1 | Merge schema + migration helper (creates offer/icp_profile tables, seeded empty + new lead columns) | backward-compatible; `find_leads_enabled=0` blocks cron |
| 2 | Merge `offer` + `icp_profile` API routes + dashboard *edit* pages (not FunnelAnalytics/LeadPipeline color changes) | dashboard editable |
| 3 | **Human:** fill in OFFER and ICP_PROFILE via dashboard | manual gate |
| 4 | **Human:** run `scripts/rescoreLeads.js` once against prod DB | rescores all leads to 0–100 scale |
| 5 | Merge new `findLeads.js` scorer + gate logic + dashboard visualization updates (LeadPipeline breakdown drawer, FunnelAnalytics 70/40 color thresholds) | must happen together — score scale flip is a cliff |
| 6 | **Human:** set `config.find_leads_enabled=1` via dashboard | re-enable cron |
| 7 | Verify next 09:00 IST `findLeads` run produces sensible scores | observation |
| 8 | Follow-up PR: remove deprecated `icp_rules` table + route | cleanup |

The `find_leads_enabled=0` toggle at step 0 is not optional — without it, the 09:00 IST cron between steps 1 and 6 will run the old scorer against leads whose scores are about to be rewritten to 0–100 by the rescore script, producing inconsistent data. The existing config-driven enable flag at `src/engines/findLeads.js:167` already supports this.

### 7.4 Rollback plan

New leads columns are additive and nullable. Rollback procedure if the new scorer misbehaves in prod after step 5:

1. `config.find_leads_enabled=0` via dashboard (stops the cron immediately)
2. `git revert` the step-5 commit (restores old `findLeads.js` + old dashboard thresholds)
3. Run `scripts/rescoreLeads.js --legacy` — a flag that re-runs the *old* rubric-based scorer (kept intact during migration; `icp_rules` table still exists) and writes 0–10 scores back into `icp_score`. Cost bound is the same as forward rescore (~$0.001 × N).
4. `config.find_leads_enabled=1`

The `--legacy` flag is added to `rescoreLeads.js` as part of step-4 deliverables specifically to enable this reversal. Without it, rollback is not clean because `icp_score` values are stuck on the 0–100 scale.

Budget the rollback rescore at ~$0.50 for 500 leads — cheap enough that we don't bother storing a shadow `icp_score_v1` column.

---

## 8. Testing

All tests use vitest, mirror the existing `tests/` layout.

### 8.1 New test files

**`tests/core/ai/icpScorer.test.js`**
- `loadScoringContext` throws when `offer` row missing
- `loadScoringContext` throws when `icp_profile` row missing
- `loadScoringContext` parses JSON array fields correctly
- `loadScoringContext` returns `[]` on malformed JSON array field + warns
- `scoreLead` happy path: mocked Gemini returns valid JSON → returns normalized fields
- `scoreLead` parse-error path: Gemini returns garbage → fallback 0/C, logs rawResponse
- `scoreLead` clamps negative scores to 0
- `scoreLead` clamps >100 scores to 100
- `scoreLead` preserves disqualifiers array
- `bucket()` boundary tests: 70→A, 69→B, 40→B, 39→C

**`tests/api/offer.test.js`**
- GET returns single row (nulls if unseeded)
- PUT with valid body persists; second PUT fully replaces
- PUT rejects non-array for `use_cases`
- Auth middleware rejects unauthenticated request

**`tests/api/icpProfile.test.js`** — parallel tests for `/api/icp-profile`

**`tests/scripts/rescoreLeads.test.js`**
- N seeded leads + mocked scorer → all rows UPDATED
- Sent/replied leads don't get status changed even if scorer emits disqualifiers
- Script exits non-zero if offer/icp_profile unset

### 8.2 Updated test files

**`tests/engines/findLeads.test.js`**
- Mock `scoreLead` at the module level (not Gemini) — simpler assertion surface
- New test: disqualifier returned → lead inserted with `status='disqualified'`, never reaches hook/body stages
- Update existing A/B/C tests to 0–100 scores (75→A, 50→B, 20→C)
- Existing "C → nurture" test stays; now covers score<40 without disqualifier

**`tests/core/db/db.test.js`**
- `initSchema creates offer and icp_profile tables`
- `initSchema adds new leads columns idempotently` (runs initSchema twice without error)
- `initSchema seeds offer and icp_profile with one empty row each`
- `initSchema seeds default icp_weights, icp_threshold_a, icp_threshold_b config rows`

**`tests/engines/insertLead.test.js`** (new file, small)
- `status='ready'` inserts all columns correctly and sets `email_verified_at=now()`
- `status='nurture'` inserts with `email_verified_at=NULL`
- `status='disqualified'` inserts with `email_verified_at=NULL`, stores disqualifiers JSON array
- Missing optional fields default to safe values (e.g. `employees_estimate` → `'unknown'`)

**`tests/engines/sendFollowups.test.js`** (`:43`)
- Rescale seed: `icp_score: 5` → `icp_score: 50`

**`tests/engines/sendEmails.test.js`** (3 occurrences)
- Rescale seed scores to 0–100 scale

### 8.3 No new E2E tests

The dashboard forms are straightforward controlled inputs over validated APIs. vitest coverage of API routes + manual verification at rollout step 3 is sufficient. Consistent with existing repo (no Playwright today).

### 8.4 Test count delta

Current: 109 tests. Target post-change: ~130 tests (+21 new, ~5 updated).

---

## 9. File Inventory

**New files:**
- `src/core/ai/icpScorer.js`
- `src/api/routes/offer.js`
- `src/api/routes/icpProfile.js`
- `web/src/pages/Offer.jsx`
- `web/src/pages/IcpProfile.jsx`
- `scripts/rescoreLeads.js`
- `tests/core/ai/icpScorer.test.js`
- `tests/api/offer.test.js`
- `tests/api/icpProfile.test.js`
- `tests/engines/insertLead.test.js`
- `tests/scripts/rescoreLeads.test.js`

**Modified files:**
- `db/schema.sql` — add `offer`, `icp_profile`, new leads columns; update `status` enum comment to include `disqualified`
- `src/core/db/index.js` — `initSchema()` seeds + `addColumnIfMissing` helper + default config rows
- `src/engines/findLeads.js` — replace `stage9_icpScore` + `buildIcpRubric`; extend `stages2to6_extract`; rewrite Gate 3; extract `insertLead` helper
- `src/api/server.js` — mount new routes
- `src/api/routes/config.js` — add `icp_weights` sum-to-100 validation at PUT
- `web/src/App.jsx` — nav entries (replace `ICP Rules` with `Offer` + `ICP Profile`)
- `web/src/pages/LeadPipeline.jsx` — detail drawer shows breakdown/matches/gaps/disqualifiers
- `web/src/pages/FunnelAnalytics.jsx:240` — color thresholds 7/4 → 70/40
- `tests/engines/findLeads.test.js` — rescale + new disqualified test
- `tests/engines/sendFollowups.test.js` — rescale seed
- `tests/engines/sendEmails.test.js` — rescale seed (3 occurrences)
- `tests/core/db/db.test.js` — new migration/seed tests

**Deprecated (removed in follow-up PR):**
- `src/api/routes/icpRules.js`
- `icp_rules` table
- `buildIcpRubric()` function
- `web/src/pages/IcpRules.jsx` (if it exists as separate file)

---

## 10. Open Questions

None at design time. Items to confirm at implementation-plan stage:

- Exact JSON shape for chip-input UI (probably re-uses an existing pattern — check `web/src/components/`).
- Whether `insertLead` helper extraction warrants its own PR or ships with the main refactor.
- `icp_reason` format — currently a short prose string; in new scheme it's summarized from key_matches. Decide on template at implementation time.
