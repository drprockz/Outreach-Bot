# Async 500-Lead Pipeline Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor `findLeads.js` to process 500 leads concurrently using a `withConcurrency` pool, reducing pipeline runtime from ~60 min to ~4-6 min.

**Architecture:** A new `utils/concurrency.js` utility keeps N async slots in-flight simultaneously. `findLeads.js` is restructured into four sequential `withConcurrency` passes (extract → verify → score → write), each filtering survivors for the next stage. Dedup guards are pre-loaded into in-memory Sets before any concurrent work begins.

**Tech Stack:** Node.js 20 ESM, better-sqlite3, Vitest, Gemini 2.5 Flash, Claude Sonnet/Haiku

**Spec:** `docs/superpowers/specs/2026-04-12-async-500-lead-pipeline-design.md`

---

## Chunk 1: `utils/concurrency.js`

### Task 1: Write failing tests for `withConcurrency`

**Files:**
- Create: `utils/concurrency.test.js`

- [ ] **Step 1: Create the test file**

```js
// utils/concurrency.test.js
import { describe, it, expect, vi } from 'vitest';
import { withConcurrency } from './concurrency.js';

describe('withConcurrency', () => {
  it('processes all items and returns results in order', async () => {
    const items = [1, 2, 3, 4, 5];
    const results = await withConcurrency(items, 2, async (x) => x * 2);
    expect(results).toEqual([2, 4, 6, 8, 10]);
  });

  it('never exceeds the concurrency limit', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);

    await withConcurrency(items, 5, async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise(r => setTimeout(r, 10));
      inFlight--;
    });

    expect(maxInFlight).toBeLessThanOrEqual(5);
  });

  it('starts next item immediately when a slot frees, not when slowest in chunk finishes', async () => {
    const startTimes = new Array(4);
    // Item durations: [50ms, 10ms, 10ms, 10ms], limit=2
    // Rolling slots: item 1 finishes at t≈10 → item 2 starts at t≈10
    // Chunked Promise.all (wrong): chunk [0,1] finishes at t≈50 → item 2 starts at t≈50
    const durations = [50, 10, 10, 10];

    await withConcurrency(durations, 2, async (duration, idx) => {
      startTimes[idx] = Date.now();
      await new Promise(r => setTimeout(r, duration));
    });

    // Item 2 must start well before the 50ms slow item 0 finishes.
    // If chunked behavior was used, item 2 would start at ~50ms.
    // With correct rolling slots, item 2 starts at ~10ms.
    expect(startTimes[2]).toBeLessThan(startTimes[0] + 25);
  });

  it('handles empty array', async () => {
    const results = await withConcurrency([], 5, async (x) => x);
    expect(results).toEqual([]);
  });

  it('handles limit larger than items array', async () => {
    const items = [1, 2];
    const results = await withConcurrency(items, 100, async (x) => x + 1);
    expect(results).toEqual([2, 3]);
  });

  it('propagates thrown errors from workers', async () => {
    const items = [1, 2, 3];
    await expect(
      withConcurrency(items, 2, async (x) => {
        if (x === 2) throw new Error('fail');
        return x;
      })
    ).rejects.toThrow('fail');
  });

  it('passes both item and index to fn', async () => {
    const items = ['a', 'b', 'c'];
    const results = await withConcurrency(items, 2, async (item, idx) => `${idx}:${item}`);
    expect(results).toEqual(['0:a', '1:b', '2:c']);
  });
});
```

- [ ] **Step 2: Run tests to confirm they all fail**

```bash
cd /home/radar && npx vitest run utils/concurrency.test.js
```

Expected: All 7 tests fail with "Cannot find module './concurrency.js'"

---

### Task 2: Implement `withConcurrency`

**Files:**
- Create: `utils/concurrency.js`

- [ ] **Step 1: Write the implementation**

