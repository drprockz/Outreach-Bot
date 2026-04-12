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
Key/value store for engine parameters and persona fields. All values stored as TEXT; engines parse to numeric types at the call site.

```sql
CREATE TABLE config (
  key        TEXT PRIMARY KEY,
  value      TEXT
);
```

No `updated_at` column — values are write-through with no audit requirement at this stage.

**Seed rows** — inserted via `INSERT OR IGNORE` at server startup so existing customised values are never overwritten. `getConfigMap()` must gracefully return `{}` if the table doesn't exist (protects rolling deploys where the schema migration hasn't run yet on the cron process).

| key | default value | type |
|---|---|---|
| `daily_send_limit` | `0` | int |
| `max_per_inbox` | `17` | int |
| `send_delay_min_ms` | `180000` | int |
| `send_delay_max_ms` | `420000` | int |
| `send_window_start` | `9` | int |
| `send_window_end` | `17` | int |
| `bounce_rate_hard_stop` | `0.02` | float |
| `claude_daily_spend_cap` | `3.00` | float |
| `find_leads_enabled` | `1` | int |
| `send_emails_enabled` | `1` | int |
| `send_followups_enabled` | `1` | int |
| `check_replies_enabled` | `1` | int |
| `icp_threshold_a` | `7` | int |
| `icp_threshold_b` | `4` | int |
| `find_leads_batches` | `5` | int |
| `find_leads_per_batch` | `30` | int |
| `persona_name` | `Darshan Parmar` | string |
| `persona_role` | `Full-Stack Developer` | string |
| `persona_company` | `Simple Inc` | string |
| `persona_website` | `simpleinc.in` | string |
| `persona_tone` | `professional but direct` | string |
| `persona_services` | `Full-stack web development, redesigns, performance optimisation, custom React apps, API integrations` | string |

**Note:** `claude_daily_spend_cap` is stored in config for display on the Engines page and future enforcement. Enforcement (hard-stopping Claude calls when spend exceeds the cap) is Phase 2 — not implemented in this spec.

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

**Seed rows** — current hardcoded values migrated via `INSERT OR IGNORE`:

| day_of_week | label | query |
|---|---|---|
| 1 | Shopify/D2C brands | India D2C ecommerce brand Shopify outdated website |
| 2 | Real estate agencies | Mumbai real estate agency property portal outdated website |
| 3 | Funded startups | India funded B2B startup outdated website developer needed |
| 4 | Restaurants/cafes | Mumbai restaurant cafe outdated website no online booking |
| 5 | Agencies/consultancies | Mumbai digital agency overflow web development outsource |
| 6 | Healthcare/salons | India healthcare salon clinic outdated website no booking |

### 2.3 `icp_rules` table
Replaces the hardcoded rubric string in `stage9_icpScore`.

```sql
CREATE TABLE icp_rules (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  label       TEXT NOT NULL,
  points      INTEGER NOT NULL,  -- -3, -2, -1, +1, +2, or +3 (0 is not valid)
  description TEXT,
  enabled     INTEGER DEFAULT 1,
  sort_order  INTEGER DEFAULT 0
);
```

**Seed rows** — current hardcoded rubric migrated:

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

**ICP score range note:** Rubric deductions can produce negative scores. `icp_threshold_a` and `icp_threshold_b` define the A/B floor. Anything below `icp_threshold_b` is C, including negative values — no special handling needed.

---

## 3. Backend API

All new routes must be registered **after** the `app.use('/api', authMiddleware)` line in `server.js` (currently line 51) to inherit the blanket auth middleware. Do not add routes above it.

### Endpoint list

```
GET  /api/config              — returns all config rows as { key: value } flat object
PUT  /api/config              — partial upsert: accepts { key: value, ... }, only updates provided keys
                                uses INSERT OR REPLACE per key — never wipes unrelated keys

GET  /api/niches              — returns all niches ordered by sort_order, then id
POST /api/niches              — creates a niche; returns created row; if day_of_week is set,
                                atomically clears that day from any existing niche first (see §3.1)
PUT  /api/niches/:id          — updates label/query/day_of_week/enabled/sort_order;
                                if day_of_week changes, atomically clears it from any conflicting
                                niche first (see §3.1)
DELETE /api/niches/:id        — deletes niche; leads already discovered are unaffected

GET  /api/icp-rules           — returns all rules ordered by sort_order, then id
PUT  /api/icp-rules           — bulk-replace (see §3.2)
```

### 3.1 Niche day-assignment conflict resolution (server-side, atomic)

When `POST /api/niches` or `PUT /api/niches/:id` includes a non-null `day_of_week`, the server must clear that day from any other niche atomically in a single SQLite transaction:

