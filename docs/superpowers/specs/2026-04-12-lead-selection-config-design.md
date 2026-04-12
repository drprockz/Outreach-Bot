# Lead Selection Config — Design Spec

**Date:** 2026-04-12
**Status:** Approved

---

## Problem

Stage 1 discovery returns large national brands (Boat, Bold Care, unicorns) because the prompt has no business-size constraint and city targeting is inconsistently baked into niche query strings. This makes the pipeline waste quota on leads that will never buy from a solo web dev agency.

---

## Goal

Let the operator configure three targeting parameters before each run — city list, business size tier, and lead count — from a dashboard panel. Stage 1 injects these into the discovery prompt to filter out large companies and focus on the right geography.

---

## Scope

- New dashboard "Run Config" card on the Overview page
- Three new config keys in the existing `config` table
- Stage 1 prompt augmented with city + size language
- No new tables, no new API endpoints

Out of scope: per-niche overrides, saved presets, scheduling from the UI.

---

## Config Table Changes

Three new keys seeded into the `config` table (via `seedConfigDefaults`):

| Key | Type | Default | Description |
|---|---|---|---|
| `find_leads_cities` | JSON string | `'["Mumbai","Bangalore","Delhi NCR","Pune"]'` | Array of city names to target |
| `find_leads_business_size` | string | `"msme"` | `"msme"` / `"sme"` / `"both"` |
| `find_leads_count` | integer | `150` | Total leads to discover per run |

`find_leads_count` replaces `find_leads_batches` as the user-facing input. `findLeads.js` derives batches internally: `batches = Math.ceil(count / perBatch)`. Default of 150 matches the CLAUDE.md target (5 batches × 30 = 150 raw leads/day → ~34 qualified).

`find_leads_batches` is retired: remove it from `seedConfigDefaults()` and remove the "Batches per run" field from `EngineConfig.jsx`. Existing `find_leads_batches` rows in the DB can remain as inert dead config — they are no longer read.

---

## Backend Changes — `findLeads.js`

### Config reads (at pipeline start)

```js
const FALLBACK_CITIES = ["Mumbai", "Bangalore", "Delhi NCR", "Pune"];
const VALID_SIZES = ['msme', 'sme', 'both'];

let cities = FALLBACK_CITIES;
try {
  const raw = JSON.parse(getConfigStr(cfg, 'find_leads_cities', JSON.stringify(FALLBACK_CITIES)));
  cities = Array.isArray(raw) && raw.length > 0 ? raw : FALLBACK_CITIES;
} catch {
  // malformed JSON — use fallback, continue
}

const businessSizeRaw = getConfigStr(cfg, 'find_leads_business_size', 'msme');
const businessSize = VALID_SIZES.includes(businessSizeRaw) ? businessSizeRaw : 'msme';

const leadsCount = Math.max(50, getConfigInt(cfg, 'find_leads_count', 150));
const perBatch = getConfigInt(cfg, 'find_leads_per_batch', 30);
const batches = Math.ceil(leadsCount / perBatch);
```

### Size prompt fragments

```js
const SIZE_PROMPTS = {
  msme: 'Target ONLY micro/small owner-operated businesses — 1–10 employees, turnover under ₹5cr. EXCLUDE listed companies, national brands, unicorns, VC-backed startups, companies with 50+ employees.',
  sme:  'Target ONLY small/medium regional businesses — 10–200 employees, ₹5cr–₹250cr turnover. EXCLUDE listed companies, unicorns, MNCs.',
  both: 'Target MSME/SME businesses only — owner-operated to regional scale, up to 200 employees, under ₹250cr turnover. EXCLUDE listed companies, unicorns, MNCs.',
};
```

### Stage 1 prompt (updated)

```
You are a B2B lead researcher. Discover ${perBatch} real Indian businesses in the "${niche.label}" niche that likely have outdated websites.

Search query context: "${niche.query}". Batch ${batchIndex + 1} — find DIFFERENT businesses than previous batches.

Geographic target: Target businesses located in: ${cities.join(', ')}. Do not return businesses from other cities.

Business size: ${SIZE_PROMPTS[businessSize]}

Return a JSON array of objects: [{business_name, website_url, city, category}]. Return only valid JSON, no markdown.
```

---

## Dashboard Changes

### New component: `RunConfig.jsx`

A card rendered at the top of the Overview page, above the metric cards. Reads current config on mount via `GET /api/config`, writes on save via `PUT /api/config`.