```js
// utils/concurrency.js

/**
 * Process an array of items with at most `limit` concurrent async operations.
 * As each slot completes, the next item starts immediately — no staircase effect.
 *
 * IMPORTANT: The function `fn` must NOT throw unhandled errors — if it does,
 * Promise.all will reject and cancel remaining work. Callers are responsible for
 * per-item try/catch + logError, returning null for failed/skipped items.
 *
 * @param {any[]} items
 * @param {number} limit - max concurrent in-flight operations
 * @param {(item: any, index: number) => Promise<any>} fn
 * @returns {Promise<any[]>} results in same order as items
 */
export async function withConcurrency(items, limit, fn) {
  if (items.length === 0) return [];
  const results = new Array(items.length);
  let next = 0;
  const workers = Array(Math.min(limit, items.length)).fill(null).map(async () => {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}
```

- [ ] **Step 2: Run tests to confirm all pass**

```bash
cd /home/radar && npx vitest run utils/concurrency.test.js
```

Expected: 7/7 tests pass.

- [ ] **Step 3: Commit**

```bash
cd /home/radar
git add utils/concurrency.js utils/concurrency.test.js
git commit -m "feat: add withConcurrency utility with tests"
```

---

## Chunk 2: Refactor `findLeads.js` — Stage 1 + dedup pre-pass + Stages 2-6

### Task 3: Add import and dedup pre-pass

**Files:**
- Modify: `findLeads.js`

**Before making any edits, read the current file top-to-bottom.**

The current pipeline has one big `for...of rawLeads` loop (lines 184–380) where all stages happen sequentially per lead. This will be broken into four separate `withConcurrency` passes.

- [ ] **Step 1: Add `withConcurrency` import at the top of `findLeads.js`**

Add this line after the existing imports (after line 6):

```js
import { withConcurrency } from './utils/concurrency.js';
```

- [ ] **Step 2: Add dedup pre-pass after `const persona = {...}` block (after line 170)**

Insert this block immediately after the persona object is defined, before the Stage 1 discovery loop:

```js
    // ── Dedup guards — pre-load before any concurrent work ───────────────
    // Loaded synchronously once. Workers use Set.has/add (synchronous, no await)
    // so JS's single-threaded event loop guarantees no two workers race on these.
    const knownEmails = new Set(
      db.prepare('SELECT contact_email FROM leads WHERE contact_email IS NOT NULL')
        .all().map(r => r.contact_email)
    );
    const rejectedEmails = new Set(
      db.prepare('SELECT email FROM reject_list').all().map(r => r.email)
    );
    const cooledDomains = new Set(
      db.prepare(`
        SELECT DISTINCT substr(contact_email, instr(contact_email, '@') + 1) AS domain
        FROM leads
        WHERE status IN ('sent', 'replied')
          AND domain_last_contacted >= datetime('now', '-90 days')
          AND contact_email IS NOT NULL
      `).all().map(r => r.domain)
    );
```

- [ ] **Step 3: Replace the Stage 1 serial `for` loop with concurrent discovery**

Find and replace the current Stage 1 block (the `for (let batch = 0; batch < batches; batch++)` loop at lines 172–182, including the closing `bumpMetric('leads_discovered')` call):

**Remove:**
```js
    // Stage 1: Discovery — batches of perBatch leads
    let rawLeads = [];
    for (let batch = 0; batch < batches; batch++) {
      const { leads: batchLeads, costUsd: discoverCost } = await stage1_discover(niche, batch, perBatch);
      totalCost += discoverCost;
      bumpMetric('gemini_cost_usd', discoverCost);
      bumpMetric('total_api_cost_usd', discoverCost);
      rawLeads = rawLeads.concat(batchLeads);
    }

    bumpMetric('leads_discovered', rawLeads.length);
```

**Replace with:**
```js
    // Stage 1: Discovery — all batches concurrent (cap=5 to stay within grounding RPM)
    const batchIndices = Array.from({ length: batches }, (_, i) => i);
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
    const rawLeads = discoveryResults.flat();

    bumpMetric('leads_discovered', rawLeads.length);
```

- [ ] **Step 4: Commit checkpoint**

```bash
cd /home/radar
git add findLeads.js
git commit -m "refactor: concurrent Stage 1 discovery + dedup Set pre-load"
```

---

### Task 4: Atomically replace the entire sequential `for...of` loop with four concurrent passes

**Files:**
- Modify: `findLeads.js`

