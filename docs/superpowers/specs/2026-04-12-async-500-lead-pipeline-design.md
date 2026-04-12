# Async 500-Lead Discovery Pipeline — Design Spec
**Date:** 2026-04-12  
**Branch:** radar-v2  
**Status:** Approved

---

## 1. Problem

The current `findLeads.js` pipeline is fully sequential — one lead processed end-to-end before the next starts. At 150 leads/day this takes ~30-60 minutes. Scaling to 500 leads serially would take ~3-4 hours, making it incompatible with the 9:00 AM cron window (must finish before `sendEmails` fires at 9:30 AM).

---

## 2. Goal

Process 500 raw leads through the full 11-stage pipeline in a single cron window (~4-5 minutes) using concurrent async requests, without changing the pipeline's correctness guarantees or SQLite schema.

---

## 3. Chosen Approach: Concurrency-Limited Worker Pool (Approach B)

Stages are kept sequential (Stage 1 → 2-6 → 7 → 9 → 10/11) but each stage processes its lead array with N concurrent slots in-flight simultaneously. As soon as one slot finishes, the next lead starts immediately — no staircase wait.

Rejected alternatives:
- **Chunked Promise.all (Approach A):** Simpler but wastes ~30% throughput due to staircase idle time.
- **Stage-parallel pipeline (Approach C):** Saves only ~30-40s over B (15% improvement) at 3× the code complexity and introduces SQLite write serialization challenges.

---

## 4. Core Utility: `utils/concurrency.js`

A new file, ~20 lines, no external dependencies:

```js
/**
 * Process an array of items with at most `limit` concurrent async operations.
 * As each item completes, the next starts immediately — no staircase effect.
 * Per-item errors are caught, logged via logError, and returned as null —
 * they never abort the entire batch (Rule 8: all errors to error_log).
 *
 * @param {any[]} items
 * @param {number} limit - max concurrent in-flight operations
 * @param {(item: any, index: number) => Promise<any>} fn - must NOT throw; wrap externally
 * @returns {Promise<(any|null)[]>} - results in same order as items; null = skipped/errored
 */
export async function withConcurrency(items, limit, fn) {
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

**Per-item error isolation:** The function passed to `withConcurrency` must wrap its body in `try/catch`, call `logError` on failure, and return `null`. This mirrors the existing per-lead `catch` block in the sequential pipeline. A thrown error inside a worker propagates through `Promise.all(workers)` and aborts all remaining work — so the caller function (not `withConcurrency` itself) is responsible for isolation:

```js
await withConcurrency(rawLeads, 20, async (raw) => {
  try {
    // ... stage work
    return result;
  } catch (err) {
    logError('findLeads.lead', err, { jobName: 'findLeads' });
    leadsSkipped++;
    return null;
  }
});
```

**SQLite write safety:** better-sqlite3 `.run()` is synchronous and blocking. Multiple async tasks calling it concurrently is safe — each call blocks the event loop briefly until complete, then releases. No mutex needed.

---

## 5. Stage-by-Stage Concurrency Design

### Stage 1 — Discovery (17 batches → 510 raw leads)

```js
// Concurrency cap of 5 — Gemini grounding (paid Tier 1) is limited to ~30 RPM.
// Firing all 17 simultaneously would spike past that and trigger 429s.
const batchResults = await withConcurrency(
  Array.from({ length: batches }, (_, i) => i),
  5,
  async (i) => {
    try {
      return await stage1_discover(niche, i, perBatch);
    } catch (err) {
      logError('findLeads.discovery', err, { jobName: 'findLeads' });
      return { leads: [], costUsd: 0 };
    }
  }
);
const rawLeads = batchResults.flatMap(r => r.leads);
```

Config change: `find_leads_batches=17`, `find_leads_per_batch=30` (unchanged prompt size)

**Grounding RPM note:** Gemini 2.5 Flash with Google Search grounding on paid Tier 1 allows ~30 RPM for grounded calls. Cap of 5 concurrent across Stage 1 (17 batches) and Stage 2-6 (500 leads) keeps burst well within limits. Stage 2-6 uses cap 20 but each call takes ~3-6s, so actual sustained RPM ≈ 20/(4.5s avg) × 60 ≈ 267 RPM — within the 1,000 RPM generation limit but potentially above the 30 RPM grounding sub-limit. If 429s occur in Stage 2-6, reduce the concurrency cap from 20 → 8 to stay safely under 30 RPM grounding.

### Stage 2-6 — Extraction (500 leads → ~350 survive Gate 1)

```js
const extracted = await withConcurrency(rawLeads, 20, async (raw) => {
  const { data, costUsd } = await stages2to6_extract(raw);
  // gate checks inline, return null if skipped
  return data ? { ...raw, ...data, extractCost: costUsd } : null;
});
const gate1Passed = extracted.filter(Boolean);
```

Concurrency cap: **20** — Gemini paid tier supports 1,000 RPM; 20 concurrent well within limits.

### Stage 7 — MEV Email Verification (~350 leads → ~280 survive)

```js
const verified = await withConcurrency(gate1Passed, 20, async (lead) => {
  const { status, confidence } = await verifyEmail(lead.contact_email);
  // gate checks inline
  return isValidEmail(status, confidence) ? { ...lead, email_status: status } : null;
});
const gate2Passed = verified.filter(Boolean);
```

Concurrency cap: **20** — MEV REST API has no documented strict RPM.

### Stage 8 — Dedup pre-pass (before concurrent processing)

To prevent duplicate leads from concurrent workers racing on dedup checks, pre-load all guard Sets **before** entering any `withConcurrency` block. All three dedup checks become synchronous Set lookups — safe under concurrency because `.has()` / `.add()` are synchronous (no `await`), so JS's single-threaded event loop guarantees no two workers interleave on these lines.

```js
// Pre-load all three dedup guards once — synchronous, fast (<5ms for thousands of rows)
const knownEmails = new Set(
  db.prepare('SELECT contact_email FROM leads WHERE contact_email IS NOT NULL').all()
    .map(r => r.contact_email)
);

