# Dashboard Tidy — Design Spec

**Date:** 2026-04-21
**Author:** Darshan Parmar (w/ Claude)
**Status:** Draft — pending spec review + user approval
**Scope:** 2 (frontend reshape + surgical backend cleanup; typed config schema deferred)

---

## 1. Problem

The Radar dashboard at `radar.simpleinc.cloud` ships 18 pages across a flat nav. Audit (2026-04-21) found:

- 11 operational pages at the top level, 6 "Settings" pages in a submenu, no grouping by user workflow.
- Two ICP scoring systems in parallel — v1 (`IcpRule` model + `IcpRules.jsx` page + `Lead.icpPriority` string) and v2 (`Offer` + `IcpProfile` + `Lead.icpBreakdown` 0–100). v1 was supposed to be retired; wasn't.
- `EngineRunner.jsx` (run-now) and `EngineConfig.jsx` (knobs) are separate pages — you can't run and tune an engine from one view.
- 6 settings pages each re-implement load / save / error UX with no shared component.
- ~6 engine-critical settings live only in `.env` or hardcoded in engine files (`SPAM_WORDS`, `MIN/MAX_EMAIL_WORDS`, send holidays in `sendEmails.js:15-22`, MSME/SME size prompts in `findLeads.js:74-78`). Cannot be changed without a code deploy.
- 6 settings routes return 3 different response envelope shapes (`{key: value}`, `{items: [...]}`, `{offer: {...}}`).

Primary user (today): Darshan, solo operator. Secondary user (~1 month out per roadmap): non-technical tenants in a productized multi-tenant build-out. The design must serve both without painting into a corner.

## 2. Goals / Non-goals

**Goals**

- Reduce sidebar from 17 clickable items + legacy items to ~13 items in 4 workflow-based groups.
- One "Engines" page replaces EngineRunner + EngineConfig; exposes `Guardrails` tab for settings previously locked in `.env`/code.
- Kill ICP v1. One ICP system going forward (v2: Offer + IcpProfile + `icpBreakdown`).
- Standardize response envelopes on the 6 settings routes we touch. Operational routes untouched.
- Add plain-English tooltips (via `ⓘ` glyph) on technical terms. Tech labels stay primary; hover reveals human-readable explanation.
- Ship as 6 independently reviewable PRs, each leaving `main` in a working, deployable state.

**Non-goals (Scope 3, deferred to later)**

- Replacing the 23-key `config` KV table with a typed Prisma model.
- Adding Zod validation on frontend forms.
- Rewriting operational route shapes (`/api/leads`, `/api/send-log`, `/api/replies`, etc.).
- Changing any engine logic or pipeline semantics. This is presentation + config-source cleanup only.
- Introducing TypeScript. Project stays ESM JavaScript for now.
- Switching the copy strategy to inline helper text everywhere. We keep tooltips-only (Option A) for launch; high-jargon panels (Email Health, ICP Profile) may get inline helper text in a later pass when tenants onboard.

## 3. Target navigation structure

Four workflow-based sections in the sidebar. Plain-English group labels. Tech terms kept as page labels (visible, not hidden) with tooltips for definitions.