#### Layout

**Location row:**
- Tier quick-select: three buttons — `Tier 1 Metros`, `Tier 2 Cities`, `Tier 3 Towns`
  - Component tracks active tiers as a `Set<number>` (not by inspecting the city list)
  - Clicking an inactive tier: add tier to Set, append its cities to city list (deduplicated — no duplicates ever in the list)
  - Clicking an active tier: remove tier from Set, remove its cities from the list (only removes cities that belong exclusively to that tier — a city that was also in another active tier or manually typed stays)
  - Tier 3 button shows as `+ Add Tier 3 (manual)` — clicking it focuses the city input
- City tag list: editable chips — click `×` to remove, type + Enter to add a custom city (deduplicated on add)

**Business Size row:**
- Three-way toggle: `MSME` · `SME` · `Both`

**Lead Count row:**
- Number input, range 50–2000 (HTML min/max). `findLeads.js` clamps to `Math.max(50, value)` server-side — values outside the range submitted via API are clamped, not rejected.
- Live cost estimate beside it: `~₹{Math.round(count * 0.75)} per run` (blended ₹0.75/lead)

**Actions row:**
- `Save` button → `PUT /api/config` with `find_leads_cities`, `find_leads_business_size`, `find_leads_count`
- Inline `Saved ✓` confirmation on success (clears after 2 seconds)

#### Tier city mappings (hardcoded in component)

```js
const TIER_CITIES = {
  1: ['Mumbai', 'Delhi NCR', 'Bangalore', 'Hyderabad', 'Chennai', 'Kolkata', 'Pune', 'Ahmedabad'],
  2: ['Jaipur', 'Surat', 'Lucknow', 'Nagpur', 'Indore', 'Bhopal', 'Visakhapatnam', 'Patna',
      'Vadodara', 'Coimbatore', 'Nashik', 'Rajkot', 'Chandigarh', 'Aurangabad', 'Jodhpur',
      'Madurai', 'Raipur', 'Kota', 'Gwalior'],
  3: [], // user adds manually
};
```

Tier 3 button shows as `+ Add Tier 3 (manual)` — clicking it focuses the city input.

### Integration point

`RunConfig.jsx` imported into `dashboard/src/pages/Overview.jsx` (or whichever file renders the home page), rendered as the first element before the existing metric cards.

---

## API

No new endpoints. Uses existing:
- `GET /api/config` — returns all config as `{ key: value }` map
- `PUT /api/config` — accepts a **flat** `{ key: value, ... }` body (no `updates:` wrapper) and bulk-upserts. Example save payload:
  ```json
  {
    "find_leads_cities": "[\"Mumbai\",\"Pune\"]",
    "find_leads_business_size": "msme",
    "find_leads_count": "150"
  }
  ```

---

## Seeding

Add three new defaults to `seedConfigDefaults()` in `utils/db.js`:

```js
{ key: 'find_leads_cities',        value: '["Mumbai","Bangalore","Delhi NCR","Pune"]' },
{ key: 'find_leads_business_size', value: 'msme' },
{ key: 'find_leads_count',         value: '150' },
```

Seeding is idempotent (`INSERT OR IGNORE`) — safe to run on existing DBs.

---

## Error Handling

All fallbacks are applied silently (no crash, no alert) — the pipeline continues with sane defaults:
- If `find_leads_cities` is malformed JSON or parses to an empty array: fall back to `["Mumbai","Bangalore","Delhi NCR","Pune"]`
- If `find_leads_business_size` is not one of `msme/sme/both`: fall back to `msme`
- If `find_leads_count` is less than 50: clamp to 50 (`Math.max(50, value)`)

---

## Files Changed

| File | Change |
|---|---|
| `utils/db.js` | Add 3 new keys to `seedConfigDefaults()`; remove `find_leads_batches` from seeds |
| `findLeads.js` | Read new config keys, derive batches from count, inject city+size into Stage 1 prompt; stop reading `find_leads_batches` |
| `dashboard/src/pages/Overview.jsx` | Import and render `<RunConfig />` at top |
| `dashboard/src/components/RunConfig.jsx` | New component (create) |
| `dashboard/src/components/EngineConfig.jsx` | Remove "Batches per run" (`find_leads_batches`) field |
| `dashboard/src/api.js` | No change expected (updateConfig helper already exists) |