const rejectedEmails = new Set(
  db.prepare('SELECT email FROM reject_list').all().map(r => r.email)
);

// Domain cooldown: domains contacted in last 90 days
const cooledDomains = new Set(
  db.prepare(`
    SELECT DISTINCT substr(contact_email, instr(contact_email, '@') + 1) AS domain
    FROM leads
    WHERE status IN ('sent', 'replied', 'contacted')
      AND domain_last_contacted >= datetime('now', '-90 days')
      AND contact_email IS NOT NULL
  `).all().map(r => r.domain)
);
```

Inside each concurrent worker:
```js
const emailDomain = lead.contact_email.split('@')[1];
if (
  knownEmails.has(lead.contact_email) ||
  rejectedEmails.has(lead.contact_email) ||
  cooledDomains.has(emailDomain)
) {
  leadsSkipped++;
  return null;
}
// Optimistic add — synchronous, no interleave possible
knownEmails.add(lead.contact_email);
cooledDomains.add(emailDomain);
```

### Stage 9 — ICP Scoring (~280 leads → ~140 A/B priority)

```js
const scored = await withConcurrency(gate2Passed, 20, async (lead) => {
  const { data, costUsd } = await stage9_icpScore(lead, rubric, threshA, threshB);
  if (data.icp_priority === 'C') { insertNurture(lead, data); return null; }
  return { ...lead, ...data, icpCost: costUsd };
});
const abLeads = scored.filter(Boolean);
```

Concurrency cap: **20** — no grounding, pure Gemini generation.

### Stage 10/11 — Hook + Email Body (~140 A/B leads)

```js
const withEmails = await withConcurrency(abLeads, 10, async (lead) => {
  const hookResult = await stage10_hook(lead, persona);
  const [bodyResult, subjectResult] = await Promise.all([
    stage11_body(lead, hookResult.hook, persona),
    stage11_subject(lead)
  ]);
  return { lead, hookResult, bodyResult, subjectResult };
});
```

Concurrency cap: **10** — Claude Sonnet/Haiku ~50 RPM limit; 10 concurrent is safe.

### `bumpMetric` placement inside concurrent workers

`bumpMetric(key, amount)` calls remain **inside** each concurrent worker — they are synchronous better-sqlite3 calls (`UPDATE daily_metrics SET col = col + ?`) and are individually safe under concurrency because each `.run()` blocks the event loop until complete before yielding. They must NOT be deferred to after the concurrent pass, as a mid-run process kill would then drop all per-lead metric increments.

Per-stage placement:
- `bumpMetric('leads_extracted')` → inside Stage 2-6 worker, after successful parse
- `bumpMetric('leads_judge_passed')` → inside Stage 2-6 worker, after Gate 1
- `bumpMetric('leads_email_found')` → inside Stage 2-6 worker, after contact check
- `bumpMetric('leads_email_valid')` → inside Stage 7 worker, after MEV pass
- `bumpMetric('leads_icp_ab')` → inside Stage 9 worker, after A/B priority confirm
- `bumpMetric('gemini_cost_usd', cost)` → inside each Gemini-calling worker
- `bumpMetric('leads_ready')` → inside Stage 10/11 worker, after DB insert

### Final DB writes

After Stage 10/11 completes, insert all ready leads and their emails in a synchronous loop (no async needed — better-sqlite3 writes are fast at <1ms each for 140 rows).

---

## 6. Files Changed

| File | Change |
|---|---|
| `utils/concurrency.js` | **New** — `withConcurrency` utility |
| `findLeads.js` | Refactor discovery loop + per-lead processing to use `withConcurrency` |
| DB config | `find_leads_batches`: 5 → 17 |
| `.env` | `CLAUDE_DAILY_SPEND_CAP`: 3.00 → 5.00 (Claude-only spend at 500 leads ≈ $2.80/day; cap must exceed this) |

No schema changes. No new npm packages.

---

## 7. Estimated Runtime (500 leads, paid Gemini tier)

Estimates assume ~3-6s per grounded Gemini call (p50 from India VPS to Google). Actual latency should be profiled on first run.

| Stage | Serial baseline | Async (this design) | Concurrency cap |
|---|---|---|---|
| Stage 1 discovery (17 batches) | ~85-170s | ~18-35s | 5 |
| Stage 2-6 extraction (500 leads) | ~25-50 min | ~75-150s | 20 |
| Stage 7 MEV (350 leads) | ~12 min | ~35s | 20 |
| Stage 9 ICP (280 leads) | ~14-28 min | ~42-84s | 20 |
| Stage 10/11 Claude (140 leads) | ~4 min | ~50s | 10 |
| **Total** | **~60-95 min** | **~4-6 min** |  |

**If grounding calls average 6s (pessimistic):** total ≈ 8-9 min — still well within the 9:00-9:30 AM window.  
**If 429 errors appear on Stage 2-6:** reduce concurrency cap from 20 → 8, runtime ≈ 10-12 min, still within window.

---

## 8. Cost Impact

| Item | 150 leads/day | 500 leads/day | Delta |
|---|---|---|---|
| Gemini Flash (all stages) | ~₹30 | ~₹100 | +₹70 |
| MEV email verify | ~₹17 | ~₹57 | +₹40 |
| Claude Sonnet (hooks) | ~₹16 | ~₹53 | +₹37 |
| Claude Haiku (body+subject) | ~₹5 | ~₹17 | +₹12 |
| **Total/day** | **~₹75** | **~₹230** | **+₹155** |

Claude-only spend at 500 leads: ~$2.80/day → bump `CLAUDE_DAILY_SPEND_CAP` to `5.00`.

---

## 9. Non-Negotiables Preserved

All 16 non-negotiable rules from CLAUDE.md remain unchanged:
- Plain text emails only
- contentValidator runs before every send
- reject_list is absolute
- cron_log written at start and end
- All errors written to error_log
- Grounding stays on paid tier (well within 1,500/day RPM limit — 500 grounding calls)

---

## 10. Success Criteria

- 500 raw leads discovered and processed per run
- Full pipeline completes in ≤6 minutes wall time
- No increase in error rate vs. current 150-lead run
- `leadsReady` count scales proportionally (~110-140 ready leads/day vs. current ~34)
- All existing cron_log, daily_metrics, error_log writes intact
- `CLAUDE_DAILY_SPEND_CAP` enforcement verified to work before concurrent Claude calls begin (check cumulative spend from `daily_metrics` before Stage 10/11 starts)
- No 429 errors in Stage 1 or Stage 2-6 (monitor first run; reduce concurrency cap if seen)
