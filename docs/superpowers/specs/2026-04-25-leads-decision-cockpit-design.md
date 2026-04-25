# Leads Decision Cockpit — Design

**Date:** 2026-04-25
**Owner:** Darshan
**Status:** Approved (ready for implementation plan)
**Affected surfaces:** `web/src/pages/Leads.jsx`, `src/api/routes/leads.js`, new `src/api/routes/savedViews.js`, Prisma schema, engine libs (read-only imports for retry).

## 1. Problem

The Leads page (`web/src/pages/Leads.jsx`) is a flat, read-only list. It exposes five filters (status, category, city, tech_stack, date) — `tech_stack` is silently dropped on the backend because it became JSON. There is no way to:

- triage by ICP priority (A/B/C exists in the API response but not as a filter),
- find leads with a specific signal (hiring/funding/launch),
- act on a batch (mark as nurture, queue, regenerate hook, re-verify email),
- export a slice for offline work,
- save a query you keep re-typing,
- see counts of "what's actionable right now" without scrolling.

Goal: turn the page into an operator console that drives daily decisions — *who to send to today, who to drop, who to regenerate copy for* — without leaving the dashboard.

## 2. Scope

In-scope:

- New filters, sort, search, multi-select.
- KPI strip (global + filter-scoped).
- User-configurable saved views (CRUD).
- Bulk actions: status transitions + retry stages.
- CSV export.
- Sync-with-SSE retry orchestration (capped at 25 leads/batch).

Out of scope (deferred):

- Multi-tenancy on saved views (Phase 1.5).
- Realtime KPI push — poll on focus is enough.
- A/B testing of views.
- Column picker — replaced by dense/comfortable toggle.
- BullMQ / Redis job queue — Phase 3.

## 3. Architecture

### 3.1 Frontend
`Leads.jsx` becomes a composition:

```
<Leads>
  <KpiStrip />            // 5 tiles, global + filter-scoped numbers
  <SavedViews />          // chip row + Save/Edit dialogs
  <FilterBar />           // top row + collapsible "More filters" drawer
  <BulkActionBar />       // sticky, slides in when ≥1 selected
  <LeadsTable />          // checkbox col, sortable headers, dense toggle
  <LeadDetailPanel />     // existing — unchanged
</Leads>
```

State lives in the URL query string. A single `useFiltersFromUrl()` hook owns parse + serialize. This makes views shareable, bookmarkable, and trivially serializable into the `saved_views` row.

### 3.2 Backend (new + extended endpoints)

| Method + path | Purpose |
|---|---|
| `GET /api/leads` | extended: new filters, `sort`, `search`, multi-value params |
| `GET /api/leads/kpis` | global + filter-scoped counters in one call |
| `GET /api/leads/export.csv` | streamed CSV honoring filters; `?columns=visible\|all` |
| `POST /api/leads/bulk/status` | bulk status transition (whitelisted set) |
| `POST /api/leads/bulk/retry` | bulk re-run a stage; supports `?dry_run=1` |
| `GET /api/saved-views` | list views |
| `POST /api/saved-views` | create |
| `PATCH /api/saved-views/:id` | rename / update filters |
| `DELETE /api/saved-views/:id` | delete |

### 3.3 Schema additions

One new table — `saved_views`:

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

Single-tenant for now. When Phase 1.5 lands, add nullable `tenantId Int?` and migrate existing rows to tenant 1 — this is consistent with the broader Phase 1.5 approach in CLAUDE.md §8.

No new column on `leads`. ICP A/B/C bucket is computed in `serializeLead()` already (`src/api/routes/leads.js:18`); the filter resolves A/B/C → `icpScore` ranges using the same thresholds.

## 4. UI Layout

Top to bottom on the page:

1. **KPI strip** — 5 tiles. When a filter is active each tile renders `1,420 · 38` style (global · in-filter). Tiles:
   - Total leads
   - A / B / C distribution (single tile, three sub-counts)
   - Ready to send (`status='ready'`)
   - Signals last 7 days (count of distinct lead_ids with a signal in window)
   - Replies awaiting triage (joins `replies` where unhandled)
2. **Saved-view chips** — horizontal scrollable row. Click applies `filters_json` + `sort` to URL state. A trailing `★ Save current view` button opens a name dialog. Hover on a chip reveals pencil (rename) and trash (delete).
3. **Filter bar** — top row holds: search, status (multi), ICP priority (multi), email status (multi), discovered date range. A `More filters ▾` button opens a drawer with the rest (see §5).
4. **Bulk action bar** — sticky bar that slides down from below the filter bar when ≥1 row is selected. Shows selection count + buttons: `Mark as nurture`, `Mark as unsubscribed`, `Add to reject list`, `Queue for send`, and a `Retry ▾` dropdown (verify email / regen hook / regen body / rescore ICP / re-extract / re-judge). Each retry option opens a confirm dialog showing estimated cost.
5. **Table** — adds a leading checkbox column (with header "select all on page"), sortable column headers (click toggles asc/desc), and a dense/comfortable toggle in the table header bar.
6. **Lead detail panel** — unchanged.

