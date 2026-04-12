# Lead Selection Config Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the operator configure city targeting, business size (MSME/SME), and lead count from a dashboard "Run Config" card that injects these constraints into the Stage 1 discovery prompt — eliminating unicorn/large-brand discoveries.

**Architecture:** Three new config keys (`find_leads_cities`, `find_leads_business_size`, `find_leads_count`) stored in the existing `config` table. `findLeads.js` reads them on startup and passes city+size into `buildDiscoveryPrompt()` — a new pure function extracted from `stage1_discover` so it can be unit-tested. A new `RunConfig.jsx` card renders at the top of the Overview page, reading/writing config via the existing `api.getConfig()` / `api.updateConfig()` helpers.

**Tech Stack:** Node.js 20 + better-sqlite3 (backend), React 18 (frontend), Vitest (tests), existing `/api/config` GET+PUT endpoints (no new API work)

**Spec:** `docs/superpowers/specs/2026-04-12-lead-selection-config-design.md`

---

## Chunk 1: Backend

### Task 1: Seed new config keys, retire find_leads_batches

**Files:**
- Modify: `utils/db.js:97-125` (seedConfigDefaults)

- [ ] **Step 1: Open `utils/db.js` and locate `seedConfigDefaults`** (lines 97–125). You'll see a `defaults` array with one entry per config key.

- [ ] **Step 2: Remove the `find_leads_batches` entry**

Find and remove this line from the `defaults` array:
```js
['find_leads_batches', '5'],
```

- [ ] **Step 3: Add the three new config keys** after the `find_leads_per_batch` entry:

```js
['find_leads_cities',        '["Mumbai","Bangalore","Delhi NCR","Pune"]'],
['find_leads_business_size', 'msme'],
['find_leads_count',         '150'],
```

The final relevant section of the `defaults` array should look like:
```js
['find_leads_enabled', '1'],
['send_emails_enabled', '1'],
['send_followups_enabled', '1'],
['check_replies_enabled', '1'],
['icp_threshold_a', '7'],
['icp_threshold_b', '4'],
['find_leads_per_batch', '30'],
['find_leads_cities',        '["Mumbai","Bangalore","Delhi NCR","Pune"]'],
['find_leads_business_size', 'msme'],
['find_leads_count',         '150'],
```

- [ ] **Step 4: Verify by running the seed manually** — confirm no errors:

```bash
node -e "import('./utils/db.js').then(m => { m.seedConfigDefaults(); console.log('ok'); })"
```

Expected: prints `ok`, no crash.

- [ ] **Step 5: Commit**

```bash
git add utils/db.js
git commit -m "feat: seed find_leads_cities, find_leads_business_size, find_leads_count; retire find_leads_batches seed"
```

---

### Task 2: Extract buildDiscoveryPrompt, add city+size config reads to findLeads.js

**Files:**
- Modify: `findLeads.js:26-36` (stage1_discover), `findLeads.js:168-169` (batch config reads)
- Create: `findLeads.test.js`

- [ ] **Step 1: Write the failing tests first**

Create `findLeads.test.js`:

```js
// findLeads.test.js
import { describe, it, expect } from 'vitest';
import { buildDiscoveryPrompt } from './findLeads.js';

const niche = { label: 'Restaurants/cafes', query: 'Mumbai restaurant cafe outdated website' };

describe('buildDiscoveryPrompt', () => {
  it('includes city list', () => {
    const p = buildDiscoveryPrompt(niche, 0, 30, ['Mumbai', 'Pune'], 'msme');
    expect(p).toContain('Mumbai, Pune');
  });

  it('msme: excludes large companies', () => {
    const p = buildDiscoveryPrompt(niche, 0, 30, ['Mumbai'], 'msme');
    expect(p).toContain('1–10 employees');
    expect(p).toContain('EXCLUDE');
  });

  it('sme: targets regional businesses', () => {
    const p = buildDiscoveryPrompt(niche, 0, 30, ['Mumbai'], 'sme');
    expect(p).toContain('10–200 employees');
  });

  it('both: targets all MSME/SME', () => {
    const p = buildDiscoveryPrompt(niche, 0, 30, ['Mumbai'], 'both');
    expect(p).toContain('up to 200 employees');
  });

  it('includes correct batch number (1-indexed)', () => {
    const p = buildDiscoveryPrompt(niche, 2, 30, ['Mumbai'], 'msme');
    expect(p).toContain('Batch 3');
  });

  it('unknown size falls back to msme', () => {
    const p = buildDiscoveryPrompt(niche, 0, 30, ['Mumbai'], 'unknown');
    expect(p).toContain('1–10 employees');
  });

  it('includes niche label and query', () => {
    const p = buildDiscoveryPrompt(niche, 0, 30, ['Mumbai'], 'msme');
    expect(p).toContain('Restaurants/cafes');
    expect(p).toContain('Mumbai restaurant cafe outdated website');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run findLeads.test.js
```