The current `for (const raw of rawLeads)` loop (lines 184–380) handles ALL stages for each lead. **Replace the entire loop in one edit** — start marker to end marker — with the four concurrent `withConcurrency` passes below. Do NOT split this into multiple partial edits; the file will have syntax errors between partial replacements.

- [ ] **Step 1: Replace the entire `for...of` loop with all four concurrent passes**

**Remove** — match this exact start line to find the block:
```
    for (const raw of rawLeads) {
```
...through the closing:
```
    }  // end for (const raw of rawLeads)
```
(lines 184–380 in the original file — the entire block ending with the `} catch (leadErr)` handler and its outer `}`)

**Replace with** the entire block below (all four passes as one edit):

```js
    // ── Stage 2-6: Extract + Gate 1 + email check + dedup ────────────────
    // 20 concurrent Gemini calls — safe on paid tier (1,000 RPM generation limit)
    const extractedLeads = await withConcurrency(rawLeads, 20, async (raw) => {
      try {
        leadsProcessed++;

        const { data: extracted, costUsd: extractCost } = await stages2to6_extract(raw);
        totalCost += extractCost;
        bumpMetric('gemini_cost_usd', extractCost);
        bumpMetric('total_api_cost_usd', extractCost);

        if (!extracted) {
          leadsSkipped++;
          return null;
        }

        bumpMetric('leads_extracted');

        const lead = { ...raw, ...extracted, extractCost };

        // Gate 1: Drop if modern stack + no signals + quality score >= 7
        const techStack = Array.isArray(lead.tech_stack) ? lead.tech_stack : [];
        const modernTech = techStack.some(t =>
          /next\.?js|react|webflow|gatsby|nuxt|svelte/i.test(t)
        );
        const hasSignals = Array.isArray(lead.business_signals) && lead.business_signals.length > 0;
        if (modernTech && !hasSignals && (lead.website_quality_score || 0) >= 7) {
          leadsSkipped++;
          return null;
        }

        bumpMetric('leads_judge_passed');

        if (!lead.contact_email) {
          leadsSkipped++;
          return null;
        }

        bumpMetric('leads_email_found');

        // Stage 8: Dedup — all three checks use pre-loaded Sets (no DB query, race-free)
        // .has() and .add() are synchronous — JS event loop guarantees no interleave
        const emailDomain = lead.contact_email.split('@')[1];
        if (
          rejectedEmails.has(lead.contact_email) ||
          knownEmails.has(lead.contact_email) ||
          cooledDomains.has(emailDomain)
        ) {
          leadsSkipped++;
          return null;
        }
        knownEmails.add(lead.contact_email);
        cooledDomains.add(emailDomain);

        return lead;
      } catch (err) {
        logError('findLeads.lead', err, { jobName: 'findLeads' });
        leadsSkipped++;
        return null;
      }
    });
    const gate1Passed = extractedLeads.filter(Boolean);

    // ── Stage 7: Email verification (MEV) ────────────────────────────────
    const verifiedLeads = await withConcurrency(gate1Passed, 20, async (lead) => {
      try {
        const { status: verifyStatus, confidence } = await verifyEmail(lead.contact_email);
        lead.email_status = verifyStatus;

        if (verifyStatus === 'invalid' || verifyStatus === 'disposable') {
          leadsSkipped++;
          db.prepare(`
            INSERT INTO leads (business_name, website_url, category, city, contact_email, email_status, status)
            VALUES (?, ?, ?, ?, ?, ?, 'email_invalid')
          `).run(lead.business_name, lead.website_url, lead.category, lead.city, lead.contact_email, verifyStatus);
          return null;
        }

        // Gate 2: unknown + low confidence = skip
        if (verifyStatus === 'unknown' && confidence < 0.5) {
          leadsSkipped++;
          return null;
        }

        bumpMetric('leads_email_valid');
        return lead;
      } catch (err) {
        logError('findLeads.lead', err, { jobName: 'findLeads' });
        leadsSkipped++;
        return null;
      }
    });
    const gate2Passed = verifiedLeads.filter(Boolean);

    // ── Stage 9: ICP scoring ─────────────────────────────────────────────
    const scoredLeads = await withConcurrency(gate2Passed, 20, async (lead) => {
      try {
        const { data: icp, costUsd: icpCost } = await stage9_icpScore(lead, rubric, threshA, threshB);
        totalCost += icpCost;
        bumpMetric('gemini_cost_usd', icpCost);
        bumpMetric('total_api_cost_usd', icpCost);

        lead.icp_score = icp.icp_score;
        lead.icp_priority = icp.icp_priority;
        lead.icp_reason = icp.icp_reason;
        lead.icpCost = icpCost;

        // Gate 3: C-priority → nurture (not discarded)
        if (icp.icp_priority === 'C') {
          db.prepare(`
            INSERT INTO leads (
              business_name, website_url, category, city, country, search_query,
              tech_stack, website_problems, last_updated, has_ssl, has_analytics,
              owner_name, owner_role, business_signals, social_active,
              website_quality_score, judge_reason,
              contact_name, contact_email, contact_confidence, contact_source,
              email_status, icp_score, icp_priority, icp_reason,
              status, gemini_cost_usd
            ) VALUES (?, ?, ?, ?, 'IN', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'nurture', ?)
          `).run(
            lead.business_name, lead.website_url, lead.category, lead.city, niche.query,
            JSON.stringify(lead.tech_stack), JSON.stringify(lead.website_problems),
            lead.last_updated, lead.has_ssl, lead.has_analytics,
            lead.owner_name, lead.owner_role,
            JSON.stringify(lead.business_signals), lead.social_active,
            lead.website_quality_score, lead.judge_reason,
            lead.owner_name, lead.contact_email, lead.contact_confidence, lead.contact_source,
            lead.email_status, lead.icp_score, lead.icp_priority, lead.icp_reason,
            lead.extractCost + icpCost
          );
          leadsSkipped++;
          return null;
        }

        bumpMetric('leads_icp_ab');
        return lead;
      } catch (err) {
        logError('findLeads.lead', err, { jobName: 'findLeads' });
        leadsSkipped++;
        return null;
      }
    });
    const abLeads = scoredLeads.filter(Boolean);

    // ── Stage 10/11: Hook + email body + subject + DB insert ─────────────
    // cap=10 — Claude Sonnet/Haiku RPM limit ~50; 10 concurrent is safe
    await withConcurrency(abLeads, 10, async (lead) => {
      try {
        // Stage 10: Hook (Claude Sonnet)
        const hookResult = await stage10_hook(lead, persona);
        totalCost += hookResult.costUsd;

        // Stage 11: Body + subject in parallel (Claude Haiku)
        const [bodyResult, subjectResult] = await Promise.all([
          stage11_body(lead, hookResult.hook, persona),
          stage11_subject(lead)
        ]);
        const bodyCost = bodyResult.costUsd + subjectResult.costUsd;
        totalCost += bodyCost;

        const geminiCost = lead.extractCost + lead.icpCost;

        // Insert lead
        const leadInsert = db.prepare(`
          INSERT INTO leads (
            business_name, website_url, category, city, country, search_query,
            tech_stack, website_problems, last_updated, has_ssl, has_analytics,
            owner_name, owner_role, business_signals, social_active,
            website_quality_score, judge_reason,
            contact_name, contact_email, contact_confidence, contact_source,
            email_status, email_verified_at,
            icp_score, icp_priority, icp_reason,
            status, gemini_cost_usd, discovery_model, extraction_model
          ) VALUES (?, ?, ?, ?, 'IN', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, 'ready', ?, 'gemini-2.5-flash', 'gemini-2.5-flash')
        `).run(
          lead.business_name, lead.website_url, lead.category, lead.city, niche.query,
          JSON.stringify(lead.tech_stack), JSON.stringify(lead.website_problems),
          lead.last_updated, lead.has_ssl, lead.has_analytics,
          lead.owner_name, lead.owner_role,
          JSON.stringify(lead.business_signals), lead.social_active,
          lead.website_quality_score, lead.judge_reason,
          lead.owner_name, lead.contact_email, lead.contact_confidence, lead.contact_source,
          lead.email_status,
          lead.icp_score, lead.icp_priority, lead.icp_reason,
          geminiCost
        );

        // Insert pre-generated email
        const leadId = leadInsert.lastInsertRowid;
        db.prepare(`
          INSERT INTO emails (
            lead_id, sequence_step, subject, body, word_count, hook,
            contains_link, is_html, is_plain_text, content_valid,
            status, hook_model, body_model, hook_cost_usd, body_cost_usd, total_cost_usd
          ) VALUES (?, 0, ?, ?, ?, ?, 0, 0, 1, 1, 'pending', ?, ?, ?, ?, ?)
        `).run(
          leadId, subjectResult.subject, bodyResult.body,
          bodyResult.body.trim().split(/\s+/).filter(Boolean).length,
          hookResult.hook, hookResult.model, bodyResult.model,
          hookResult.costUsd, bodyCost, hookResult.costUsd + bodyCost
        );

        bumpMetric('leads_ready');
        leadsReady++;
      } catch (err) {
        logError('findLeads.lead', err, { jobName: 'findLeads' });
        leadsSkipped++;
      }
    });
```