```js
const stmt = db.transaction((id, day, fields) => {
  if (day !== null) {
    db.prepare(`UPDATE niches SET day_of_week = NULL WHERE day_of_week = ? AND id != ?`).run(day, id);
  }
  db.prepare(`UPDATE niches SET label=?, query=?, day_of_week=?, enabled=?, sort_order=? WHERE id=?`)
    .run(fields.label, fields.query, day, fields.enabled, fields.sort_order, id);
});
stmt(id, day_of_week, fields);
```

This prevents two niches sharing the same day and avoids partial-failure race conditions from two sequential client-side PUTs.

### 3.2 `PUT /api/icp-rules` — bulk-replace

Accepts an array of rule objects. Runs inside an explicit SQLite transaction — if any step fails the entire replace is rolled back, preventing an empty `icp_rules` table (which would cause all leads to score 0 and get C-priority):

**Request body:**
```json
[
  { "id": 1, "label": "India-based B2C-facing", "points": 3, "description": "...", "enabled": 1, "sort_order": 0 },
  { "id": null, "label": "New rule", "points": -1, "description": "...", "enabled": 1, "sort_order": 8 }
]
```

- `id: null` means a new rule (INSERT); numeric `id` means update existing (DELETE + re-INSERT at correct sort_order)
- Server re-sequences `sort_order` from array index (0, 1, 2…) ignoring client-provided value
- Server uses `better-sqlite3`'s `db.transaction()` wrapper for atomicity:
```js
const replaceFn = db.transaction((rules) => {
  db.prepare('DELETE FROM icp_rules').run();
  rules.forEach((r, i) => {
    db.prepare(`INSERT INTO icp_rules (label, points, description, enabled, sort_order)
                VALUES (?, ?, ?, ?, ?)`).run(r.label, r.points, r.description ?? null, r.enabled ?? 1, i);
  });
});
replaceFn(rulesArray); // rolls back automatically on any thrown error
```

---

## 4. Engine Changes

### 4.1 New helpers in `utils/db.js`

```js
// Returns all config key/value pairs as a flat object.
// Returns {} (empty) if the config table doesn't exist yet — protects rolling deploys.
export function getConfigMap() {
  try {
    const rows = getDb().prepare('SELECT key, value FROM config').all();
    return Object.fromEntries(rows.map(r => [r.key, r.value]));
  } catch {
    return {};
  }
}

// Type-safe accessors — accept a pre-fetched map to avoid repeated DB reads.
// Engines should call getConfigMap() ONCE at function entry, then pass the result
// to each accessor — do not call getConfigMap() inside each accessor independently.
export function getConfigInt(cfg, key, fallback) {
  const v = parseInt(cfg[key]);
  return isNaN(v) ? fallback : v;
}

export function getConfigFloat(cfg, key, fallback) {
  const v = parseFloat(cfg[key]);
  return isNaN(v) ? fallback : v;
}

export function getConfigStr(cfg, key, fallback) {
  return cfg[key] ?? fallback;
}
```

All engines use `getConfigInt`/`getConfigFloat`/`getConfigStr` rather than `getConfigMap()` directly. This ensures correct numeric types and removes the need for `parseInt`/`parseFloat` call-sites throughout engine code.

### 4.2 `findLeads.js`

**Niche lookup** — replace hardcoded `NICHES` object and `getNicheForToday()`:
```js
function getNicheForToday(db) {
  const dow = new Date().getDay();
  return db.prepare(`SELECT * FROM niches WHERE day_of_week = ? AND enabled = 1 LIMIT 1`).get(dow)
    || db.prepare(`SELECT * FROM niches WHERE enabled = 1 ORDER BY sort_order LIMIT 1`).get();
}
```
If no enabled niche exists at all, log error and exit with `finishCron(cronId, { status: 'failed', error: 'No enabled niches configured' })`.

**Engine enabled check** — add at top of `findLeads()` after `logCron`:
```js
if (!getConfigInt('find_leads_enabled', 1)) {
  finishCron(cronId, { status: 'skipped' });
  return;
}
```

**Batches/batch size** — replace hardcoded `5` and `30`:
```js
const batches = getConfigInt('find_leads_batches', 5);
const perBatch = getConfigInt('find_leads_per_batch', 30);
```

**ICP rubric** — `stage9_icpScore` builds rubric dynamically:
```js
function buildIcpRubric(db) {
  const rules = db.prepare(`SELECT * FROM icp_rules WHERE enabled = 1 ORDER BY sort_order`).all();
  return rules.map(r => `${r.points > 0 ? '+' : ''}${r.points}  ${r.label}`).join('\n');
}
```
Priority thresholds read from config:
```js
const threshA = getConfigInt('icp_threshold_a', 7);
const threshB = getConfigInt('icp_threshold_b', 4);
const priorityLabel = score >= threshA ? 'A' : score >= threshB ? 'B' : 'C';
```

