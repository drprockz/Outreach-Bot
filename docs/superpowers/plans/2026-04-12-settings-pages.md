# Settings Pages Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Settings section to the Radar dashboard (4 sub-pages) backed by a SQLite config layer that replaces hardcoded values in all engines.

**Architecture:** Three new DB tables (`config`, `niches`, `icp_rules`) store all configuration. `utils/db.js` gains typed config helpers. Engines read from DB with hardcoded fallbacks. The dashboard exposes 6 new API endpoints and 4 new React pages under `/settings/*`.

**Tech Stack:** Node.js ESM, better-sqlite3, Express, Vitest, React 18, react-router-dom v6

**Spec:** `docs/superpowers/specs/2026-04-12-settings-pages-design.md`

---

## File Map

### Modified
- `db/schema.sql` — add `config`, `niches`, `icp_rules` tables
- `utils/db.js` — add `getConfigMap`, `getConfigInt`, `getConfigFloat`, `getConfigStr`, `seedConfigDefaults`, `seedNichesAndIcpRules`
- `dashboard/server.js` — call seed functions at startup; add 6 API route groups (after auth middleware)
- `findLeads.js` — read niche/ICP/persona/batches from DB; enabled check
- `sendEmails.js` — read all config from DB helpers; enabled check
- `sendFollowups.js` — read send window/limits/bounce from DB; enabled check
- `checkReplies.js` — enabled check
- `dashboard/src/api.js` — add 8 Settings API methods
- `dashboard/src/App.jsx` — add 4 routes + `/settings` redirect
- `dashboard/src/components/Sidebar.jsx` — collapsible Settings nav group
- `tests/utils/db.test.js` — add config helper tests
- `tests/dashboard/api.test.js` — add config/niches/icp-rules endpoint tests
- `tests/findLeads.test.js` — seed niches+icp_rules+config in test setup
- `tests/sendEmails.test.js` — seed config table instead of process.env
- `tests/sendFollowups.test.js` — seed config table instead of process.env

### Created
- `dashboard/src/pages/NicheManager.jsx`
- `dashboard/src/pages/EngineConfig.jsx`
- `dashboard/src/pages/IcpRules.jsx`
- `dashboard/src/pages/EmailPersona.jsx`

---

## Chunk 1: Database Layer

### Task 1: Add tables to schema.sql

**Files:**
- Modify: `db/schema.sql`
- Modify: `tests/utils/db.test.js`

- [ ] **Step 1: Write the failing test**

Add to `tests/utils/db.test.js` (inside the existing `describe('db helpers'` block):

```js
it('initSchema creates config table', async () => {
  const { getDb } = await import('../../utils/db.js');
  const row = getDb().prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='config'`).get();
  expect(row).toBeTruthy();
});