## 5. Filters

Multi-select where listed. Implementation: `URLSearchParams` accepts repeated keys (`?status=ready&status=queued`) — `req.query.status` becomes `string | string[]`; normalize to array in API.

| Filter | Type | Backend treatment |
|---|---|---|
| Search | text | `ILIKE` against `business_name`, `website_url`, `contact_email` |
| Status | multi | `where.status = { in: [...] }` |
| ICP priority | multi | A/B/C → resolves to `icpScore` ranges via `getThresholds()` |
| ICP score | range | `gte/lte` |
| Quality score | range | `gte/lte` |
| Category | multi | `in` |
| City | multi | `in` |
| Country | multi | `in` |
| Email status | multi | `in` |
| Tech stack | multi | JSON array — Postgres `?\|` (any) operator via `$queryRaw` |
| Business stage | multi | `in` |
| Employees | multi | `in` |
| Has LinkedIn DM | bool | `dmLinkedinUrl IS NOT NULL` |
| Has signals | bool + min count | sub-select on `lead_signals` |
| Signal type | multi | join `lead_signals.signalType IN (...)` |
| Signal date range | dates | join on `lead_signals.signalDate` |
| Discovered date | range | existing |
| In reject list | bool | hidden by default; toggleable |

Multi-value distincts (categories, cities, countries) are exposed via small `GET /api/leads/facets` endpoint that returns `{ categories: [...], cities: [...], countries: [...] }` cached for 60s in process.

## 6. Sort

Sort dropdown in the table header bar. Options:

- ICP score (default desc)
- Quality score
- Signal count (requires sub-select join)
- Discovered date
- Last contacted (`domain_last_contacted`)

Default sort: `icpScore desc, discoveredAt desc`. Stored in URL as `sort=icp_score:desc`.

## 7. Saved Views

```
GET    /api/saved-views                  → { views: [{id, name, filters_json, sort, updated_at}] }
POST   /api/saved-views                  → body: { name, filtersJson, sort } → 201 { view }
PATCH  /api/saved-views/:id              → body: same shape, partial → 200 { view }
DELETE /api/saved-views/:id              → 204
```

`filtersJson` is the URL query as an object. Hard delete (no soft-delete at this scale). Names not enforced unique — duplicates allowed (operator may want "Mumbai SaaS A — v1", "v2").

## 8. Bulk Actions

Both endpoints accept `{ leadIds: number[] }`. Reject if `leadIds.length > 25` for retry, `> 200` for status changes.

### 8.1 `POST /api/leads/bulk/status`

Body: `{ leadIds, action }` where `action ∈ {'nurture','unsubscribed','reject','queue'}`.

- `nurture` → `status='nurture'`.
- `unsubscribed` → `status='unsubscribed'`.
- `reject` → for each lead: insert email + domain into `reject_list` (idempotent on `@@index([email])`/`@@index([domain])`); set `status='unsubscribed'`, `in_reject_list=true`. **Honors the non-negotiable** that `reject_list` is absolute — once added, no path bypasses it.
- `queue` → `status='queued'`. Send-time validators (`DAILY_SEND_LIMIT`, `contentValidator`, bounce rate) still gate actual sending. The confirm dialog says so verbatim.

Returns `{ updated: number, skipped: [{id, reason}] }`. Skipped rows include leads already in a terminal status (`bounced`, `replied`).

### 8.2 `POST /api/leads/bulk/retry`

Body: `{ leadIds, stage, dryRun? }` where `stage ∈ {'verify_email','regen_hook','regen_body','rescore_icp','reextract','rejudge'}`.