**Persona** — `stage10_hook` and `stage11_body` read:
```js
const persona = {
  name:     getConfigStr('persona_name',     'Darshan Parmar'),
  role:     getConfigStr('persona_role',     'Full-Stack Developer'),
  company:  getConfigStr('persona_company',  'Simple Inc'),
  tone:     getConfigStr('persona_tone',     'professional but direct'),
  services: getConfigStr('persona_services', '')
};
```

### 4.3 `sendEmails.js`

Replace all `process.env.*` reads with typed config accessors. Fallback values match current `.env` defaults:

| Current env read | New accessor |
|---|---|
| `process.env.DAILY_SEND_LIMIT` | `getConfigInt('daily_send_limit', 0)` |
| `process.env.MAX_PER_INBOX` | `getConfigInt('max_per_inbox', 17)` |
| `process.env.SEND_DELAY_MIN_MS` | `getConfigInt('send_delay_min_ms', 180000)` |
| `process.env.SEND_DELAY_MAX_MS` | `getConfigInt('send_delay_max_ms', 420000)` |
| `process.env.SEND_WINDOW_START_IST` | `getConfigInt('send_window_start', 9)` |
| `process.env.SEND_WINDOW_END_IST` | `getConfigInt('send_window_end', 17)` |
| `process.env.BOUNCE_RATE_HARD_STOP` | `getConfigFloat('bounce_rate_hard_stop', 0.02)` |

Add enabled check after `logCron`:
```js
if (!getConfigInt('send_emails_enabled', 1)) {
  finishCron(cronId, { status: 'skipped' });
  return;
}
```

### 4.4 `sendFollowups.js`

Replace all `process.env.*` reads with typed config accessors (call `getConfigMap()` once at function entry):

| Current env read | New accessor |
|---|---|
| `process.env.DAILY_SEND_LIMIT` | `getConfigInt(cfg, 'daily_send_limit', 0)` |
| `process.env.SEND_DELAY_MIN_MS` | `getConfigInt(cfg, 'send_delay_min_ms', 180000)` |
| `process.env.SEND_DELAY_MAX_MS` | `getConfigInt(cfg, 'send_delay_max_ms', 420000)` |
| `process.env.SEND_WINDOW_START_IST` | `getConfigInt(cfg, 'send_window_start', 9)` |
| `process.env.SEND_WINDOW_END_IST` | `getConfigInt(cfg, 'send_window_end', 17)` |
| `process.env.BOUNCE_RATE_HARD_STOP` | `getConfigFloat(cfg, 'bounce_rate_hard_stop', 0.02)` |

The `inSendWindow()` helper specifically must use `send_window_start` and `send_window_end` from config so a single dashboard change affects both `sendEmails` and `sendFollowups`.

Add enabled check after `logCron`:
```js
if (!getConfigInt('send_followups_enabled', 1)) {
  finishCron(cronId, { status: 'skipped' });
  return;
}
```

### 4.5 `checkReplies.js`

Add enabled check after `logCron`:
```js
if (!getConfigInt('check_replies_enabled', 1)) {
  finishCron(cronId, { status: 'skipped' });
  return;
}
```

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

Group stays expanded while any `/settings/*` route is active (check with `useLocation()`).

### 5.2 New routes (`App.jsx`)

```jsx
<Route path="/settings" element={<Navigate to="/settings/niches" replace />} />
<Route path="/settings/niches"  element={<NicheManager />} />
<Route path="/settings/engines" element={<EngineConfig />} />
<Route path="/settings/icp"     element={<IcpRules />} />
<Route path="/settings/persona" element={<EmailPersona />} />
```

All protected under existing `ProtectedLayout`.

### 5.3 New API calls in `dashboard/src/api.js`