Expected: FAIL — `buildDiscoveryPrompt is not exported from './findLeads.js'`

- [ ] **Step 3: Add SIZE_PROMPTS constant and extract buildDiscoveryPrompt**

In `findLeads.js`, replace the current `stage1_discover` function (around line 26) with:

```js
// ── Size constraint prompt fragments ──────────────────────
const SIZE_PROMPTS = {
  msme: 'Target ONLY micro/small owner-operated businesses — 1–10 employees, turnover under ₹5cr. EXCLUDE listed companies, national brands, unicorns, VC-backed startups, companies with 50+ employees.',
  sme:  'Target ONLY small/medium regional businesses — 10–200 employees, ₹5cr–₹250cr turnover. EXCLUDE listed companies, unicorns, MNCs.',
  both: 'Target MSME/SME businesses only — owner-operated to regional scale, up to 200 employees, under ₹250cr turnover. EXCLUDE listed companies, unicorns, MNCs.',
};

// Exported for unit testing
export function buildDiscoveryPrompt(niche, batchIndex, perBatch, cities, businessSize) {
  return `You are a B2B lead researcher. Discover ${perBatch} real Indian businesses in the "${niche.label}" niche that likely have outdated websites.

Search query context: "${niche.query}". Batch ${batchIndex + 1} — find DIFFERENT businesses than previous batches.

Geographic target: Target businesses located in: ${cities.join(', ')}. Do not return businesses from other cities.

Business size: ${SIZE_PROMPTS[businessSize] || SIZE_PROMPTS.msme}

Return a JSON array of objects: [{business_name, website_url, city, category}]. Return only valid JSON, no markdown.`;
}

// ── Stage 1: Discovery — Gemini with grounding ───────────
async function stage1_discover(niche, batchIndex, perBatch, cities, businessSize) {
  const prompt = buildDiscoveryPrompt(niche, batchIndex, perBatch, cities, businessSize);
  const result = await callGemini(prompt, { useGrounding: true });
  try {
    return { leads: JSON.parse(stripJson(result.text)), costUsd: result.costUsd };
  } catch {
    return { leads: [], costUsd: result.costUsd };
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run findLeads.test.js
```

Expected: 7 tests PASS

- [ ] **Step 5: Replace config reads in the main pipeline function**

In the `findLeads()` function, find this line (around line 168):
```js
const batches = getConfigInt(cfg, 'find_leads_batches', 5);
const perBatch = getConfigInt(cfg, 'find_leads_per_batch', 30);
```

Replace it with:
```js
const FALLBACK_CITIES = ['Mumbai', 'Bangalore', 'Delhi NCR', 'Pune'];
const VALID_SIZES = ['msme', 'sme', 'both'];

let cities = FALLBACK_CITIES;
try {
  const raw = JSON.parse(getConfigStr(cfg, 'find_leads_cities', JSON.stringify(FALLBACK_CITIES)));
  cities = Array.isArray(raw) && raw.length > 0 ? raw : FALLBACK_CITIES;
} catch {
  // malformed JSON in DB — use fallback
}

const businessSizeRaw = getConfigStr(cfg, 'find_leads_business_size', 'msme');
const businessSize = VALID_SIZES.includes(businessSizeRaw) ? businessSizeRaw : 'msme';

const leadsCount = Math.max(50, getConfigInt(cfg, 'find_leads_count', 150));
const perBatch = getConfigInt(cfg, 'find_leads_per_batch', 30);
const batches = Math.ceil(leadsCount / perBatch);
```

- [ ] **Step 6: Update the Stage 1 withConcurrency call to pass cities and businessSize**