it('initSchema creates niches table', async () => {
  const { getDb } = await import('../../utils/db.js');
  const row = getDb().prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='niches'`).get();
  expect(row).toBeTruthy();
});

it('initSchema creates icp_rules table', async () => {
  const { getDb } = await import('../../utils/db.js');
  const row = getDb().prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='icp_rules'`).get();
  expect(row).toBeTruthy();
});
```

- [ ] **Step 2: Run test — expect FAIL**
```bash
npx vitest run tests/utils/db.test.js
```
Expected: 3 failures — tables don't exist yet.

- [ ] **Step 3: Add tables to `db/schema.sql`**

Append to the end of `db/schema.sql` (before or after the INDICES block):

```sql
-- ── CONFIG ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS config (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- ── NICHES ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS niches (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  label       TEXT NOT NULL,
  query       TEXT NOT NULL,
  day_of_week INTEGER,
  enabled     INTEGER DEFAULT 1,
  sort_order  INTEGER DEFAULT 0,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ── ICP RULES ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS icp_rules (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  label       TEXT NOT NULL,
  points      INTEGER NOT NULL,
  description TEXT,
  enabled     INTEGER DEFAULT 1,
  sort_order  INTEGER DEFAULT 0
);
```

- [ ] **Step 4: Run test — expect PASS**
```bash
npx vitest run tests/utils/db.test.js
```
Expected: all pass.

- [ ] **Step 5: Commit**
```bash
git add db/schema.sql tests/utils/db.test.js
git commit -m "feat: add config, niches, icp_rules tables to schema"
```

---

### Task 2: Add config helpers to utils/db.js

**Files:**
- Modify: `utils/db.js`
- Modify: `tests/utils/db.test.js`

- [ ] **Step 1: Write failing tests**

Add to `tests/utils/db.test.js`:

```js
it('getConfigMap returns empty object when config table is empty', async () => {
  const { getConfigMap } = await import('../../utils/db.js');
  const cfg = getConfigMap();
  expect(cfg).toEqual({});
});

it('getConfigMap returns inserted rows', async () => {
  const { getDb, getConfigMap } = await import('../../utils/db.js');
  getDb().prepare('INSERT INTO config (key, value) VALUES (?, ?)').run('test_key', '42');
  const cfg = getConfigMap();
  expect(cfg.test_key).toBe('42');
});

it('getConfigInt parses integer from map', async () => {
  const { getConfigInt } = await import('../../utils/db.js');
  expect(getConfigInt({ daily_send_limit: '10' }, 'daily_send_limit', 0)).toBe(10);
});

it('getConfigInt returns fallback for missing key', async () => {
  const { getConfigInt } = await import('../../utils/db.js');
  expect(getConfigInt({}, 'missing', 99)).toBe(99);
});

it('getConfigFloat parses float from map', async () => {
  const { getConfigFloat } = await import('../../utils/db.js');
  expect(getConfigFloat({ bounce_rate: '0.02' }, 'bounce_rate', 0)).toBeCloseTo(0.02);
});

it('getConfigStr returns string value', async () => {
  const { getConfigStr } = await import('../../utils/db.js');
  expect(getConfigStr({ persona_name: 'Darshan' }, 'persona_name', '')).toBe('Darshan');
});

it('getConfigStr returns fallback for missing key', async () => {
  const { getConfigStr } = await import('../../utils/db.js');
  expect(getConfigStr({}, 'missing', 'default')).toBe('default');
});

it('getConfigMap returns {} gracefully when config table missing', async () => {
  // Drop the config table to simulate missing table
  const { getDb, getConfigMap } = await import('../../utils/db.js');
  getDb().prepare('DROP TABLE IF EXISTS config').run();
  const cfg = getConfigMap();
  expect(cfg).toEqual({});
});
```

- [ ] **Step 2: Run — expect FAIL**
```bash
npx vitest run tests/utils/db.test.js
```
Expected: failures for getConfigMap, getConfigInt, getConfigFloat, getConfigStr.

- [ ] **Step 3: Add seed functions and helpers to `utils/db.js`**

> Note: `seedNichesAndIcpRules` is added here alongside `seedConfigDefaults` — it is not listed in spec §7 step 3 but is required by spec §2.2 (niches/icp_rules must be seeded on startup).



Add after the existing `isRejected` function:

```js
export function getConfigMap() {
  try {
    const rows = getDb().prepare('SELECT key, value FROM config').all();
    return Object.fromEntries(rows.map(r => [r.key, r.value]));
  } catch {
    return {};
  }
}

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

- [ ] **Step 4: Run — expect PASS**
```bash
npx vitest run tests/utils/db.test.js
```

- [ ] **Step 5: Commit**
```bash
git add utils/db.js tests/utils/db.test.js
git commit -m "feat: add getConfigMap and typed config accessor helpers"
```

---

## Chunk 2: Backend API

### Task 3: Seed functions + GET/PUT /api/config

**Files:**
- Modify: `utils/db.js` — add `seedConfigDefaults`, `seedNichesAndIcpRules`
- Modify: `dashboard/server.js` — call seeds at startup; add config endpoints
- Modify: `tests/dashboard/api.test.js`

- [ ] **Step 1: Write failing tests**

Add to `tests/dashboard/api.test.js` (requires a valid token — add a helper inside the file):

```js
// Helper: get auth token (add near top of file, inside describe block or as module-level)
async function getToken() {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'testpass' })
  });
  return (await res.json()).token;
}

// Config endpoint tests
describe('GET /api/config', () => {
  it('requires auth', async () => {
    const res = await fetch(`${baseUrl}/api/config`);
    expect(res.status).toBe(401);
  });

  it('returns seeded config as flat object', async () => {
    const token = await getToken();
    const res = await fetch(`${baseUrl}/api/config`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.daily_send_limit).toBeDefined();
    expect(data.persona_name).toBe('Darshan Parmar');
  });
});

describe('PUT /api/config', () => {
  it('updates provided keys without touching others', async () => {
    const token = await getToken();
    await fetch(`${baseUrl}/api/config`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ daily_send_limit: '20' })
    });
    const res = await fetch(`${baseUrl}/api/config`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    expect(data.daily_send_limit).toBe('20');
    // Other keys untouched
    expect(data.persona_name).toBe('Darshan Parmar');
  });
});
```

- [ ] **Step 2: Run — expect FAIL**
```bash
npx vitest run tests/dashboard/api.test.js
```
Expected: 404 or route-not-found errors for config endpoints.

- [ ] **Step 3: Add seed functions to `utils/db.js`**

Add after `getConfigStr`:

```js
export function seedConfigDefaults() {
  const db = getDb();
  const defaults = [
    ['daily_send_limit', '0'],
    ['max_per_inbox', '17'],
    ['send_delay_min_ms', '180000'],
    ['send_delay_max_ms', '420000'],
    ['send_window_start', '9'],
    ['send_window_end', '17'],
    ['bounce_rate_hard_stop', '0.02'],
    ['claude_daily_spend_cap', '3.00'],
    ['find_leads_enabled', '1'],
    ['send_emails_enabled', '1'],
    ['send_followups_enabled', '1'],
    ['check_replies_enabled', '1'],
    ['icp_threshold_a', '7'],
    ['icp_threshold_b', '4'],
    ['find_leads_batches', '5'],
    ['find_leads_per_batch', '30'],
    ['persona_name', 'Darshan Parmar'],
    ['persona_role', 'Full-Stack Developer'],
    ['persona_company', 'Simple Inc'],
    ['persona_website', 'simpleinc.in'],
    ['persona_tone', 'professional but direct'],
    ['persona_services', 'Full-stack web development, redesigns, performance optimisation, custom React apps, API integrations'],
  ];
  const stmt = db.prepare('INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)');
  for (const [key, value] of defaults) stmt.run(key, value);
}

export function seedNichesAndIcpRules() {
  const db = getDb();

  const nicheCount = db.prepare('SELECT COUNT(*) as n FROM niches').get().n;
  if (nicheCount === 0) {
    const niches = [
      [1, 'Shopify/D2C brands', 'India D2C ecommerce brand Shopify outdated website'],
      [2, 'Real estate agencies', 'Mumbai real estate agency property portal outdated website'],
      [3, 'Funded startups', 'India funded B2B startup outdated website developer needed'],
      [4, 'Restaurants/cafes', 'Mumbai restaurant cafe outdated website no online booking'],
      [5, 'Agencies/consultancies', 'Mumbai digital agency overflow web development outsource'],
      [6, 'Healthcare/salons', 'India healthcare salon clinic outdated website no booking'],
    ];
    const stmt = db.prepare('INSERT INTO niches (day_of_week, label, query, enabled, sort_order) VALUES (?, ?, ?, 1, ?)');
    niches.forEach(([day, label, query], i) => stmt.run(day, label, query, i));
  }

  const ruleCount = db.prepare('SELECT COUNT(*) as n FROM icp_rules').get().n;
  if (ruleCount === 0) {
    const rules = [
      [3,  'India-based B2C-facing (restaurant, salon, real estate, D2C)', null],
      [2,  '20+ Google reviews (established business, has budget)', null],
      [2,  'WordPress/Wix/Squarespace stack (easiest sell)', null],
      [2,  'Website last updated 2+ years ago', null],
      [1,  'Active Instagram/Facebook but neglected website', null],
      [1,  'WhatsApp Business on site but no online booking/ordering', null],
      [-2, 'Freelancer or solo consultant (low budget)', null],
      [-3, 'Already on modern stack (Next.js, custom React, Webflow)', null],
    ];
    const stmt = db.prepare('INSERT INTO icp_rules (points, label, description, enabled, sort_order) VALUES (?, ?, ?, 1, ?)');
    rules.forEach(([points, label, desc], i) => stmt.run(points, label, desc, i));
  }
}
```

- [ ] **Step 4: Update `dashboard/server.js`** — call seed functions at startup and add config endpoints

In the imports section, add `seedConfigDefaults` and `seedNichesAndIcpRules`:
```js
import { getDb, today, initSchema, seedConfigDefaults, seedNichesAndIcpRules } from '../utils/db.js';
```

After the existing `initSchema()` call (line 16), add:
```js
seedConfigDefaults();
seedNichesAndIcpRules();
```

Add these routes **after** the existing `app.use('/api', authMiddleware)` line and before the static file serving block:

```js
// ── GET /api/config ───────────────────────────────────────
app.get('/api/config', (req, res) => {
  const rows = getDb().prepare('SELECT key, value FROM config').all();
  res.json(Object.fromEntries(rows.map(r => [r.key, r.value])));
});

// ── PUT /api/config ───────────────────────────────────────
app.put('/api/config', (req, res) => {
  const updates = req.body || {};
  const stmt = getDb().prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(updates)) {
    stmt.run(key, String(value));
  }
  res.json({ ok: true });
});
```

- [ ] **Step 5: Run — expect PASS**
```bash
npx vitest run tests/dashboard/api.test.js
```

- [ ] **Step 6: Commit**
```bash
git add utils/db.js dashboard/server.js tests/dashboard/api.test.js
git commit -m "feat: add seedConfigDefaults, seedNichesAndIcpRules, GET/PUT /api/config"
```

---

### Task 4: Niches CRUD API

**Files:**
- Modify: `dashboard/server.js`
- Modify: `tests/dashboard/api.test.js`

- [ ] **Step 1: Write failing tests**

Add to `tests/dashboard/api.test.js`:

```js
// NOTE: GET /api/niches must run before POST /api/niches tests — POST tests add rows
// that would break the length===6 assertion. Declaration order in this file is relied upon.
describe('GET /api/niches', () => {
  it('returns seeded niches ordered by sort_order', async () => {
    const token = await getToken();
    const res = await fetch(`${baseUrl}/api/niches`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.niches)).toBe(true);
    expect(data.niches.length).toBe(6);
    expect(data.niches[0].day_of_week).toBe(1); // Monday first
  });
});

describe('POST /api/niches', () => {
  it('creates a niche and returns it', async () => {
    const token = await getToken();
    const res = await fetch(`${baseUrl}/api/niches`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'Test Niche', query: 'test query string here', day_of_week: null, enabled: 1 })
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.niche.label).toBe('Test Niche');
    expect(data.niche.id).toBeDefined();
  });

  it('clears conflicting day assignment atomically when day is taken', async () => {
    const token = await getToken();
    // Monday (day 1) is already taken by seed
    const res = await fetch(`${baseUrl}/api/niches`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'New Monday', query: 'new monday query string', day_of_week: 1, enabled: 1 })
    });
    expect(res.status).toBe(201);
    // Old Monday niche should now have day_of_week = null
    const listRes = await fetch(`${baseUrl}/api/niches`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const { niches } = await listRes.json();
    const mondayNiches = niches.filter(n => n.day_of_week === 1);
    expect(mondayNiches.length).toBe(1);
    expect(mondayNiches[0].label).toBe('New Monday');
  });
});

describe('PUT /api/niches/:id', () => {
  it('updates a niche', async () => {
    const token = await getToken();
    const listRes = await fetch(`${baseUrl}/api/niches`, { headers: { Authorization: `Bearer ${token}` } });
    const { niches } = await listRes.json();
    const id = niches[0].id;

    const res = await fetch(`${baseUrl}/api/niches/${id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'Updated', query: 'updated query text here', day_of_week: niches[0].day_of_week, enabled: 1 })
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });
});

describe('DELETE /api/niches/:id', () => {
  it('deletes a niche', async () => {
    const token = await getToken();
    // Create one first
    const createRes = await fetch(`${baseUrl}/api/niches`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'To Delete', query: 'to be deleted query', day_of_week: null, enabled: 1 })
    });
    const { niche } = await createRes.json();

    const res = await fetch(`${baseUrl}/api/niches/${niche.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(200);

    const listRes = await fetch(`${baseUrl}/api/niches`, { headers: { Authorization: `Bearer ${token}` } });
    const { niches } = await listRes.json();
    expect(niches.find(n => n.id === niche.id)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**
```bash
npx vitest run tests/dashboard/api.test.js
```

- [ ] **Step 3: Add niche routes to `dashboard/server.js`**

Add after the PUT /api/config route:

```js
// ── GET /api/niches ───────────────────────────────────────
app.get('/api/niches', (req, res) => {
  const niches = getDb().prepare('SELECT * FROM niches ORDER BY sort_order, id').all();
  res.json({ niches });
});

// ── POST /api/niches ──────────────────────────────────────
app.post('/api/niches', (req, res) => {
  const { label, query, day_of_week = null, enabled = 1 } = req.body || {};
  if (!label || !query) return res.status(400).json({ error: 'label and query are required' });
  if (query.length < 10) return res.status(400).json({ error: 'query must be at least 10 characters' });

  const db = getDb();
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) as m FROM niches').get().m;

  const createFn = db.transaction(() => {
    if (day_of_week !== null) {
      db.prepare('UPDATE niches SET day_of_week = NULL WHERE day_of_week = ?').run(day_of_week);
    }
    const result = db.prepare(
      'INSERT INTO niches (label, query, day_of_week, enabled, sort_order) VALUES (?, ?, ?, ?, ?)'
    ).run(label, query, day_of_week, enabled ? 1 : 0, maxOrder + 1);
    return db.prepare('SELECT * FROM niches WHERE id = ?').get(result.lastInsertRowid);
  });

  const niche = createFn();
  res.status(201).json({ niche });
});

// ── PUT /api/niches/:id ───────────────────────────────────
app.put('/api/niches/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const { label, query, day_of_week = null, enabled = 1, sort_order } = req.body || {};
  if (!label || !query) return res.status(400).json({ error: 'label and query are required' });

  const db = getDb();
  const existing = db.prepare('SELECT * FROM niches WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Niche not found' });

  const updateFn = db.transaction(() => {
    if (day_of_week !== null) {
      db.prepare('UPDATE niches SET day_of_week = NULL WHERE day_of_week = ? AND id != ?').run(day_of_week, id);
    }
    db.prepare(
      'UPDATE niches SET label=?, query=?, day_of_week=?, enabled=?, sort_order=? WHERE id=?'
    ).run(label, query, day_of_week, enabled ? 1 : 0, sort_order ?? existing.sort_order, id);
  });

  updateFn();
  res.json({ ok: true });
});