| Section | Page (frontend file) | Source page(s) it replaces | Change |
|---|---|---|---|
| **Home** | Today (`Today.jsx`) | `Overview.jsx` + top-of-page reply tile pulled from `ReplyFeed.jsx` | New file. Merges overview KPIs with a reply-action tile so first click answers "what needs me now?" |
| **Outreach** | Engines (`Engines.jsx`) | `EngineRunner.jsx` + `EngineConfig.jsx` | **New file**, master/detail layout, 4 tabs (Status / Config / Guardrails / History) |
| **Outreach** | Leads (`Leads.jsx`) | `LeadPipeline.jsx` | Rename + route update |
| **Outreach** | Sent Emails (`SentEmails.jsx`) | `SendLog.jsx` | Rename + route update |
| **Outreach** | Follow-ups (`Followups.jsx`) | `SequenceTracker.jsx` | Rename + route update |
| **Outreach** | Replies (`Replies.jsx`) | `ReplyFeed.jsx` | Rename + route update (minus the action tile that moved to Today) |
| **Outreach** | Funnel (`Funnel.jsx`) | `FunnelAnalytics.jsx` | Rename + route update |
| **Setup** | Niches & Schedule (`Niches.jsx`) | `NicheManager.jsx` | Rename + adopt SettingsPage skeleton |
| **Setup** | Offer & ICP (`OfferAndIcp.jsx`) | `Offer.jsx` + `IcpProfile.jsx` | **New file**, two tabs inside (Offer · ICP Profile). Shared skeleton. |
| **Setup** | Email Voice (`EmailVoice.jsx`) | `EmailPersona.jsx` | Rename + adopt SettingsPage skeleton |
| **System** | Spend (`Spend.jsx`) | `CostTracker.jsx` | Rename + route update |
| **System** | Email Health (`EmailHealth.jsx`) | `HealthMonitor.jsx` | Rename + route update |
| **System** | Errors (`Errors.jsx`) | `ErrorLog.jsx` | Rename + route update |
| **System** | Schedule & Logs (`ScheduleLogs.jsx`) | `CronStatus.jsx` | Rename + route update |

**Removed:** `IcpRules.jsx` page, `/api/icp-rules` route, `IcpRule` Prisma model, `Lead.icpPriority` field.

**Final page count:** 13 user-visible pages + Login (unchanged).

**Routing:** Paths move under section prefixes — `/outreach/engines`, `/setup/niches`, `/system/email-health`, etc. — so the URL reflects the new mental model. Old URLs 301-redirect to new ones via a single redirect map in `App.jsx`.

## 4. The new Engines page

Replaces two pages with one master/detail view.

### 4.1 Master list (left column, 260px)

One row per engine in this order: `findLeads`, `sendEmails`, `checkReplies`, `sendFollowups`, `healthCheck`, `dailyReport`. Each row shows:

- Engine name (tech identifier, left as-is — devs grep for it)
- `ⓘ` tooltip with a plain-English description (e.g., "Discovers lead candidates from search + enrichment")
- Live status line: `🟢 on · <last run time> · <primary outcome counter>` (green/yellow/red dot driven by latest `CronLog` status)

Data source: `GET /api/engines` — a new aggregate endpoint that returns `{ items: [{ name, enabled, lastRun: { status, startedAt, durationMs, primaryCount }, schedule, costToday }, ...] }`. This replaces the frontend's current pattern of calling 6 separate `engineStatus()` / `engineStats()` / `engineLatest()` endpoints.

### 4.2 Detail pane (right column)

Header strip: engine name (large), one-line description, "Run now" primary button, "Enabled" toggle (PATCHes `<engine_name>_enabled` config key).

Below the header, four tabs. **Not every engine shows every tab** — the tab list is derived per-engine:

| Tab | Visible on | Content |
|---|---|---|
| **Status** | all 6 | Three cards: Last run (status, duration), Primary output count, Cost today. Pipeline breakdown for findLeads (11-stage funnel with per-stage counts). |
| **Config** | findLeads, sendEmails, checkReplies, sendFollowups, dailyReport | Editable form bound to `/api/config` subset. Fields per engine listed in §4.3. |
| **Guardrails** | findLeads, sendEmails | Editable form bound to `/api/engines/:name/guardrails`. Fields per engine listed in §5.2. |
| **History** | all 6 | Recent `CronLog` rows for this engine — status, started_at, duration, output size. Click row → drill into `ErrorLog` if failed. |

Tab selection is in URL hash (`#config`, `#guardrails`) so deep links work.

### 4.3 Config fields per engine

Read/write via existing `/api/config` (flat KV). Documented here to scope the form:

- **findLeads:** `find_leads_enabled` (bool), `find_leads_cities` (JSON array), `find_leads_business_size` (enum: msme/sme/enterprise), `find_leads_count` (int), `find_leads_per_batch` (int), `icp_threshold_a` (int), `icp_threshold_b` (int), `icp_weights` (JSON; existing validator stays)
- **sendEmails:** `send_emails_enabled`, `daily_send_limit`, `max_per_inbox`, `send_delay_min_ms`, `send_delay_max_ms`, `send_window_start`, `send_window_end`, `bounce_rate_hard_stop`, `claude_daily_spend_cap`
- **checkReplies:** `check_replies_enabled` (and a new `check_replies_interval_minutes` currently hardcoded in `cron.js`)
- **sendFollowups:** `send_followups_enabled`
- **dailyReport:** `daily_report_enabled`, `daily_report_channels` (JSON array: `telegram` | `email`)