Find this block (currently around line 204):
```js
const discoveryResults = await withConcurrency(batchIndices, 5, async (batchIndex) => {
  try {
    const { leads, costUsd } = await stage1_discover(niche, batchIndex, perBatch);
    totalCost += costUsd;
    bumpMetric('gemini_cost_usd', costUsd);
    bumpMetric('total_api_cost_usd', costUsd);
    return leads;
  } catch (err) {
    logError('findLeads.discovery', err, { jobName: 'findLeads' });
    return [];
  }
});
```

Change only the `stage1_discover(...)` call — add `cities` and `businessSize` as the last two arguments:
```js
const discoveryResults = await withConcurrency(batchIndices, 5, async (batchIndex) => {
  try {
    const { leads, costUsd } = await stage1_discover(niche, batchIndex, perBatch, cities, businessSize);
    totalCost += costUsd;
    bumpMetric('gemini_cost_usd', costUsd);
    bumpMetric('total_api_cost_usd', costUsd);
    return leads;
  } catch (err) {
    logError('findLeads.discovery', err, { jobName: 'findLeads' });
    return [];
  }
});
```

- [ ] **Step 7: Run all tests**

```bash
npx vitest run
```

Expected: all tests pass (concurrency tests + new findLeads tests)

- [ ] **Step 8: Syntax check**

```bash
node --input-type=module --check < findLeads.js
```

Expected: no output (clean)

- [ ] **Step 9: Commit**

```bash
git add findLeads.js findLeads.test.js
git commit -m "feat: inject city+size into Stage 1 discovery prompt; derive batches from lead count"
```

---

### Task 3: Remove find_leads_batches from EngineConfig page

**Files:**
- Modify: `dashboard/src/pages/EngineConfig.jsx:10-13`

- [ ] **Step 1: Open `dashboard/src/pages/EngineConfig.jsx`**

Find the `findLeads.js` engine block. It looks like:
```js
fields: [
  { key: 'find_leads_batches',   label: 'Batches per run',  type: 'int' },
  { key: 'find_leads_per_batch', label: 'Leads per batch',  type: 'int' },
]
```

- [ ] **Step 2: Replace `find_leads_batches` with `find_leads_count`**

```js
fields: [
  { key: 'find_leads_count',     label: 'Lead count (total per run)',  type: 'int' },
  { key: 'find_leads_per_batch', label: 'Leads per batch',             type: 'int' },
]
```

Note: the old `find_leads_batches` row still exists in the SQLite DB — it is now inert dead config. No `DELETE` is needed; `findLeads.js` no longer reads it.

- [ ] **Step 3: Verify the file is valid JSX**

```bash
node --input-type=module -e "import('./dashboard/src/pages/EngineConfig.jsx')" 2>&1 | head -5
```

Or simply check there are no obvious syntax errors by searching for the changed field:
```bash
grep -n "find_leads" dashboard/src/pages/EngineConfig.jsx
```

Expected: `find_leads_count` and `find_leads_per_batch` appear; `find_leads_batches` does NOT appear.

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/pages/EngineConfig.jsx
git commit -m "feat: replace find_leads_batches with find_leads_count in EngineConfig"
```

---

## Chunk 2: Dashboard UI

### Task 4: Create RunConfig.jsx component

**Files:**
- Create: `dashboard/src/components/RunConfig.jsx`

- [ ] **Step 1: Create the file**

Create `dashboard/src/components/RunConfig.jsx` with this content:

```jsx
import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api';

const TIER_CITIES = {
  1: ['Mumbai', 'Delhi NCR', 'Bangalore', 'Hyderabad', 'Chennai', 'Kolkata', 'Pune', 'Ahmedabad'],
  2: ['Jaipur', 'Surat', 'Lucknow', 'Nagpur', 'Indore', 'Bhopal', 'Visakhapatnam', 'Patna',
      'Vadodara', 'Coimbatore', 'Nashik', 'Rajkot', 'Chandigarh', 'Aurangabad', 'Jodhpur',
      'Madurai', 'Raipur', 'Kota', 'Gwalior'],
  3: [], // Tier 3 = manual entry only — no predefined cities
};

