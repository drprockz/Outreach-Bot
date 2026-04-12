# Settings Pages — Design Spec
**Date:** 2026-04-12
**Project:** Radar by Simple Inc
**Status:** Approved

---

## 1. Overview

Add a Settings section to the Radar dashboard with four sub-pages:

| Route | Page | Purpose |
|---|---|---|
| `/settings/niches` | Niche Manager | Full CRUD for weekly lead discovery niches |
| `/settings/engines` | Engine Config | Per-engine on/off toggles and tunable parameters |
| `/settings/icp` | ICP Rubric | Add/edit/reorder/delete ICP scoring rules + priority thresholds |
| `/settings/persona` | Email Persona | Sender identity fields injected into Claude prompts |

All config is stored in SQLite. Engines read from DB on each run — no `.env` edits or PM2 restarts needed.

---

## 2. Database Schema

### 2.1 `config` table
Key/value store for engine parameters and persona fields.

```sql
CREATE TABLE config (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**Seed rows (inserted at server startup if missing):**

| key | default value |
|---|---|
| `daily_send_limit` | `0` |
| `max_per_inbox` | `17` |
| `send_delay_min_ms` | `180000` |
| `send_delay_max_ms` | `420000` |
| `send_window_start` | `9` |
| `send_window_end` | `17` |
| `bounce_rate_hard_stop` | `0.02` |
| `claude_daily_spend_cap` | `3.00` |
| `find_leads_enabled` | `1` |
| `send_emails_enabled` | `1` |
| `send_followups_enabled` | `1` |
| `check_replies_enabled` | `1` |
| `icp_threshold_a` | `7` |
| `icp_threshold_b` | `4` |
| `persona_name` | `Darshan Parmar` |
| `persona_role` | `Full-Stack Developer` |
| `persona_company` | `Simple Inc` |
| `persona_website` | `simpleinc.in` |
| `persona_tone` | `professional but direct` |
| `persona_services` | `Full-stack web development, redesigns, performance optimisation, custom React apps, API integrations` |

### 2.2 `niches` table
Replaces the hardcoded `NICHES` object in `findLeads.js`.

```sql
CREATE TABLE niches (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  label       TEXT NOT NULL,
  query       TEXT NOT NULL,
  day_of_week INTEGER,  -- 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat, NULL=unassigned
  enabled     INTEGER DEFAULT 1,
  sort_order  INTEGER DEFAULT 0,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**Seed rows (current hardcoded values migrated):**

| day_of_week | label | query |
|---|---|---|
| 1 | Shopify/D2C brands | India D2C ecommerce brand Shopify outdated website |
| 2 | Real estate agencies | Mumbai real estate agency property portal outdated website |
| 3 | Funded startups | India funded B2B startup outdated website developer needed |
| 4 | Restaurants/cafes | Mumbai restaurant cafe outdated website no online booking |
| 5 | Agencies/consultancies | Mumbai digital agency overflow web development outsource |
| 6 | Healthcare/salons | India healthcare salon clinic outdated website no booking |

### 2.3 `icp_rules` table
Replaces the hardcoded rubric string in `stage9_icpScore` prompt.

```sql
CREATE TABLE icp_rules (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  label       TEXT NOT NULL,
  points      INTEGER NOT NULL,  -- range: -3 to +3, 0 excluded
  description TEXT,
  enabled     INTEGER DEFAULT 1,
  sort_order  INTEGER DEFAULT 0
);
```

**Seed rows (current hardcoded rubric migrated):**

| points | label |
|---|---|
| +3 | India-based B2C-facing (restaurant, salon, real estate, D2C) |
| +2 | 20+ Google reviews (established business, has budget) |
| +2 | WordPress/Wix/Squarespace stack (easiest sell) |
| +2 | Website last updated 2+ years ago |
| +1 | Active Instagram/Facebook but neglected website |
| +1 | WhatsApp Business on site but no online booking/ordering |
| -2 | Freelancer or solo consultant (low budget) |
| -3 | Already on modern stack (Next.js, custom React, Webflow) |

---

## 3. Backend API

Six new endpoints in `dashboard/server.js`:

```
GET  /api/config              — returns all config rows as { key: value } object
PUT  /api/config              — accepts { key: value, ... } object, upserts all rows

GET  /api/niches              — returns all niches ordered by sort_order
POST /api/niches              — creates a niche, returns created row
PUT  /api/niches/:id          — updates label/query/day_of_week/enabled/sort_order
DELETE /api/niches/:id        — deletes niche (leads already found are unaffected)

GET  /api/icp-rules           — returns all rules ordered by sort_order
PUT  /api/icp-rules           — bulk-replaces entire icp_rules table with provided array
```

All endpoints require `authMiddleware`.

**Seed function** `seedConfigDefaults()` called at server startup: inserts each default config key using `INSERT OR IGNORE` so existing customised values are never overwritten.

---

## 4. Engine Changes

### 4.1 New helper in `utils/db.js`

```js
export function getConfigMap() {
  const rows = getDb().prepare('SELECT key, value FROM config').all();
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}
```

### 4.2 `findLeads.js`
- Remove hardcoded `NICHES` object and `getNicheForToday()` function
- Replace with: `SELECT * FROM niches WHERE day_of_week = ? AND enabled = 1 LIMIT 1` for today's DOW; fallback to `SELECT * FROM niches WHERE enabled = 1 ORDER BY sort_order LIMIT 1` if no match
- `stage9_icpScore`: build rubric string from `SELECT * FROM icp_rules WHERE enabled = 1 ORDER BY sort_order`; read thresholds from config (`icp_threshold_a`, `icp_threshold_b`)
- `stage10_hook` and `stage11_body`: read persona fields from `getConfigMap()`; inject `persona_name`, `persona_role`, `persona_company`, `persona_services`, `persona_tone` into prompts
- Read `find_leads_enabled` from config at startup; exit early with `skipped` status if `0`

### 4.3 `sendEmails.js`
- Replace all `process.env.DAILY_SEND_LIMIT`, `process.env.MAX_PER_INBOX`, `process.env.SEND_DELAY_MIN_MS`, `process.env.SEND_DELAY_MAX_MS`, `process.env.SEND_WINDOW_START_IST`, `process.env.SEND_WINDOW_END_IST`, `process.env.BOUNCE_RATE_HARD_STOP` reads with `getConfigMap()` equivalents
- Read `send_emails_enabled` at startup; exit early if `0`
- `.env` values remain as fallback only if `config` table row is missing

### 4.4 `sendFollowups.js`
- Read `send_followups_enabled` at startup; exit early if `0`

### 4.5 `checkReplies.js`
- Read `check_replies_enabled` at startup; exit early if `0`

---

## 5. Frontend

### 5.1 Navigation changes (`Sidebar.jsx`)
Add collapsible Settings group at the bottom of the nav, above the Logout button:

```
⚙  Settings           ← toggles group open/closed
   ├─ Niches
   ├─ Engines
   ├─ ICP Rubric
   └─ Persona
```

Group stays expanded while any `/settings/*` route is active.

### 5.2 New routes (`App.jsx`)
```jsx
<Route path="/settings" element={<Navigate to="/settings/niches" replace />} />
<Route path="/settings/niches"  element={<NicheManager />} />
<Route path="/settings/engines" element={<EngineConfig />} />
<Route path="/settings/icp"     element={<IcpRules />} />
<Route path="/settings/persona" element={<EmailPersona />} />
```

All protected under existing `ProtectedLayout`.

### 5.3 New page files
```
dashboard/src/pages/NicheManager.jsx
dashboard/src/pages/EngineConfig.jsx
dashboard/src/pages/IcpRules.jsx
dashboard/src/pages/EmailPersona.jsx
```

---

## 6. Page Designs

### 6.1 NicheManager (`/settings/niches`)

**Weekly schedule grid** (top section)
- 6 columns, one per weekday Mon–Sat
- Each column: day label, niche label, truncated query preview, enabled/disabled badge
- Empty day: "+ Assign" placeholder
- Click column → opens edit modal pre-filled for that niche

**Niche pool table** (below grid)
Columns: Label | Query preview | Day | Enabled | Edit | Delete

- Enabled column: inline toggle (writes immediately via PUT)
- Edit: opens modal
- Delete: inline confirmation text before DELETE call

**Add/Edit modal fields:**
- Label (text, required)
- Search query (textarea, required, min 10 chars)
- Assign to day (dropdown: Mon/Tue/Wed/Thu/Fri/Sat/Unassigned)
- Enabled (toggle)

**Conflict warning:** if selected day already has a niche, show: "Monday already has [label] — it will become Unassigned."

**`+ Add Niche` button** top-right of the pool table.

### 6.2 EngineConfig (`/settings/engines`)

2×2 grid of engine cards.

**Each card contains:**
- Engine name + ON/OFF toggle (top row)
- Scheduled time label (read-only, informational)
- Editable numeric fields relevant to that engine
- "Save Changes" button (saves only that card's fields)
- Inline "Saved ✓" confirmation on success

**sendEmails card extra:** yellow inline warning if `send_emails_enabled=1` but `daily_send_limit=0`.

**Fields per engine:**

| Engine | Editable fields |
|---|---|
| findLeads | batches_per_run, leads_per_batch |
| sendEmails | daily_send_limit, max_per_inbox, send_delay_min_ms, send_delay_max_ms, send_window_start, send_window_end, bounce_rate_hard_stop |
| sendFollowups | (none beyond toggle) |
| checkReplies | (none beyond toggle) |

### 6.3 IcpRules (`/settings/icp`)

**Rules list** — drag-reorderable rows:
- Drag handle (⠿)
- Points dropdown (-3/-2/-1/+1/+2/+3), colour-coded green/red
- Label (inline editable on click)
- Description (inline editable textarea on click)
- Enabled toggle
- Delete button

**Priority thresholds panel** (below list):
```
A priority   score ≥ [7]
B priority   score ≥ [4]
C priority   score <  4   (auto-calculated, read-only)
```

**"+ Add Rule" button** appends a new blank row at the bottom.

**"Save All Rules" button** — single PUT `/api/icp-rules` with full ordered array. Thresholds saved via PUT `/api/config`.

### 6.4 EmailPersona (`/settings/persona`)

Single form with fields:
- Name (text input)
- Role (text input)
- Company (text input)
- Website (text input)
- Tone (select: "professional but direct" / "casual and friendly" / "formal and corporate" / "custom")
- Custom tone (text input, shown only when tone = "custom")
- Services offered (textarea, ~4 rows)

Single "Save Persona" button → PUT `/api/config` with all persona keys.

Inline "Saved ✓" confirmation on success.

---

## 7. Build Sequence

1. Add `config`, `niches`, `icp_rules` tables to `db/schema.sql`
2. Add `getConfigMap()` to `utils/db.js`
3. Add `seedConfigDefaults()` + all 6 API endpoints to `dashboard/server.js`
4. Update `findLeads.js` — niche from DB, ICP rubric from DB, persona from config, enabled check
5. Update `sendEmails.js` — all env reads → config, enabled check
6. Update `sendFollowups.js` + `checkReplies.js` — enabled checks
7. Build `NicheManager.jsx`
8. Build `EngineConfig.jsx`
9. Build `IcpRules.jsx`
10. Build `EmailPersona.jsx`
11. Update `Sidebar.jsx` — collapsible Settings group
12. Update `App.jsx` — 4 new routes + redirect
13. Add Settings API calls to `dashboard/src/api.js`

---

## 8. Out of Scope

- Drag-and-drop reordering for niches (sort_order set via day assignment only)
- US timezone send window (Phase 2 per roadmap)
- Per-niche city targeting (single config value for now)
- Undo/history for config changes