// ── DELETE /api/niches/:id ────────────────────────────────
app.delete('/api/niches/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const existing = getDb().prepare('SELECT id FROM niches WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Niche not found' });
  getDb().prepare('DELETE FROM niches WHERE id = ?').run(id);
  res.json({ ok: true });
});
```

- [ ] **Step 4: Run — expect PASS**
```bash
npx vitest run tests/dashboard/api.test.js
```

- [ ] **Step 5: Commit**
```bash
git add dashboard/server.js tests/dashboard/api.test.js
git commit -m "feat: add CRUD /api/niches with atomic day-assignment conflict resolution"
```

---

### Task 5: ICP Rules API

**Files:**
- Modify: `dashboard/server.js`
- Modify: `tests/dashboard/api.test.js`

- [ ] **Step 1: Write failing tests**

Add to `tests/dashboard/api.test.js`:

```js
// NOTE: GET /api/icp-rules must run before PUT /api/icp-rules — the PUT bulk-replaces
// the table, leaving only 2 rules after it runs, which would break the length===8 assertion.
describe('GET /api/icp-rules', () => {
  it('returns seeded rules', async () => {
    const token = await getToken();
    const res = await fetch(`${baseUrl}/api/icp-rules`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.rules)).toBe(true);
    expect(data.rules.length).toBe(8);
    expect(data.rules[0].points).toBe(3);
  });
});