```js
getConfig:      ()          => request('/config'),
updateConfig:   (obj)       => request('/config', { method: 'PUT', body: JSON.stringify(obj) }),
getNiches:      ()          => request('/niches'),
createNiche:    (data)      => request('/niches', { method: 'POST', body: JSON.stringify(data) }),
updateNiche:    (id, data)  => request(`/niches/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
deleteNiche:    (id)        => request(`/niches/${id}`, { method: 'DELETE' }),
getIcpRules:    ()          => request('/icp-rules'),
updateIcpRules: (rules)     => request('/icp-rules', { method: 'PUT', body: JSON.stringify(rules) }),
```

### 5.4 New page files

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

- Enabled column: inline toggle (writes immediately via `PUT /api/niches/:id`)
- Edit: opens modal
- Delete: inline confirmation ("This niche will be removed. Leads already found won't be affected.") before DELETE call

**Add/Edit modal fields:**
- Label (text, required)
- Search query (textarea, required, min 10 chars)
- Assign to day (dropdown: Mon/Tue/Wed/Thu/Fri/Sat/Unassigned)
- Enabled (toggle)

**Conflict warning** (client-side informational only — server handles conflict atomically): if selected day already has a niche, show inline: "Monday already has [label] — it will become Unassigned."

**`+ Add Niche` button** top-right of the pool table.

### 6.2 EngineConfig (`/settings/engines`)

2×2 grid of engine cards.

**Each card contains:**
- Engine name + ON/OFF toggle (top row) — writes `*_enabled` key immediately
- Scheduled time label (read-only, informational)
- Editable numeric fields for that engine
- "Save Changes" button — `PUT /api/config` partial upsert with only that card's keys
- Inline "Saved ✓" confirmation on success

**sendEmails card extra:** yellow inline warning if `send_emails_enabled=1` but `daily_send_limit=0`: "Send limit is 0 — no emails will be sent."

**Fields per engine:**

| Engine | Config keys | Display label |
|---|---|---|
| findLeads | `find_leads_batches`, `find_leads_per_batch` | Batches per run, Leads per batch |
| sendEmails | `daily_send_limit`, `max_per_inbox`, `send_delay_min_ms`, `send_delay_max_ms`, `send_window_start`, `send_window_end`, `bounce_rate_hard_stop`, `claude_daily_spend_cap` | Daily send limit, Max per inbox, Delay min (ms), Delay max (ms), Window start (IST hr), Window end (IST hr), Bounce hard stop, Claude spend cap (USD) |
| sendFollowups | (none beyond toggle) | — |
| checkReplies | (none beyond toggle) | — |

**`claude_daily_spend_cap`** is shown as a read-only display field with a "(enforcement Phase 2)" note.

### 6.3 IcpRules (`/settings/icp`)

**Rules list** — drag-reorderable rows (using HTML5 drag API or CSS `order` with up/down buttons as fallback):
- Drag handle (⠿)
- Points dropdown (-3/-2/-1/+1/+2/+3), colour-coded green (positive) / red (negative)
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
Thresholds saved via `PUT /api/config` with keys `icp_threshold_a` and `icp_threshold_b`.

**"+ Add Rule" button** appends a new blank row at the bottom with `id: null`.

**"Save All Rules" button** — single `PUT /api/icp-rules` with the full ordered array (including threshold save). Server re-sequences `sort_order` from array index.

### 6.4 EmailPersona (`/settings/persona`)

Single form with fields:
- Name (text input)
- Role (text input)
- Company (text input)
- Website (text input)
- Tone (select: "professional but direct" / "casual and friendly" / "formal and corporate" / "custom")
- Custom tone field (text input, shown only when tone = "custom")
- Services offered (textarea, ~4 rows)

Single "Save Persona" button → `PUT /api/config` with all `persona_*` keys. Inline "Saved ✓" confirmation.

---

## 7. Build Sequence

1. Add `config`, `niches`, `icp_rules` tables to `db/schema.sql`
2. Add `getConfigMap()`, `getConfigInt()`, `getConfigFloat()`, `getConfigStr()` to `utils/db.js`
3. Add `seedConfigDefaults()` to `dashboard/server.js` (called at startup, after `initSchema()`)
4. Add all 6 API endpoint groups to `dashboard/server.js` (after auth middleware line)
5. Update `findLeads.js` — niche from DB, ICP rubric from DB, persona from config, batch params from config, enabled check
6. Update `sendEmails.js` — all env reads → typed config accessors, enabled check
7. Update `sendFollowups.js` — window/bounce reads → typed config accessors, enabled check
8. Update `checkReplies.js` — enabled check
9. Add Settings API methods to `dashboard/src/api.js`
10. Build `NicheManager.jsx`
11. Build `EngineConfig.jsx`
12. Build `IcpRules.jsx`
13. Build `EmailPersona.jsx`
14. Update `Sidebar.jsx` — collapsible Settings group
15. Update `App.jsx` — 4 new routes + `/settings` redirect

---

## 8. Out of Scope

- `claude_daily_spend_cap` enforcement in `utils/claude.js` (Phase 2)
- Drag-and-drop for niches pool table reordering
- US timezone send window (Phase 2 per roadmap)
- Per-niche city targeting
- Undo/history for config changes
- Config change audit log