- [ ] **Step 2: Verify no syntax errors**

```bash
cd /home/radar && node --check findLeads.js
```

Expected: No output (clean parse).

- [ ] **Step 3: Commit**

```bash
cd /home/radar
git add findLeads.js
git commit -m "refactor: replace serial for-of loop with 4 concurrent withConcurrency passes"
```

---

## Chunk 3: Config updates + smoke test

### Task 5: Update config and env

**Files:**
- Modify: `.env`
- DB config update (via sqlite3 CLI or direct DB update)

- [ ] **Step 1: Update `.env` — bump Claude spend cap**

In `.env`, change:
```
CLAUDE_DAILY_SPEND_CAP=3.00
```
to:
```
CLAUDE_DAILY_SPEND_CAP=5.00
```

- [ ] **Step 2: Update `find_leads_batches` in DB config**

```bash
cd /home/radar && node -e "
import { createRequire } from 'module';
const { getDb } = await import('./utils/db.js');
const db = getDb();
db.prepare(\"UPDATE config SET value = '17' WHERE key = 'find_leads_batches'\").run();
console.log('Updated:', db.prepare(\"SELECT * FROM config WHERE key = 'find_leads_batches'\").get());
" --input-type=module
```

Expected output: `Updated: { key: 'find_leads_batches', value: '17', ... }`