describe('PUT /api/icp-rules', () => {
  it('bulk-replaces rules and re-sequences sort_order', async () => {
    const token = await getToken();
    const newRules = [
      { label: 'Rule A', points: 2, description: null, enabled: 1 },
      { label: 'Rule B', points: -1, description: 'desc', enabled: 1 },
    ];
    const res = await fetch(`${baseUrl}/api/icp-rules`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(newRules)
    });
    expect(res.status).toBe(200);

    const listRes = await fetch(`${baseUrl}/api/icp-rules`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const { rules } = await listRes.json();
    expect(rules.length).toBe(2);
    expect(rules[0].label).toBe('Rule A');
    expect(rules[0].sort_order).toBe(0);
    expect(rules[1].sort_order).toBe(1);
  });

  it('rolls back entirely if a rule has invalid points', async () => {
    const token = await getToken();
    // First get current count
    const beforeRes = await fetch(`${baseUrl}/api/icp-rules`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const { rules: before } = await beforeRes.json();

    const badRules = [
      { label: 'Good', points: 2, enabled: 1 },
      { label: 'Bad', points: 99, enabled: 1 }, // invalid
    ];
    const res = await fetch(`${baseUrl}/api/icp-rules`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(badRules)
    });
    expect(res.status).toBe(400);

    // Table unchanged
    const afterRes = await fetch(`${baseUrl}/api/icp-rules`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const { rules: after } = await afterRes.json();
    expect(after.length).toBe(before.length);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**
```bash
npx vitest run tests/dashboard/api.test.js
```

- [ ] **Step 3: Add ICP rules routes to `dashboard/server.js`**

```js
// ── GET /api/icp-rules ────────────────────────────────────
app.get('/api/icp-rules', (req, res) => {
  const rules = getDb().prepare('SELECT * FROM icp_rules ORDER BY sort_order, id').all();
  res.json({ rules });
});

// ── PUT /api/icp-rules ────────────────────────────────────
app.put('/api/icp-rules', (req, res) => {
  const rules = req.body;
  if (!Array.isArray(rules)) return res.status(400).json({ error: 'body must be an array' });

  const VALID_POINTS = [-3, -2, -1, 1, 2, 3];
  for (const r of rules) {
    if (!r.label) return res.status(400).json({ error: 'each rule must have a label' });
    if (!VALID_POINTS.includes(r.points)) return res.status(400).json({ error: `invalid points value: ${r.points}` });
  }

  const db = getDb();
  const replaceFn = db.transaction((rulesArr) => {
    db.prepare('DELETE FROM icp_rules').run();
    rulesArr.forEach((r, i) => {
      db.prepare(
        'INSERT INTO icp_rules (label, points, description, enabled, sort_order) VALUES (?, ?, ?, ?, ?)'
      ).run(r.label, r.points, r.description ?? null, r.enabled ?? 1, i);
    });
  });

  replaceFn(rules);
  res.json({ ok: true });
});
```

- [ ] **Step 4: Run — expect PASS**
```bash
npx vitest run tests/dashboard/api.test.js
```

- [ ] **Step 5: Run full test suite — ensure nothing broken**
```bash
npx vitest run
```

- [ ] **Step 6: Commit**
```bash
git add dashboard/server.js tests/dashboard/api.test.js
git commit -m "feat: add GET/PUT /api/icp-rules with transactional bulk-replace"
```

---

## Chunk 3: Engine Updates

### Task 6: Update findLeads.js

**Files:**
- Modify: `findLeads.js`
- Modify: `tests/findLeads.test.js`

- [ ] **Step 1: Update test setup to seed config/niches/icp_rules**

In `tests/findLeads.test.js`, inside the `beforeEach` block, after `initSchema()`, add:

```js
const { seedConfigDefaults, seedNichesAndIcpRules, getDb } = await import('../utils/db.js');
seedConfigDefaults();
seedNichesAndIcpRules();
// Override: set enough batches/seeds for the test mock
getDb().prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('find_leads_batches', '1');
getDb().prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('find_leads_per_batch', '2');
getDb().prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('find_leads_enabled', '1');
```

Remove any `process.env` assignments for config values from findLeads test setup (there aren't any currently, but double-check).

- [ ] **Step 2: Run current test — confirm PASS before changes**
```bash
npx vitest run tests/findLeads.test.js
```

- [ ] **Step 3: Update `findLeads.js`**

Replace the hardcoded `NICHES` const and `getNicheForToday()` function at the top of the file:

**Remove:**
```js
const NICHES = {
  1: { label: '...', query: '...' },
  // ... all 6 entries
};

function getNicheForToday() {
  const dow = new Date().getDay();
  return NICHES[dow] || NICHES[1];
}
```

**Add:**
```js
import { getDb, logCron, finishCron, logError, bumpMetric, isRejected, today,
         getConfigMap, getConfigInt, getConfigStr } from './utils/db.js';

function getNicheForToday(db) {
  const dow = new Date().getDay();
  return db.prepare('SELECT * FROM niches WHERE day_of_week = ? AND enabled = 1 LIMIT 1').get(dow)
    || db.prepare('SELECT * FROM niches WHERE enabled = 1 ORDER BY sort_order LIMIT 1').get();
}

function buildIcpRubric(db) {
  const rules = db.prepare('SELECT * FROM icp_rules WHERE enabled = 1 ORDER BY sort_order').all();
  return rules.map(r => `${r.points > 0 ? '+' : ''}${r.points}  ${r.label}`).join('\n');
}
```

Update `stage9_icpScore` signature and body:

**Replace:**
```js
async function stage9_icpScore(lead) {
  const prompt = `Score this lead on the ICP rubric...
Rubric:
+3  India-based B2C-facing...
...
Priority: A=7-10, B=4-6, C=0-3
```

**With:**
```js
async function stage9_icpScore(lead, rubric, threshA, threshB) {
  const prompt = `Score this lead on the ICP rubric and return JSON {icp_score: number, icp_priority: "A"|"B"|"C", icp_reason: "brief explanation"}.

Rubric:
${rubric}

Priority: A=${threshA}-10, B=${threshB}-${threshA - 1}, C=below ${threshB} (including negative)

Lead data:
Company: ${lead.business_name}
Tech stack: ${JSON.stringify(lead.tech_stack) || 'unknown'}
Business signals: ${JSON.stringify(lead.business_signals) || 'none'}
City: ${lead.city}
Category: ${lead.category}
Quality score: ${lead.website_quality_score}

Return only valid JSON.`;
  const result = await callGemini(prompt);
  try {
    return { data: JSON.parse(stripJson(result.text)), costUsd: result.costUsd };
  } catch {
    return { data: { icp_score: 0, icp_priority: 'C', icp_reason: 'parse error' }, costUsd: result.costUsd };
  }
}
```

Update `stage10_hook` signature:

**Replace:**
```js
async function stage10_hook(lead) {
  const result = await callClaude('sonnet',
    `Write ONE sentence (max 20 words) that makes a hyper-specific observation about ${lead.business_name}'s website (${lead.website_url})...`
```

**With:**
```js
async function stage10_hook(lead, persona) {
  const result = await callClaude('sonnet',
    `Write ONE sentence (max 20 words) that makes a hyper-specific observation about ${lead.business_name}'s website (${lead.website_url}). Focus on something concrete you'd notice as a ${persona.role} — outdated tech, missing feature, design issue. No fluff, no compliments.`,
    { maxTokens: 60 }
  );
  return { hook: result.text.trim(), costUsd: result.costUsd, model: result.model };
}
```

Update `stage11_body` signature:

**Replace:**
```js
async function stage11_body(lead, hook) {
  const result = await callClaude('haiku',
    `Write a cold email from Darshan Parmar (Full-Stack Developer, Simple Inc) to ...`
```

**With:**
```js
async function stage11_body(lead, hook, persona) {
  const result = await callClaude('haiku',
    `Write a cold email from ${persona.name} (${persona.role}, ${persona.company}) to ${lead.contact_name || lead.owner_name || 'the owner'} at ${lead.business_name}.

Hook to open with: "${hook}"

Services context: ${persona.services}

Rules:
- Plain text only, no HTML
- 50-90 words total
- No links, no URLs
- CTA: ask to reply
- Tone: ${persona.tone}
- Do not mention price

Return only the email body, no subject line.`,
    { maxTokens: 200 }
  );
  return { body: result.text.trim(), costUsd: result.costUsd, model: result.model };
}
```

Update the main `findLeads()` function — replace the opening block:

**Replace:**
```js
export default async function findLeads() {
  const cronId = logCron('findLeads');
  let totalCost = 0;
  let leadsReady = 0;
  let leadsProcessed = 0;
  let leadsSkipped = 0;

  try {
    const niche = getNicheForToday();
    const db = getDb();

    // Stage 1: Discovery — 5 batches of 30 = 150 leads
    let rawLeads = [];
    for (let batch = 0; batch < 5; batch++) {
```

**With:**
```js
export default async function findLeads() {
  const cronId = logCron('findLeads');

  const cfg = getConfigMap();

  if (!getConfigInt(cfg, 'find_leads_enabled', 1)) {
    finishCron(cronId, { status: 'skipped' });
    return;
  }

  let totalCost = 0;
  let leadsReady = 0;
  let leadsProcessed = 0;
  let leadsSkipped = 0;

  try {
    const db = getDb();
    const niche = getNicheForToday(db);

    if (!niche) {
      finishCron(cronId, { status: 'failed', error: 'No enabled niches configured' });
      await sendAlert('findLeads failed: No enabled niches configured');
      return;
    }

    const batches = getConfigInt(cfg, 'find_leads_batches', 5);
    const perBatch = getConfigInt(cfg, 'find_leads_per_batch', 30);
    const rubric = buildIcpRubric(db);
    const threshA = getConfigInt(cfg, 'icp_threshold_a', 7);
    const threshB = getConfigInt(cfg, 'icp_threshold_b', 4);
    const persona = {
      name:     getConfigStr(cfg, 'persona_name',     'Darshan Parmar'),
      role:     getConfigStr(cfg, 'persona_role',     'Full-Stack Developer'),
      company:  getConfigStr(cfg, 'persona_company',  'Simple Inc'),
      tone:     getConfigStr(cfg, 'persona_tone',     'professional but direct'),
      services: getConfigStr(cfg, 'persona_services', ''),
    };

    // Stage 1: Discovery
    let rawLeads = [];
    for (let batch = 0; batch < batches; batch++) {
```

Also update the discovery prompt inside `stage1_discover` to use `perBatch` instead of hardcoded `30`:

In the `stage1_discover` function signature, add `perBatch` parameter:
```js
async function stage1_discover(niche, batchIndex, perBatch) {
  const prompt = `You are a B2B lead researcher. Discover ${perBatch} real Indian businesses...Batch ${batchIndex + 1} — find DIFFERENT businesses...`;
```

And the call site in `findLeads()`:
```js
const { leads: batchLeads, costUsd: discoverCost } = await stage1_discover(niche, batch, perBatch);
```

Update the ICP scoring call site (inside the lead loop):
```js
const { data: icp, costUsd: icpCost } = await stage9_icpScore(lead, rubric, threshA, threshB);
```

Update the priority check after ICP scoring:
```js
if (icp.icp_priority === 'C') {
```
This line stays the same — the priority label comes from Gemini's response which already uses A/B/C.

Update the hook and body call sites:
```js
const hookResult = await stage10_hook(lead, persona);
// ...
const [bodyResult, subjectResult] = await Promise.all([
  stage11_body(lead, hook, persona),
  stage11_subject(lead)
]);
```

- [ ] **Step 4: Run test — expect PASS**
```bash
npx vitest run tests/findLeads.test.js
```

- [ ] **Step 5: Commit**
```bash
git add findLeads.js tests/findLeads.test.js
git commit -m "feat: findLeads reads niche/ICP/persona/batches from DB config"
```

---

### Task 7: Update sendEmails.js

**Files:**
- Modify: `sendEmails.js`
- Modify: `tests/sendEmails.test.js`

- [ ] **Step 1: Update test setup**

In `tests/sendEmails.test.js`, inside `beforeEach`, after `initSchema()`, replace the `process.env.*` config assignments with DB seeding:

**Remove:**
```js
process.env.DAILY_SEND_LIMIT = '10';
process.env.BOUNCE_RATE_HARD_STOP = '0.02';
process.env.SEND_WINDOW_START_IST = '0';
process.env.SEND_WINDOW_END_IST = '23';
process.env.SEND_DELAY_MIN_MS = '1000';
process.env.SEND_DELAY_MAX_MS = '2000';
```

**Add (after `initSchema()` call):**
```js
const { seedConfigDefaults } = await import('../utils/db.js');
seedConfigDefaults();
// Override with test-friendly values
const cfgDb = getDb();
cfgDb.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('daily_send_limit', '10');
cfgDb.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('send_emails_enabled', '1');
cfgDb.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('bounce_rate_hard_stop', '0.02');
cfgDb.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('send_window_start', '0');
cfgDb.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('send_window_end', '23');
cfgDb.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('send_delay_min_ms', '1');
cfgDb.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('send_delay_max_ms', '2');
```

Keep `process.env.OUTREACH_DOMAIN`, `INBOX_1_USER`, `INBOX_2_USER` as-is (these are not moving to DB config).

**Also update any per-test `process.env` overrides inside individual `it()` blocks.** For example, tests that set `process.env.DAILY_SEND_LIMIT = '0'` to verify the engine skips must instead write to the config table before the dynamic import:
```js
cfgDb.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('daily_send_limit', '0');
const sendEmails = (await import('../sendEmails.js')).default;
```
Search `tests/sendEmails.test.js` for every `process.env.DAILY_SEND_LIMIT` assignment and replace it with the equivalent config table write.

**Retain the existing `if (dailyLimit === 0) { finishCron(cronId, { status: 'skipped' }); return; }` guard** in `sendEmails.js`. Do NOT remove it — it is the hard stop for the zero-limit case and is separate from the enabled toggle.

- [ ] **Step 2: Run current test — confirm PASS before engine changes**
```bash
npx vitest run tests/sendEmails.test.js
```

- [ ] **Step 3: Update `sendEmails.js`**

Update the import from `utils/db.js` to include config helpers:
```js
import { getDb, logCron, finishCron, logError, bumpMetric, isRejected, todaySentCount, todayBounceRate, today,
         getConfigMap, getConfigInt, getConfigFloat } from './utils/db.js';
```

At the top of the `sendEmails()` function (after `logCron`), add the config reads and enabled check:

```js
export default async function sendEmails() {
  const cronId = logCron('sendEmails');

  const cfg = getConfigMap();

  if (!getConfigInt(cfg, 'send_emails_enabled', 1)) {
    finishCron(cronId, { status: 'skipped' });
    return;
  }

  const dailyLimit    = getConfigInt(cfg,   'daily_send_limit',    parseInt(process.env.DAILY_SEND_LIMIT    || '0'));
  const maxPerInbox   = getConfigInt(cfg,   'max_per_inbox',       parseInt(process.env.MAX_PER_INBOX       || '17'));
  const delayMin      = getConfigInt(cfg,   'send_delay_min_ms',   parseInt(process.env.SEND_DELAY_MIN_MS   || '180000'));
  const delayMax      = getConfigInt(cfg,   'send_delay_max_ms',   parseInt(process.env.SEND_DELAY_MAX_MS   || '420000'));
  const windowStart   = getConfigInt(cfg,   'send_window_start',   parseInt(process.env.SEND_WINDOW_START_IST || '9'));
  const windowEnd     = getConfigInt(cfg,   'send_window_end',     parseInt(process.env.SEND_WINDOW_END_IST   || '17'));
  const bounceStop    = getConfigFloat(cfg, 'bounce_rate_hard_stop', parseFloat(process.env.BOUNCE_RATE_HARD_STOP || '0.02'));
```

Then replace all subsequent `process.env.*` reads throughout the function body with the local variables defined above. For example:
- `parseInt(process.env.DAILY_SEND_LIMIT || '0')` → `dailyLimit`
- `parseFloat(process.env.BOUNCE_RATE_HARD_STOP || '0.02')` → `bounceStop`
- etc.

Also update `inSendWindow()` function in `sendEmails.js` (if it reads from env) to accept and use `windowStart`/`windowEnd` parameters, or read directly from the config variables in scope.

- [ ] **Step 4: Run tests — expect PASS**
```bash
npx vitest run tests/sendEmails.test.js
```

- [ ] **Step 5: Commit**
```bash
git add sendEmails.js tests/sendEmails.test.js
git commit -m "feat: sendEmails reads config from DB with process.env fallback"
```

---

### Task 8: Update sendFollowups.js and checkReplies.js

**Files:**
- Modify: `sendFollowups.js`
- Modify: `checkReplies.js`
- Modify: `tests/sendFollowups.test.js`
- Modify: `tests/checkReplies.test.js`

- [ ] **Step 1: Update `tests/sendFollowups.test.js` setup**

Same pattern as sendEmails.test.js — after `initSchema()`, seed config:
```js
const { seedConfigDefaults } = await import('../utils/db.js');
seedConfigDefaults();
const cfgDb = getDb();
cfgDb.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('daily_send_limit', '10');
cfgDb.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('send_followups_enabled', '1');
cfgDb.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('bounce_rate_hard_stop', '0.02');
cfgDb.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('send_window_start', '0');
cfgDb.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('send_window_end', '23');
cfgDb.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('send_delay_min_ms', '1');
cfgDb.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('send_delay_max_ms', '2');
```
Remove the corresponding `process.env.*` assignments.

**Also update per-test `process.env.DAILY_SEND_LIMIT` assignments inside individual `it()` blocks** (same pattern as Task 7 — replace with `cfgDb.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('daily_send_limit', '0')` before the dynamic import).

- [ ] **Step 2: Run test — confirm PASS before engine changes**
```bash
npx vitest run tests/sendFollowups.test.js
```

- [ ] **Step 3: Update `sendFollowups.js`**

Update import to include config helpers. At the top of `sendFollowups()`, add:

```js
const cfg = getConfigMap();

if (!getConfigInt(cfg, 'send_followups_enabled', 1)) {
  finishCron(cronId, { status: 'skipped' });
  return;
}

const dailyLimit  = getConfigInt(cfg,   'daily_send_limit',     parseInt(process.env.DAILY_SEND_LIMIT    || '0'));
const delayMin    = getConfigInt(cfg,   'send_delay_min_ms',    parseInt(process.env.SEND_DELAY_MIN_MS   || '180000'));
const delayMax    = getConfigInt(cfg,   'send_delay_max_ms',    parseInt(process.env.SEND_DELAY_MAX_MS   || '420000'));
const windowStart = getConfigInt(cfg,   'send_window_start',    parseInt(process.env.SEND_WINDOW_START_IST || '9'));
const windowEnd   = getConfigInt(cfg,   'send_window_end',      parseInt(process.env.SEND_WINDOW_END_IST   || '17'));
const bounceStop  = getConfigFloat(cfg, 'bounce_rate_hard_stop', parseFloat(process.env.BOUNCE_RATE_HARD_STOP || '0.02'));
```

**Remove the existing** `dailyLimit` read at the old location:
```js
// REMOVE THIS:
const dailyLimit = parseInt(process.env.DAILY_SEND_LIMIT || '0');
if (dailyLimit === 0) { ... }
```
The enabled check above replaces the `dailyLimit === 0` guard.

Update `inSendWindow()` to use `windowStart`/`windowEnd` variables instead of `process.env.*`:
```js
function inSendWindow(windowStart, windowEnd) {
  // ... same logic but use parameters instead of process.env reads
  const start = windowStart + 0.5;
  const end   = windowEnd   + 0.5;
  return currentTime >= start && currentTime < end;
}
```
Update call site: `if (!inSendWindow(windowStart, windowEnd)) {`

Replace all remaining `process.env.*` reads with the local config variables.

Also update `STEP_PROMPTS` to use persona from config. Add persona reads after cfg:
```js
const personaName = getConfigStr(cfg, 'persona_name', 'Darshan Parmar');
```
Update each prompt in `STEP_PROMPTS` from hardcoded `"Darshan Parmar"` to `personaName`. Since `STEP_PROMPTS` is a module-level const using arrow functions, convert it to a function that accepts `personaName`:
```js
function buildStepPrompts(personaName) {
  return {
    1: (lead) => `Write a very short follow-up email... from ${personaName} to ${lead.contact_name || 'the owner'}...`,
    2: (lead) => `Write a follow-up email... from ${personaName} to ${lead.contact_name || 'the owner'}...`,
    3: (lead) => `Write a final breakup email... from ${personaName} to ${lead.contact_name || 'the owner'}...`,
    4: (lead) => `Write a quarterly check-in email... from ${personaName} to ${lead.contact_name || 'the owner'}...`,
  };
}
```
Call it inside `sendFollowups()` after reading persona: `const STEP_PROMPTS = buildStepPrompts(personaName);`

- [ ] **Step 4: Update `checkReplies.js`**

Update import to include config helpers. Add at the top of the main export function:
```js
const cfg = getConfigMap();
if (!getConfigInt(cfg, 'check_replies_enabled', 1)) {
  finishCron(cronId, { status: 'skipped' });
  return;
}
```

- [ ] **Step 5: Update `tests/checkReplies.test.js`** — add `seedConfigDefaults()` and seed `check_replies_enabled=1` after `initSchema()`.

- [ ] **Step 6: Run all engine tests**
```bash
npx vitest run tests/sendFollowups.test.js tests/checkReplies.test.js tests/findLeads.test.js tests/sendEmails.test.js
```
Expected: all pass.

- [ ] **Step 7: Run full suite**
```bash
npx vitest run
```
Expected: all pass.

- [ ] **Step 8: Commit**
```bash
git add sendFollowups.js checkReplies.js tests/sendFollowups.test.js tests/checkReplies.test.js
git commit -m "feat: sendFollowups and checkReplies read config from DB; all engines have enabled checks"
```

---

## Chunk 4: Frontend

### Task 9: API methods + routing + sidebar

**Files:**
- Modify: `dashboard/src/api.js`
- Modify: `dashboard/src/App.jsx`
- Modify: `dashboard/src/components/Sidebar.jsx`

No unit tests for these — verified manually via dev server.

- [ ] **Step 1: Add Settings API methods to `dashboard/src/api.js`**

Add to the `api` export object:

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

- [ ] **Step 2: Add routes to `dashboard/src/App.jsx`**

Add imports at the top:
```jsx
import NicheManager from './pages/NicheManager';
import EngineConfig from './pages/EngineConfig';
import IcpRules from './pages/IcpRules';
import EmailPersona from './pages/EmailPersona';
```

Add inside the `<Route element={<ProtectedLayout />}>` block:
```jsx
<Route path="/settings" element={<Navigate to="/settings/niches" replace />} />
<Route path="/settings/niches"  element={<NicheManager />} />
<Route path="/settings/engines" element={<EngineConfig />} />
<Route path="/settings/icp"     element={<IcpRules />} />
<Route path="/settings/persona" element={<EmailPersona />} />
```

- [ ] **Step 3: Update `dashboard/src/components/Sidebar.jsx`**

Add `useLocation` to the import:
```jsx
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
```

Add settings nav items constant:
```js
const settingsItems = [
  { path: '/settings/niches',  label: 'Niches' },
  { path: '/settings/engines', label: 'Engines' },
  { path: '/settings/icp',     label: 'ICP Rubric' },
  { path: '/settings/persona', label: 'Persona' },
];
```

In the component body, add:
```js
const location = useLocation();
const [settingsOpen, setSettingsOpen] = useState(location.pathname.startsWith('/settings'));
```

In the JSX, add before `<div className="sidebar-footer">`:
```jsx
<div className="sidebar-section">
  <button
    className={`sidebar-link sidebar-section-toggle ${location.pathname.startsWith('/settings') ? 'active' : ''}`}
    onClick={() => setSettingsOpen(o => !o)}
  >
    <span className="icon">⚙</span>
    Settings
    <span className="sidebar-chevron">{settingsOpen ? '▾' : '▸'}</span>
  </button>
  {settingsOpen && settingsItems.map(item => (
    <NavLink
      key={item.path}
      to={item.path}
      className={({ isActive }) => `sidebar-link sidebar-sublink ${isActive ? 'active' : ''}`}
    >
      {item.label}
    </NavLink>
  ))}
</div>
```

Add CSS to `dashboard/src/index.css`:
```css
.sidebar-section-toggle {
  width: 100%;
  background: none;
  border: none;
  cursor: pointer;
  text-align: left;
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  color: var(--text-2);
  font-family: var(--font-mono);
  font-size: 12px;
  padding: 10px 20px;
  border-radius: var(--radius-md);
  transition: background 0.15s, color 0.15s;
}
.sidebar-section-toggle:hover { background: var(--bg-hover); color: var(--text-1); }
.sidebar-section-toggle.active { color: var(--green); }
.sidebar-chevron { margin-left: auto; font-size: 10px; }
.sidebar-sublink {
  padding-left: 40px !important;
  font-size: 11px;
}
```

- [ ] **Step 4: Create placeholder stubs for all 4 pages** (so routes don't crash):

Create `dashboard/src/pages/NicheManager.jsx`:
```jsx
import React from 'react';
export default function NicheManager() {
  return <div><h1 className="page-title">Niches</h1><p className="td-muted">Loading…</p></div>;
}
```

Repeat for `EngineConfig.jsx`, `IcpRules.jsx`, `EmailPersona.jsx` with appropriate titles.

- [ ] **Step 5: Build and verify routing works**
```bash
cd dashboard && npm run build
```
Expected: clean build, no errors.

- [ ] **Step 6: Commit**
```bash
git add dashboard/src/api.js dashboard/src/App.jsx dashboard/src/components/Sidebar.jsx \
        dashboard/src/pages/NicheManager.jsx dashboard/src/pages/EngineConfig.jsx \
        dashboard/src/pages/IcpRules.jsx dashboard/src/pages/EmailPersona.jsx \
        dashboard/src/index.css
git commit -m "feat: add settings routes, sidebar group, and API methods"
```

---

### Task 10: Build NicheManager.jsx

**Files:**
- Modify: `dashboard/src/pages/NicheManager.jsx`

- [ ] **Step 1: Implement `NicheManager.jsx`**

```jsx
import React, { useEffect, useState } from 'react';
import { api } from '../api';

const DAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const emptyForm = { label: '', query: '', day_of_week: null, enabled: 1 };

export default function NicheManager() {
  const [niches, setNiches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // null | { mode: 'add'|'edit', data: {...} }
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(null); // niche id

  function load() {
    api.getNiches().then(d => { setNiches(d?.niches || []); setLoading(false); });
  }
  useEffect(load, []);

  function openAdd() { setModal({ mode: 'add', data: { ...emptyForm } }); setError(''); }
  function openEdit(n) { setModal({ mode: 'edit', data: { ...n } }); setError(''); }
  function closeModal() { setModal(null); setError(''); }

  async function handleSave() {
    const { label, query, day_of_week, enabled } = modal.data;
    if (!label.trim()) return setError('Label is required.');
    if (!query.trim() || query.trim().length < 10) return setError('Query must be at least 10 characters.');

    // Check conflict
    const conflicting = niches.find(n => n.day_of_week === day_of_week && day_of_week !== null && n.id !== modal.data.id);

    setSaving(true);
    const payload = { label: label.trim(), query: query.trim(), day_of_week, enabled };
    if (modal.mode === 'add') {
      await api.createNiche(payload);
    } else {
      await api.updateNiche(modal.data.id, payload);
    }
    setSaving(false);
    closeModal();
    load();
  }

  async function handleToggle(niche) {
    await api.updateNiche(niche.id, { ...niche, enabled: niche.enabled ? 0 : 1 });
    load();
  }

  async function handleDelete(id) {
    await api.deleteNiche(id);
    setDeleteConfirm(null);
    load();
  }

  const scheduleGrid = [1, 2, 3, 4, 5, 6].map(day => ({
    day,
    label: DAYS[day],
    niche: niches.find(n => n.day_of_week === day) || null
  }));

  return (
    <div>
      <h1 className="page-title">Niche Manager</h1>

      {/* Weekly schedule grid */}
      <div className="section-label" style={{ marginBottom: '12px' }}>Weekly Schedule</div>
      <div className="niche-grid">
        {scheduleGrid.map(({ day, label, niche }) => (
          <div
            key={day}
            className={`niche-day-card ${niche ? 'has-niche' : 'empty'}`}
            onClick={() => niche ? openEdit(niche) : openAdd()}
          >
            <div className="niche-day-label">{label}</div>
            {niche ? (
              <>
                <div className="niche-day-name">{niche.label}</div>
                <div className="niche-day-query">{niche.query.slice(0, 60)}…</div>
                <span className={`badge ${niche.enabled ? 'badge-green' : 'badge-muted'}`}>
                  {niche.enabled ? 'enabled' : 'disabled'}
                </span>
              </>
            ) : (
              <div className="niche-day-empty">+ Assign</div>
            )}
          </div>
        ))}
      </div>

      {/* Niche pool table */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '32px 0 12px' }}>
        <div className="section-label">All Niches</div>
        <button className="btn-primary" onClick={openAdd}>+ Add Niche</button>
      </div>

      {loading ? <div className="td-muted">Loading…</div> : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Label</th>
                <th>Query</th>
                <th>Day</th>
                <th>Enabled</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {niches.map(n => (
                <tr key={n.id}>
                  <td>{n.label}</td>
                  <td className="td-muted" style={{ maxWidth: '320px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.query}</td>
                  <td className="td-muted">{n.day_of_week ? DAYS[n.day_of_week] : <span className="td-dim">Unassigned</span>}</td>
                  <td>
                    <button
                      className={`badge ${n.enabled ? 'badge-green' : 'badge-muted'}`}
                      style={{ cursor: 'pointer', border: 'none', background: 'none' }}
                      onClick={() => handleToggle(n)}
                    >
                      {n.enabled ? 'enabled' : 'disabled'}
                    </button>
                  </td>
                  <td style={{ display: 'flex', gap: '8px' }}>
                    <button className="btn-ghost" onClick={() => openEdit(n)}>Edit</button>
                    {deleteConfirm === n.id ? (
                      <>
                        <span className="td-dim" style={{ fontSize: '11px', alignSelf: 'center' }}>Confirm delete?</span>
                        <button className="btn-danger" onClick={() => handleDelete(n.id)}>Yes</button>
                        <button className="btn-ghost" onClick={() => setDeleteConfirm(null)}>No</button>
                      </>
                    ) : (
                      <button className="btn-ghost btn-ghost-red" onClick={() => setDeleteConfirm(n.id)}>Delete</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add/Edit Modal */}
      {modal && (
        <>
          <div className="detail-overlay" onClick={closeModal} />
          <div className="detail-panel" style={{ maxWidth: '500px' }}>
            <button className="detail-close" onClick={closeModal}>✕</button>
            <h2 className="detail-title">{modal.mode === 'add' ? 'Add Niche' : 'Edit Niche'}</h2>

            {error && <div className="login-error" style={{ marginBottom: '12px' }}>{error}</div>}

            <div className="detail-label">Label</div>
            <input
              className="input"
              style={{ width: '100%', marginBottom: '12px' }}
              value={modal.data.label}
              onChange={e => setModal(m => ({ ...m, data: { ...m.data, label: e.target.value } }))}
              placeholder="e.g. Real estate agencies"
            />

            <div className="detail-label">Search Query</div>
            <textarea
              className="input"
              style={{ width: '100%', minHeight: '72px', marginBottom: '12px', resize: 'vertical' }}
              value={modal.data.query}
              onChange={e => setModal(m => ({ ...m, data: { ...m.data, query: e.target.value } }))}
              placeholder="Gemini grounding query used to discover leads"
            />

            <div className="detail-label">Assign to Day</div>
            <select
              className="select"
              style={{ width: '100%', marginBottom: '8px' }}
              value={modal.data.day_of_week ?? ''}
              onChange={e => setModal(m => ({ ...m, data: { ...m.data, day_of_week: e.target.value ? parseInt(e.target.value) : null } }))}
            >
              <option value="">Unassigned</option>
              {[1,2,3,4,5,6].map(d => <option key={d} value={d}>{DAYS[d]}</option>)}
            </select>

            {/* Conflict warning */}
            {(() => {
              const conflict = niches.find(n => n.day_of_week === modal.data.day_of_week && modal.data.day_of_week !== null && n.id !== modal.data.id);
              return conflict ? (
                <div className="td-dim" style={{ fontSize: '11px', marginBottom: '8px', color: 'var(--amber)' }}>
                  ⚠ {DAYS[modal.data.day_of_week]} already has "{conflict.label}" — it will become Unassigned.
                </div>
              ) : null;
            })()}

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px' }}>
              <input
                type="checkbox"
                id="niche-enabled"
                checked={!!modal.data.enabled}
                onChange={e => setModal(m => ({ ...m, data: { ...m.data, enabled: e.target.checked ? 1 : 0 } }))}
              />
              <label htmlFor="niche-enabled" className="td-muted">Enabled</label>
            </div>

            <button className="login-btn" style={{ width: '100%' }} onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save Niche'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
```

Add required CSS to `dashboard/src/index.css`:
```css
/* ── Niche Manager ────────────────────────────────────────── */
.niche-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: var(--space-md);
  margin-bottom: var(--space-xl);
}
.niche-day-card {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: var(--space-md);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
  min-height: 120px;
}
.niche-day-card:hover { border-color: var(--green); background: var(--bg-elevated); }
.niche-day-card.empty { border-style: dashed; opacity: 0.6; }
.niche-day-label { font-size: 10px; color: var(--text-4); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
.niche-day-name { font-size: 12px; color: var(--text-1); font-weight: 500; margin-bottom: 4px; }
.niche-day-query { font-size: 10px; color: var(--text-3); margin-bottom: 8px; line-height: 1.4; }
.niche-day-empty { font-size: 11px; color: var(--text-4); margin-top: 16px; }
.section-label { font-size: 10px; color: var(--text-4); text-transform: uppercase; letter-spacing: 1.5px; }
.btn-primary {
  background: var(--green);
  color: var(--bg-deep);
  border: none;
  padding: 6px 14px;
  border-radius: var(--radius-md);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  letter-spacing: 0.5px;
}
.btn-primary:hover { background: var(--green-bright); }
.btn-ghost {
  background: transparent;
  color: var(--text-3);
  border: 1px solid var(--border);
  padding: 4px 10px;
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: 11px;
  cursor: pointer;
}
.btn-ghost:hover { color: var(--text-1); border-color: var(--border-light); }
.btn-ghost-red:hover { color: var(--red); border-color: var(--red); }
.btn-danger {
  background: var(--red-dim);
  color: var(--red);
  border: 1px solid var(--red);
  padding: 4px 10px;
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: 11px;
  cursor: pointer;
}
```

- [ ] **Step 2: Build**
```bash
cd dashboard && npm run build
```
Expected: clean build.

- [ ] **Step 3: Commit**
```bash
git add dashboard/src/pages/NicheManager.jsx dashboard/src/index.css
git commit -m "feat: build NicheManager page with weekly grid and CRUD"
```

---

### Task 11: Build EngineConfig.jsx

**Files:**
- Modify: `dashboard/src/pages/EngineConfig.jsx`

- [ ] **Step 1: Implement `EngineConfig.jsx`**

```jsx
import React, { useEffect, useState } from 'react';
import { api } from '../api';

const ENGINE_CARDS = [
  {
    key: 'findLeads',
    enabledKey: 'find_leads_enabled',
    title: 'findLeads.js',
    schedule: 'Runs: 09:00 AM daily (Mon–Sat)',
    fields: [
      { key: 'find_leads_batches',   label: 'Batches per run',  type: 'int' },
      { key: 'find_leads_per_batch', label: 'Leads per batch',  type: 'int' },
    ]
  },
  {
    key: 'sendEmails',
    enabledKey: 'send_emails_enabled',
    title: 'sendEmails.js',
    schedule: 'Runs: 09:30 AM daily (Mon–Sat)',
    fields: [
      { key: 'daily_send_limit',     label: 'Daily send limit',      type: 'int' },
      { key: 'max_per_inbox',        label: 'Max per inbox',         type: 'int' },
      { key: 'send_delay_min_ms',    label: 'Delay min (ms)',        type: 'int' },
      { key: 'send_delay_max_ms',    label: 'Delay max (ms)',        type: 'int' },
      { key: 'send_window_start',    label: 'Window start (IST hr)', type: 'int' },
      { key: 'send_window_end',      label: 'Window end (IST hr)',   type: 'int' },
      { key: 'bounce_rate_hard_stop',label: 'Bounce hard stop',      type: 'float' },
      { key: 'claude_daily_spend_cap', label: 'Claude spend cap (USD)', type: 'float', readonly: true },
    ]
  },
  {
    key: 'sendFollowups',
    enabledKey: 'send_followups_enabled',
    title: 'sendFollowups.js',
    schedule: 'Runs: 06:00 PM daily (Mon–Sat)',
    fields: []
  },
  {
    key: 'checkReplies',
    enabledKey: 'check_replies_enabled',
    title: 'checkReplies.js',
    schedule: 'Runs: 2PM / 4PM / 8PM daily',
    fields: []
  },
];

function EngineCard({ card, cfg, onSaved }) {
  const [values, setValues] = useState({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const initial = {};
    card.fields.forEach(f => { initial[f.key] = cfg[f.key] ?? ''; });
    setValues(initial);
  }, [cfg, card.fields]);

  const enabled = cfg[card.enabledKey] !== '0';

  async function handleToggle() {
    await api.updateConfig({ [card.enabledKey]: enabled ? '0' : '1' });
    onSaved();
  }

  async function handleSave() {
    await api.updateConfig(values);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    onSaved();
  }

  const sendLimitZeroWarning = card.key === 'sendEmails' && enabled && parseInt(values.daily_send_limit) === 0;

  return (
    <div className="engine-card">
      <div className="engine-card-header">
        <span className="engine-card-title">{card.title}</span>
        <button
          className={`engine-toggle ${enabled ? 'on' : 'off'}`}
          onClick={handleToggle}
        >
          {enabled ? '🟢 ON' : '⚫ OFF'}
        </button>
      </div>
      <div className="engine-card-schedule">{card.schedule}</div>

      {sendLimitZeroWarning && (
        <div className="engine-warning">⚠ Send limit is 0 — no emails will be sent. Increase to activate.</div>
      )}

      {card.fields.map(f => (
        <div key={f.key} className="engine-field-row">
          <label className="engine-field-label">{f.label}</label>
          {f.readonly ? (
            <span className="engine-field-readonly">{values[f.key]} <span className="td-dim">(enforcement Phase 2)</span></span>
          ) : (
            <input
              className="input"
              style={{ width: '110px' }}
              value={values[f.key] ?? ''}
              onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}
            />
          )}
        </div>
      ))}

      {card.fields.some(f => !f.readonly) && (
        <div style={{ marginTop: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button className="btn-primary" onClick={handleSave}>Save Changes</button>
          {saved && <span className="saved-confirm">Saved ✓</span>}
        </div>
      )}
    </div>
  );
}

export default function EngineConfig() {
  const [cfg, setCfg] = useState(null);

  function load() { api.getConfig().then(d => setCfg(d)); }
  useEffect(load, []);

  if (!cfg) return <div><h1 className="page-title">Engine Config</h1><div className="td-muted">Loading…</div></div>;

  return (
    <div>
      <h1 className="page-title">Engine Config</h1>
      <div className="engine-grid">
        {ENGINE_CARDS.map(card => (
          <EngineCard key={card.key} card={card} cfg={cfg} onSaved={load} />
        ))}
      </div>
    </div>
  );
}
```

Add CSS to `dashboard/src/index.css`:
```css
/* ── Engine Config ────────────────────────────────────────── */
.engine-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-lg);
}
.engine-card {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: var(--space-lg);
}
.engine-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}
.engine-card-title { font-family: var(--font-mono); font-size: 13px; font-weight: 600; color: var(--text-1); }
.engine-card-schedule { font-size: 10px; color: var(--text-4); margin-bottom: 16px; }
.engine-toggle {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 12px;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
}
.engine-toggle:hover { background: var(--bg-hover); }
.engine-field-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}
.engine-field-label { font-size: 11px; color: var(--text-2); }
.engine-field-readonly { font-size: 11px; color: var(--text-3); }
.engine-warning {
  background: var(--amber-dim);
  border: 1px solid var(--amber);
  color: var(--amber);
  font-size: 11px;
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  margin-bottom: 12px;
}
.saved-confirm { color: var(--green); font-size: 11px; }
```

- [ ] **Step 2: Build**
```bash
cd dashboard && npm run build
```

- [ ] **Step 3: Commit**
```bash
git add dashboard/src/pages/EngineConfig.jsx dashboard/src/index.css
git commit -m "feat: build EngineConfig page with per-engine cards and toggles"
```

---

### Task 12: Build IcpRules.jsx

**Files:**
- Modify: `dashboard/src/pages/IcpRules.jsx`

- [ ] **Step 1: Implement `IcpRules.jsx`**

```jsx
import React, { useEffect, useState } from 'react';
import { api } from '../api';

const VALID_POINTS = [-3, -2, -1, 1, 2, 3];

export default function IcpRules() {
  const [rules, setRules] = useState([]);
  const [threshA, setThreshA] = useState(7);
  const [threshB, setThreshB] = useState(4);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editingId, setEditingId] = useState(null);

  function load() {
    Promise.all([api.getIcpRules(), api.getConfig()]).then(([rulesData, cfg]) => {
      setRules(rulesData?.rules || []);
      setThreshA(parseInt(cfg?.icp_threshold_a ?? 7));
      setThreshB(parseInt(cfg?.icp_threshold_b ?? 4));
      setLoading(false);
    });
  }
  useEffect(load, []);

  function addRule() {
    const newRule = { id: null, label: 'New rule', points: 1, description: '', enabled: 1, sort_order: rules.length };
    setRules(r => [...r, newRule]);
    setEditingId('new-' + Date.now());
  }

  function updateRule(index, field, value) {
    setRules(r => r.map((rule, i) => i === index ? { ...rule, [field]: value } : rule));
  }

  function removeRule(index) {
    setRules(r => r.filter((_, i) => i !== index));
  }

  function moveUp(index) {
    if (index === 0) return;
    setRules(r => {
      const next = [...r];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  }

  function moveDown(index) {
    setRules(r => {
      if (index >= r.length - 1) return r;
      const next = [...r];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    await Promise.all([
      api.updateIcpRules(rules.map(r => ({ label: r.label, points: r.points, description: r.description || null, enabled: r.enabled }))),
      api.updateConfig({ icp_threshold_a: String(threshA), icp_threshold_b: String(threshB) })
    ]);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    load();
  }

  if (loading) return <div><h1 className="page-title">ICP Rubric</h1><div className="td-muted">Loading…</div></div>;

  return (
    <div>
      <h1 className="page-title">ICP Rubric</h1>

      <div className="icp-rules-list">
        {rules.map((rule, i) => (
          <div key={i} className="icp-rule-row">
            <div className="icp-rule-order">
              <button className="btn-ghost" style={{ padding: '2px 6px' }} onClick={() => moveUp(i)} disabled={i === 0}>▲</button>
              <button className="btn-ghost" style={{ padding: '2px 6px' }} onClick={() => moveDown(i)} disabled={i === rules.length - 1}>▼</button>
            </div>

            <select
              className="select"
              style={{ width: '64px', color: rule.points > 0 ? 'var(--green)' : 'var(--red)' }}
              value={rule.points}
              onChange={e => updateRule(i, 'points', parseInt(e.target.value))}
            >
              {VALID_POINTS.map(p => (
                <option key={p} value={p} style={{ color: p > 0 ? 'var(--green)' : 'var(--red)' }}>
                  {p > 0 ? `+${p}` : p}
                </option>
              ))}
            </select>

            <div className="icp-rule-content">
              <input
                className="input"
                style={{ width: '100%', marginBottom: '4px' }}
                value={rule.label}
                onChange={e => updateRule(i, 'label', e.target.value)}
                placeholder="Rule label"
              />
              <input
                className="input"
                style={{ width: '100%', fontSize: '11px' }}
                value={rule.description || ''}
                onChange={e => updateRule(i, 'description', e.target.value)}
                placeholder="Description (optional)"
              />
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'var(--text-3)', cursor: 'pointer', flexShrink: 0 }}>
              <input type="checkbox" checked={!!rule.enabled} onChange={e => updateRule(i, 'enabled', e.target.checked ? 1 : 0)} />
              enabled
            </label>

            <button className="btn-ghost btn-ghost-red" style={{ flexShrink: 0 }} onClick={() => removeRule(i)}>✕</button>
          </div>
        ))}
      </div>

      <button className="btn-ghost" style={{ marginTop: '12px' }} onClick={addRule}>+ Add Rule</button>

      {/* Priority thresholds */}
      <div className="icp-thresholds">
        <div className="section-label" style={{ marginBottom: '12px' }}>Priority Thresholds</div>
        <div className="icp-threshold-row">
          <span className="badge badge-green">A</span>
          <span className="td-muted">score ≥</span>
          <input className="input" style={{ width: '60px' }} type="number" value={threshA} onChange={e => setThreshA(parseInt(e.target.value) || 7)} />
        </div>
        <div className="icp-threshold-row">
          <span className="badge badge-blue">B</span>
          <span className="td-muted">score ≥</span>
          <input className="input" style={{ width: '60px' }} type="number" value={threshB} onChange={e => setThreshB(parseInt(e.target.value) || 4)} />
        </div>
        <div className="icp-threshold-row">
          <span className="badge badge-muted">C</span>
          <span className="td-muted">score &lt; {threshB} (auto)</span>
        </div>
      </div>

      <div style={{ marginTop: '24px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <button className="btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save All Rules'}
        </button>
        {saved && <span className="saved-confirm">Saved ✓</span>}
      </div>
    </div>
  );
}
```

Add CSS:
```css
/* ── ICP Rules ────────────────────────────────────────────── */
.icp-rules-list { display: flex; flex-direction: column; gap: 8px; max-width: 760px; }
.icp-rule-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 10px 12px;
}
.icp-rule-order { display: flex; flex-direction: column; gap: 2px; flex-shrink: 0; }
.icp-rule-content { flex: 1; min-width: 0; }
.icp-thresholds {
  margin-top: 32px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: var(--space-lg);
  max-width: 360px;
}
.icp-threshold-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}
```

- [ ] **Step 2: Build**
```bash
cd dashboard && npm run build
```

- [ ] **Step 3: Commit**
```bash
git add dashboard/src/pages/IcpRules.jsx dashboard/src/index.css
git commit -m "feat: build IcpRules page with inline editing and priority thresholds"
```

---

### Task 13: Build EmailPersona.jsx

**Files:**
- Modify: `dashboard/src/pages/EmailPersona.jsx`

- [ ] **Step 1: Implement `EmailPersona.jsx`**

```jsx
import React, { useEffect, useState } from 'react';
import { api } from '../api';

const TONE_OPTIONS = [
  { value: 'professional but direct', label: 'Professional but direct' },
  { value: 'casual and friendly',     label: 'Casual and friendly' },
  { value: 'formal and corporate',    label: 'Formal and corporate' },
  { value: 'custom',                  label: 'Custom…' },
];

export default function EmailPersona() {
  const [form, setForm] = useState({
    persona_name: '', persona_role: '', persona_company: '',
    persona_website: '', persona_tone: 'professional but direct',
    persona_services: '', persona_custom_tone: ''
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.getConfig().then(cfg => {
      if (!cfg) return;
      const knownTones = TONE_OPTIONS.slice(0, 3).map(t => t.value);
      const isCustom = cfg.persona_tone && !knownTones.includes(cfg.persona_tone);
      setForm({
        persona_name:     cfg.persona_name     || '',
        persona_role:     cfg.persona_role     || '',
        persona_company:  cfg.persona_company  || '',
        persona_website:  cfg.persona_website  || '',
        persona_tone:     isCustom ? 'custom' : (cfg.persona_tone || 'professional but direct'),
        persona_services: cfg.persona_services || '',
        persona_custom_tone: isCustom ? cfg.persona_tone : '',
      });
      setLoading(false);
    });
  }, []);

  function set(field, value) { setForm(f => ({ ...f, [field]: value })); }

  async function handleSave() {
    setSaving(true);
    const effectiveTone = form.persona_tone === 'custom' ? form.persona_custom_tone : form.persona_tone;
    await api.updateConfig({
      persona_name:     form.persona_name,
      persona_role:     form.persona_role,
      persona_company:  form.persona_company,
      persona_website:  form.persona_website,
      persona_tone:     effectiveTone,
      persona_services: form.persona_services,
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  if (loading) return <div><h1 className="page-title">Email Persona</h1><div className="td-muted">Loading…</div></div>;

  return (
    <div style={{ maxWidth: '540px' }}>
      <h1 className="page-title">Email Persona</h1>
      <p className="td-muted" style={{ marginBottom: '24px', fontSize: '12px' }}>
        These values are injected into every Claude prompt when generating hooks and email bodies.
      </p>

      <div className="persona-form">
        {[
          { key: 'persona_name',    label: 'Your name' },
          { key: 'persona_role',    label: 'Role' },
          { key: 'persona_company', label: 'Company' },
          { key: 'persona_website', label: 'Website' },
        ].map(({ key, label }) => (
          <div key={key} className="persona-field">
            <label className="engine-field-label">{label}</label>
            <input
              className="input"
              style={{ flex: 1 }}
              value={form[key]}
              onChange={e => set(key, e.target.value)}
            />
          </div>
        ))}

        <div className="persona-field">
          <label className="engine-field-label">Tone</label>
          <select className="select" style={{ flex: 1 }} value={form.persona_tone} onChange={e => set('persona_tone', e.target.value)}>
            {TONE_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>

        {form.persona_tone === 'custom' && (
          <div className="persona-field">
            <label className="engine-field-label">Custom tone</label>
            <input
              className="input"
              style={{ flex: 1 }}
              value={form.persona_custom_tone}
              onChange={e => set('persona_custom_tone', e.target.value)}
              placeholder="e.g. confident and concise"
            />
          </div>
        )}

        <div className="persona-field" style={{ alignItems: 'flex-start' }}>
          <label className="engine-field-label" style={{ paddingTop: '6px' }}>Services offered</label>
          <textarea
            className="input"
            style={{ flex: 1, minHeight: '90px', resize: 'vertical' }}
            value={form.persona_services}
            onChange={e => set('persona_services', e.target.value)}
            placeholder="Claude uses this as context when writing hooks and email bodies"
          />
        </div>
      </div>

      <div style={{ marginTop: '24px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <button className="btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save Persona'}
        </button>
        {saved && <span className="saved-confirm">Saved ✓</span>}
      </div>
    </div>
  );
}
```

Add CSS:
```css
/* ── Email Persona ────────────────────────────────────────── */
.persona-form { display: flex; flex-direction: column; gap: 14px; }
.persona-field { display: flex; align-items: center; gap: 16px; }
.persona-field .engine-field-label { width: 140px; flex-shrink: 0; }
```

- [ ] **Step 2: Final build and full test run**
```bash
npx vitest run
cd dashboard && npm run build
```
Expected: all tests pass, clean build.

- [ ] **Step 3: Final commit**
```bash
git add dashboard/src/pages/EmailPersona.jsx dashboard/src/index.css
git commit -m "feat: build EmailPersona page"
```

- [ ] **Step 4: Verify everything is committed**
```bash
git status
```
Expected: clean working tree. If any files are untracked or modified, add them explicitly by name (never `git add -A` as `.env` is modified and must never be committed).