`healthCheck` has no config tab; it runs weekly with no tunables.

## 5. Backend changes

### 5.1 Delete ICP v1

One Prisma migration + code removal:

- Drop model `IcpRule` and its table.
- Drop column `Lead.icpPriority` (string). Any leads in status-flow that currently branch on `icpPriority` route through `icpBreakdown` + the existing `nurture` lead status instead.
- Delete files: `src/api/routes/icpRules.js`, `web/src/pages/IcpRules.jsx`, and the mount line in `src/api/server.js`.
- Delete api methods in `web/src/api.js`: `getIcpRules`, `updateIcpRules`.
- `findLeads.js`: remove the branch that writes `icpPriority`; keep the branch that sets `status='nurture'` for ICP-C leads.

No data migration needed: the old rules table is config, not transactional data.

### 5.2 Orphan settings → DB

New keys added to `seedConfigDefaults()` in `src/core/db/index.js`. All values stored stringified in the existing `config` KV table.

| Key | Value type | Today's source | Consumer |
|---|---|---|---|
| `spam_words` | JSON array of strings | `.env` `SPAM_WORDS` | `src/core/email/contentValidator.js` |
| `email_min_words` | integer | `.env` `MIN_EMAIL_WORDS` | `contentValidator.js` |
| `email_max_words` | integer | `.env` `MAX_EMAIL_WORDS` | `contentValidator.js` |
| `send_holidays` | JSON array of `YYYY-MM-DD` strings | hardcoded `sendEmails.js:15-22` | `sendEmails.js` |
| `findleads_size_prompts` | JSON object `{ msme, sme, enterprise }` | hardcoded `findLeads.js:74-78` | `findLeads.js` |

**Rollout safety belt:** for one release cycle, each consumer reads from `getConfigMap()` first and falls back to `.env`/hardcoded if the config key is missing or unparseable. The fallback is stripped in a follow-up PR after the dashboard is confirmed writing these keys.

**New route:** `GET /api/engines/:engineName/guardrails` returns the subset of keys relevant to that engine. `PUT` validates (e.g., `send_holidays` entries must parse as dates; `spam_words` must be non-empty array of strings; `email_min_words < email_max_words`) and writes via the same config update path. 400 on validation failure with `{ error, field }` shape.

### 5.3 API envelope standardization

Applies only to routes we touch:

- Collections → `{ items: [...] }`. `/api/niches` GET updated from `{ niches: [...] }`. Frontend `api.js` updated.
- Singletons → flat object. `/api/offer` GET changes from `{ offer: {...} }` to the offer fields at top level; `/api/icp-profile` same.
- Mutations → `{ ok: true, data: <updated record> }`. Replaces ad-hoc `{ ok: true }` / `{ ok: true, id }` shapes.
- Errors → `{ error: <message>, field?: <name> }`.

Operational routes (`/api/leads`, `/api/send-log`, `/api/replies`, `/api/sequences`, `/api/cron-status`, `/api/health`, `/api/costs`, `/api/errors`, `/api/funnel`, `/api/run-engine`, `/api/overview`) are not touched. Their current shapes stay.

## 6. Frontend shared components

Three new components, all in `web/src/components/`:

### 6.1 `<SettingsPage>`

Shared skeleton for Niches, Offer & ICP, Email Voice. Props: `title`, `description`, `onSave`, `onReset`, `dirty`, `saving`, `lastSavedAt`. Children render the form body. Skeleton provides: sticky header (title + description + `ⓘ` tooltip), scrollable body, footer bar (Save · Reset · "Last saved Xm ago"). Form dirty-state handled at this layer; children don't reimplement.

### 6.2 `<TechTerm>`

Wraps a technical term with an inline `ⓘ` icon. Reads the definition from a central `web/src/content/glossary.js` dictionary — one source of truth for every explanation. Usage:

```jsx
<TechTerm id="bounceRate">bounce rate</TechTerm>
```

Keyed by id (not the term text) so we can rephrase labels without breaking the glossary. Glossary entries include a short (<12 word) definition and a "learn more" anchor for a future docs page. Tooltip is hover-on-desktop, tap-on-mobile.

Initial glossary set (drafted by the brainstorm; final wording locked in PR 6): bounce rate, spam rate, DMARC, SPF, DKIM, ICP, warmup, IMAP, grounding, MEV, RBL zone, cron, throttle, deliverability.

### 6.3 `<EngineStatusPill>`

One row of the engine master list. Props: `name`, `enabled`, `lastRun`, `primaryCount`, `selected`, `onSelect`. Pure presentation; no API calls. Used on the Engines master list and potentially on the Today page if we want an "engine heartbeat" strip.

## 7. Copy strategy

**Approach A — tooltips only** (picked by user, 2026-04-21). Technical labels stay as primary text; each technical term wraps in `<TechTerm>` showing `ⓘ`. Hover reveals the plain-English explanation from the glossary.

**Where tooltips are applied:**

- All section names in sidebar (tooltip explains what's under each group for first-time users)
- Every metric label on Today, Engines Status tab, Spend, Email Health
- Every config field label across Engines, Niches, Offer & ICP, Email Voice
- Acronyms and jargon in body text (DMARC, SPF, IMAP, ICP, RBL zones, etc.)

**Where tooltips are NOT applied:** data values (numbers, dates, lead names). Labels only.

**Glossary entries are short** — under 12 words, written as a statement not a sentence. Example: `bounceRate: "Emails that couldn't be delivered. Keep under 2% or sending auto-pauses."` (Two short statements fit; a paragraph does not.)

**Tenant upgrade path:** if/when non-technical tenants onboard and tooltip density isn't enough, a follow-up adds a header-level "Show explanations" toggle that expands to style C (inline helper text under stats). Glossary content is reused. Not in this spec.

## 8. Build sequence

Six PRs, each independently mergeable and deployable. Branch from `main` sequentially.

### PR 1 — Delete ICP v1 (backend + frontend, small)

- Prisma migration dropping `IcpRule` table and `Lead.icpPriority` column.
- Remove `src/api/routes/icpRules.js`, mount line in `server.js`, `web/src/pages/IcpRules.jsx`, `web/src/api.js` methods (`getIcpRules`, `updateIcpRules`), nav entry.
- Update `src/engines/findLeads.js` to stop writing `icpPriority`; add unit test confirming ICP-C leads land in `status='nurture'`.
- Run existing test suite — fix any `icpPriority` references in tests.

**Success:** tests pass, `findLeads.js` runs end-to-end on staging against VPS DB with no ICP v1 references remaining.

### PR 2 — Orphan settings → config table (backend only)

- Add 5 new keys to `seedConfigDefaults()` with defaults taken from current `.env`/hardcoded values.
- `contentValidator.js`, `sendEmails.js`, `findLeads.js` read from `getConfigMap()`; if missing/invalid, fall back to current `.env`/hardcoded source.
- New route `src/api/routes/engineGuardrails.js` — `GET`/`PUT /api/engines/:engineName/guardrails`. Validation: `send_holidays` parses as ISO dates; `spam_words` non-empty string array; `email_min_words < email_max_words`.
- Add unit tests for validator, and for each consumer reading from config first.

**Success:** engines still run as before on staging; `GET /api/engines/sendEmails/guardrails` returns the expected shape; PUT updates are reflected on the next engine run.

### PR 3 — 4-section nav + page renames (frontend only)

- Rewrite `web/src/components/Sidebar.jsx` with 4 groups and 13 entries per §3.
- Move page files to new filenames (git mv to preserve history).
- Update routes in `web/src/App.jsx` and add redirect map from old paths.
- No page internals change — just the shell.

**Success:** clicking every sidebar entry lands on the correct page; old URLs 301-redirect; no component logic changes.

### PR 4 — Unified Engines page

- Delete `EngineRunner.jsx` and `EngineConfig.jsx`; add `Engines.jsx` with master/detail layout per §4.
- New aggregate endpoint `GET /api/engines` consolidating the per-engine status/latest/stats calls.
- Guardrails tab wires to the route added in PR 2.
- Add `<EngineStatusPill>` component; reuse in master list.
- After PR 4 lands on staging and config reads from DB confirm working, open a follow-up PR stripping the `.env`/hardcoded fallbacks from PR 2.

**Success:** run-now button triggers an engine and the Status tab updates in <5s; Config edits persist; Guardrails edits take effect on next engine run.

### PR 5 — Setup skeleton + Offer & ICP merge

- Add `<SettingsPage>` component per §6.1.
- Refactor `Niches.jsx` and `EmailVoice.jsx` to use it.
- Delete `Offer.jsx` + `IcpProfile.jsx`; add `OfferAndIcp.jsx` with two internal tabs. Reuse `<SettingsPage>` at the top level.
- Standardize API envelope on `/api/niches`, `/api/offer`, `/api/icp-profile` per §5.3; update frontend callers.

**Success:** all 3 setup pages have consistent header/body/footer; dirty-state, save, reset behave identically; merged Offer & ICP page round-trips both singletons correctly.

### PR 6 — Today page + tooltip glossary

- Add `web/src/content/glossary.js` with the initial entries listed in §6.2.
- Add `<TechTerm>` component.
- Apply `<TechTerm>` wraps across Today, Engines (Status tab), Spend, Email Health, and all Setup page field labels.
- New `Today.jsx` merging Overview KPIs + an inline reply-action tile (the latter is a trimmed embed of the Replies page, filtered to `needs_action`).

**Success:** hovering `ⓘ` shows a short definition from the glossary; Today renders KPIs and up to 5 unactioned replies; tab-order and keyboard nav work.

## 9. Testing

- **Backend:** vitest for each new/changed route. Existing engine tests stay green; add tests for config-fallback behavior and guardrail validation.
- **Frontend:** no test framework exists today. Out of scope to add one; smoke-test manually in the browser against the VPS DB (via SSH tunnel) after each PR.
- **Regression checkpoints after each PR:**
  - Run `findLeads` end-to-end (gates, ICP scoring, lead write)
  - Run `sendEmails` dry-run (content validator, send window, bounce check)
  - Run `checkReplies` against a seeded inbox
- **VPS deploy checkpoint** after PR 4 and PR 6. PM2 restart; tail logs for 10 minutes; confirm cron schedule still resolves.

## 10. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Dropping `Lead.icpPriority` breaks a query we haven't found | Grep for `icpPriority` pre-migration; add `nurture` status coverage tests; run PR 1 on staging for 48h before PR 2 starts. |
| Config fallbacks silently mask a broken migration (engine reads `.env` forever) | Server startup log emits a warning listing any key still falling back to `.env`. Strip fallbacks in a follow-up PR only once that warning has been silent for 7 days. |
| API envelope change breaks frontend pages we haven't updated | Change frontend and backend in the same PR; don't ship backend envelope changes ahead of the frontend callers. |
| URL redirects miss bookmarked paths | Redirect map covers all 17 previous top-level routes; log 404s for the first week and patch any missed. |
| Tenant onboarding reveals tooltips-only is insufficient | Glossary content is already written as full sentences; switching to inline helper text (style C) is a one-component change. Deferred, not blocked. |

## 11. Out of scope (deferred)

- Typed `config` schema (Prisma model per setting with real types + defaults).
- Zod frontend validation.
- Operational route envelope normalization.
- TypeScript migration.
- "Show explanations" header toggle for inline helper text.
- Global search across leads/replies/errors.
- Mobile/PWA polish (on Phase 1.5 roadmap, separate effort).

## 12. Open questions

None blocking. Carried forward into plan:

- Exact wording for the 14 initial glossary entries — I'll draft in PR 6 and ask for review before merge.
- Whether "Run now" should accept a scoped override (e.g., run findLeads for only one niche) — current EngineRunner supports overrides via `RunConfig.jsx`. Keep the override UI on the Status tab for PR 4. If it ends up unused, strip in a follow-up.