- [ ] **Step 3: Commit**

```bash
cd /home/radar
git add .env
git commit -m "config: bump Claude spend cap to \$5, batches to 17 for 500-lead run"
```

---

### Task 6: Smoke test the refactored pipeline

**Files:**
- Read: `findLeads.js` (verify final structure)

- [ ] **Step 1: Run the vitest suite to confirm concurrency utility still passes**

```bash
cd /home/radar && npx vitest run utils/concurrency.test.js
```

Expected: 7/7 pass.

- [ ] **Step 2: Dry-run syntax check on the full refactored file**

```bash
cd /home/radar && node --check findLeads.js
```

Expected: No output (no syntax errors).

- [ ] **Step 3: Verify module imports resolve**

```bash
cd /home/radar && node -e "import('./findLeads.js').then(() => console.log('imports ok'))" --input-type=module 2>&1 | head -5
```

Expected: `imports ok` or the script starts running (which means imports resolved).

- [ ] **Step 4: Check that `withConcurrency` import appears in `findLeads.js`**

```bash
grep -n "withConcurrency" /home/radar/findLeads.js
```

Expected: At least 5 matches — 1 import + 4 call sites (Stage 1, Stages 2-6, Stage 7, Stage 9, Stage 10/11).

- [ ] **Step 5: Final commit**

```bash
cd /home/radar
git add .
git commit -m "feat: async 500-lead pipeline — 5 withConcurrency passes, ~4-6 min runtime"
```

---

## Runtime Tuning Reference

If you see 429 errors in the logs after first run, reduce concurrency caps:

| Stage | Default cap | Safe cap on 429 |
|---|---|---|
| Stage 1 discovery | 5 | 3 |
| Stage 2-6 extraction | 20 | 8 |
| Stage 7 MEV | 20 | 10 |
| Stage 9 ICP | 20 | 8 |
| Stage 10/11 Claude | 10 | 5 |

The caps are hardcoded in the `withConcurrency` calls. Adjust inline if needed — no config key exists for these yet.