- `dryRun=true` returns:
  ```json
  {
    "count": 14,
    "estimated_cost_usd": 0.21,
    "breakdown_by_model": { "claude-sonnet-4-20250514": 0.18, "claude-haiku-4-5": 0.03 }
  }
  ```
  Estimate uses 30-day rolling average cost-per-call from `daily_metrics` (or the engine's published per-call cost when daily_metrics is empty). UI surfaces this in the confirm dialog.
- Without `dryRun`: server opens an SSE response and streams `{ leadId, status, error? }` events as each retry completes. The bulk action bar shows a progress meter. Inline execution; no queue table.

Server-side, retries import existing engine helpers (`verifyEmail()` from `core/integrations/mev.js`, `generateHook()` from `core/ai/claude.js`, etc.). Each retry:

- Updates the relevant lead column(s).
- Writes a `daily_metrics` cost row (per existing engine convention).
- On failure, writes to `error_log` and continues to the next lead.

If `leadIds.length > 25`, return `400 { error: 'batch_too_large', max: 25 }` and the UI tells the user to narrow selection.

## 9. CSV Export

`GET /api/leads/export.csv?<all the filter params>&columns=visible|all`.

- Streams via `res.write()` per row to avoid loading everything into memory.
- Header row first.
- Timestamps as ISO 8601.
- JSON columns (`tech_stack`, `business_signals`, `icp_breakdown`, etc.) serialized as JSON string in the cell.
- `columns=visible` → 12 columns matching the current table.
- `columns=all` → every Lead column from `serializeLead`.

Front-end: split-button (`Export CSV ▾`) with two items.

## 10. Retry Orchestration

Sync-with-SSE, capped at 25 leads/batch, decided over a queue table because:

- Solo operator, single-tenant — no concurrent-batch problem.
- 25 leads × Sonnet hook regen ≈ 25 × 1.5s ≈ 38s — well under reasonable timeouts.
- Reuses existing engine functions as libraries (no duplicate code path).
- Defers BullMQ/Redis until Phase 3 multi-tenant scale.

If a future need pushes batches > 25, we add a `retry_queue` table without changing the API contract — the response just becomes deferred (`202 Accepted` + polling endpoint).

## 11. Non-Negotiable Compliance

| Rule | How design honors it |
|---|---|
| Plain text only (1) | Bulk queue does not bypass `contentValidator`; sends still go through `sendEmails.js`. |
| Bounce rate hard stop (5) | Bulk queue does not bypass; send engine still checks. |
| Send window (6) | Bulk queue does not bypass. |
| `cron_log` start/end (7) | Retries are not cron — they write `error_log` on failure and `daily_metrics` cost rows on success. |
| `reject_list` is absolute (10) | Bulk reject inserts and never removes; no UI surface to delete reject_list rows. |
| `DAILY_SEND_LIMIT=0` = hard stop (11) | Bulk queue still respects this. |
| AI calls log model + cost (12) | Each retry writes per-call cost to `daily_metrics`, mirroring engine behavior. |
| ICP C → nurture (15) | Bulk queue blocks `status='ready' AND icp_priority='C'` from being queued; surface as a `skipped` row with reason. |

## 12. Testing

Vitest:

- `tests/api/leads.filters.test.js` — param parsing for multi-value, range, signal-type joins.
- `tests/api/leads.kpis.test.js` — global vs filter-scoped aggregates.
- `tests/api/leads.bulk.status.test.js` — whitelist enforcement; `reject_list` insert idempotence; ICP-C-cannot-queue rule.
- `tests/api/leads.bulk.retry.test.js` — `dryRun` returns cost without side effects; >25 leads → 400.
- `tests/api/leads.export.test.js` — CSV header + row shape; JSON cells; streaming.
- `tests/api/savedViews.test.js` — CRUD round-trip.
- `tests/web/Leads.filterBar.test.jsx` — URL ⇄ state sync.
- `tests/web/Leads.bulkActionBar.test.jsx` — selection state + button enable/disable.

## 13. Migration / Rollout

1. Prisma migration: create `saved_views` table.
2. Ship API + UI behind no flag (single-operator, low blast radius — losing the Leads page is non-fatal, engines run on cron independently).
3. Manual smoke: log in → run each filter → save a view → bulk retry 3 leads with `dryRun` → real retry → CSV export → bulk queue 5 leads → confirm send engine picks them up next tick.
4. No data backfill required.

## 14. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Bulk queue floods send engine, breaks daily cap intent | Daily cap enforced by `sendEmails.js` regardless — bulk queue just changes order; no risk. |
| SSE connection drops mid-retry | Each retry is per-lead atomic; UI on reconnect polls `/api/leads?ids=…` to reconcile. |
| Cost-estimate drift (averages stale) | Estimate clearly labeled "estimated"; real cost recorded post-call as today. |
| Filter combinations explode query plan | Add Postgres composite index on `(status, icp_score)` with the migration; `lead_signals` join already indexed. |
| Operator deletes a popular saved view by accident | Confirmation dialog on delete; if loss is felt, a spec-followup adds soft-delete + restore. |

## 15. Open Items

None — all clarifying questions resolved during brainstorming session 2026-04-25.