const SIZE_HINTS = {
  msme: 'Micro/small — 1–10 employees, <₹5cr turnover',
  sme:  'Small/medium — 10–200 employees, ₹5cr–₹250cr',
  both: 'All MSME/SME — up to 200 employees, <₹250cr',
};

const COST_PER_LEAD = 0.75; // ₹ blended estimate

export default function RunConfig() {
  const [cities, setCities] = useState([]);
  const [businessSize, setBusinessSize] = useState('msme');
  const [leadCount, setLeadCount] = useState(150);
  const [activeTiers, setActiveTiers] = useState(new Set());
  const [cityInput, setCityInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const cityInputRef = useRef(null);

  useEffect(() => {
    api.getConfig().then(cfg => {
      try {
        const parsed = JSON.parse(cfg.find_leads_cities || '[]');
        if (Array.isArray(parsed) && parsed.length > 0) setCities(parsed);
      } catch { /* use default */ }
      if (cfg.find_leads_business_size) setBusinessSize(cfg.find_leads_business_size);
      if (cfg.find_leads_count) setLeadCount(parseInt(cfg.find_leads_count) || 150);
    });
  }, []);

  function toggleTier(tier) {
    const tierCities = TIER_CITIES[tier] || [];
    if (activeTiers.has(tier)) {
      // Remove this tier — only remove cities not claimed by another active tier
      const otherTierCities = new Set(
        [...activeTiers].filter(t => t !== tier).flatMap(t => TIER_CITIES[t] || [])
      );
      setCities(prev => prev.filter(c => otherTierCities.has(c) || !tierCities.includes(c)));
      setActiveTiers(prev => { const s = new Set(prev); s.delete(tier); return s; });
    } else {
      // Add this tier — deduplicate
      setCities(prev => [...new Set([...prev, ...tierCities])]);
      setActiveTiers(prev => new Set([...prev, tier]));
    }
  }

  function addCity(name) {
    const trimmed = name.trim();
    if (!trimmed || cities.includes(trimmed)) return;
    setCities(prev => [...prev, trimmed]);
  }

  function removeCity(city) {
    setCities(prev => prev.filter(c => c !== city));
    // If the removed city belonged to an active tier, deactivate that tier
    for (const [tier, tierCities] of Object.entries(TIER_CITIES)) {
      if (tierCities.includes(city) && activeTiers.has(Number(tier))) {
        setActiveTiers(prev => { const s = new Set(prev); s.delete(Number(tier)); return s; });
      }
    }
  }

  async function handleSave() {
    setSaving(true);
    await api.updateConfig({
      find_leads_cities: JSON.stringify(cities),
      find_leads_business_size: businessSize,
      find_leads_count: String(leadCount),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const estimatedCost = Math.round(leadCount * COST_PER_LEAD);

  return (
    <div className="card mb-xl">
      <div className="section-title" style={{ marginTop: 0 }}>Run Config</div>

      {/* Location */}
      <div style={{ marginBottom: '1rem' }}>
        <div className="form-label" style={{ marginBottom: '0.5rem' }}>Location</div>
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
          {[1, 2].map(tier => (
            <button
              key={tier}
              onClick={() => toggleTier(tier)}
              className={activeTiers.has(tier) ? 'btn btn-primary' : 'btn btn-secondary'}
              style={{ fontSize: '0.8rem', padding: '4px 12px' }}
            >
              {tier === 1 ? 'Tier 1 Metros' : 'Tier 2 Cities'}
            </button>
          ))}
          <button
            className="btn btn-secondary"
            style={{ fontSize: '0.8rem', padding: '4px 12px' }}
            onClick={() => cityInputRef.current?.focus()}
          >
            + Add Tier 3 (manual)
          </button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center' }}>
          {cities.map(city => (
            <span
              key={city}
              className="badge badge-blue"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
            >
              {city}
              <button
                onClick={() => removeCity(city)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: '0 2px', lineHeight: 1 }}
                aria-label={`Remove ${city}`}
              >×</button>
            </span>
          ))}
          <input
            ref={cityInputRef}
            placeholder="Type city + Enter"
            value={cityInput}
            onChange={e => setCityInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addCity(cityInput);
                setCityInput('');
              }
            }}
            style={{ border: '1px solid var(--border)', borderRadius: '4px', padding: '2px 8px', fontSize: '0.85rem', minWidth: '140px' }}
          />
        </div>
      </div>

      {/* Business Size */}
      <div style={{ marginBottom: '1rem' }}>
        <div className="form-label" style={{ marginBottom: '0.5rem' }}>Business Size</div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {['msme', 'sme', 'both'].map(s => (
            <button
              key={s}
              onClick={() => setBusinessSize(s)}
              className={businessSize === s ? 'btn btn-primary' : 'btn btn-secondary'}
              style={{ fontSize: '0.8rem', padding: '4px 12px' }}
            >
              {s.toUpperCase()}
            </button>
          ))}
          <span className="text-muted" style={{ fontSize: '0.82rem' }}>{SIZE_HINTS[businessSize]}</span>
        </div>
      </div>

      {/* Lead Count */}
      <div style={{ marginBottom: '1.25rem' }}>
        <div className="form-label" style={{ marginBottom: '0.5rem' }}>Lead Count</div>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <input
            type="number"
            min={50}
            max={2000}
            value={leadCount}
            onChange={e => setLeadCount(Math.max(50, Math.min(2000, parseInt(e.target.value) || 50)))}
            style={{ width: '90px', border: '1px solid var(--border)', borderRadius: '4px', padding: '4px 8px', fontSize: '0.9rem' }}
          />
          <span className="text-muted" style={{ fontSize: '0.85rem' }}>~₹{estimatedCost} per run</span>
        </div>
      </div>

      {/* Save */}
      <button
        className="btn btn-primary"
        onClick={handleSave}
        disabled={saving}
      >
        {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save'}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Check for existing CSS classes used in the component**

The component uses: `card`, `mb-xl`, `section-title`, `form-label`, `btn`, `btn-primary`, `btn-secondary`, `badge`, `badge-blue`, `text-muted`. These are all used elsewhere in the dashboard — no new CSS needed.

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/components/RunConfig.jsx
git commit -m "feat: add RunConfig dashboard component for city/size/count targeting"
```

---

### Task 5: Render RunConfig at top of Overview page

**Files:**
- Modify: `dashboard/src/pages/Overview.jsx:1-5` (imports), `Overview.jsx:104-106` (render)

- [ ] **Step 1: Add the import**

At the top of `dashboard/src/pages/Overview.jsx`, add:

```js
import RunConfig from '../components/RunConfig';
```

Place it after the existing `import StatCard` line.

- [ ] **Step 2: Render RunConfig before the stat grid**

Find the `return (` in `Overview`, then the `<div>` wrapping the page. Add `<RunConfig />` as the first element, before `<h1 className="page-title">Overview</h1>`:

```jsx
return (
  <div>
    <RunConfig />
    <h1 className="page-title">Overview</h1>
    {/* ... rest unchanged ... */}
  </div>
);
```

- [ ] **Step 3: Start the dev server and verify visually**

```bash
cd dashboard && npm run dev
```

Open `http://localhost:5173` (or whatever port Vite uses). You should see:
- The Run Config card at the top of the Overview page
- Tier 1 / Tier 2 buttons
- City tags loaded from DB (Mumbai, Bangalore, Delhi NCR, Pune by default)
- MSME/SME/Both toggle
- Lead count input showing 150 with ~₹113 estimate
- Save button

Click "Tier 1 Metros" — all 8 cities should appear as tags. Click it again — they should be removed. Add a custom city by typing + Enter. Change size to SME. Change count. Click Save — should show "Saved ✓" briefly.

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/pages/Overview.jsx
git commit -m "feat: render RunConfig card at top of Overview page"
```

---

## Final verification

- [ ] **Run all tests one more time**

```bash
npx vitest run
```

Expected: all pass

- [ ] **Syntax check findLeads.js**

```bash
node --input-type=module --check < findLeads.js
```

Expected: no output

- [ ] **Verify the full change set**

```bash
git log --oneline -5
```

Expected 5 commits visible:
1. `feat: seed find_leads_cities, ...`
2. `feat: inject city+size into Stage 1 discovery prompt; ...`
3. `feat: replace find_leads_batches with find_leads_count in EngineConfig`
4. `feat: add RunConfig dashboard component ...`
5. `feat: render RunConfig card at top of Overview page`
