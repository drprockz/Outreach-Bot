# Competitor Analysis — Stage 9.5 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a free competitor analysis stage (9.5) to the `findLeads` pipeline that researches top 3 competitors per ICP A/B lead, stores structured gap data, and injects it into hook generation for sharper cold emails.

**Architecture:** After ICP scoring, `analyzeCompetitors(lead)` runs 5 Gemini free-tier grounded-search calls (1 discovery + 3 parallel portfolio scrapes + 1 gap comparison), returns `{ competitors, pros, cons, gaps, opportunityHook, costUsd }`. The result is stored as `competitorAnalysis Json?` on the Lead row, and `opportunityHook` + top 2 `cons` are injected into both A/B hook generation prompts as silent context.

**Tech Stack:** Node.js ES modules, Prisma ORM (Postgres), Gemini 2.5 Flash (`callGemini`), `withConcurrency` util, Vitest

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `src/core/ai/competitorAnalysis.js` | `analyzeCompetitors(lead)` — 3 Gemini calls, returns structured result or null |
| Create | `tests/core/ai/competitorAnalysis.test.js` | Unit tests for the module (mock `callGemini`) |
| Modify | `prisma/schema.prisma:70` | Add `competitorAnalysis Json? @map("competitor_analysis")` to Lead model |
| Modify | `src/engines/findLeads.js:40–79` | `insertLead`: add `competitorCost` + `competitorAnalysis` fields |
| Modify | `src/engines/findLeads.js:193–222` | Export `buildHookPrompt`; add `competitorAnalysis` 5th param; update `generateHookVariant` + `stage10_hook` |
| Modify | `src/engines/findLeads.js:536–540` | Add stage 9.5 block after signal collection, pass `competitorAnalysis` to `stage10_hook` |
| Modify | `tests/engines/findLeads.unit.test.js` | Add `buildHookPrompt` competitor context tests |

---

## Chunk 1: Schema + `competitorAnalysis.js` module

### Task 1: Add `competitorAnalysis` field to Prisma schema

**Files:**
- Modify: `prisma/schema.prisma:70`

- [ ] **Step 1: Add the field after `manualHookNote` in the Lead model**

  In `prisma/schema.prisma`, after line 70 (`manualHookNote String? @map("manual_hook_note")`), add:

  ```prisma
    competitorAnalysis    Json?     @map("competitor_analysis")
  ```

- [ ] **Step 2: Run the migration**

  ```bash
  npx prisma migrate dev --name add_competitor_analysis
  ```

  Expected: migration file created in `prisma/migrations/`, schema applied to dev DB.

- [ ] **Step 3: Commit**

  ```bash
  git add prisma/schema.prisma prisma/migrations/
  git commit -m "feat(schema): add competitorAnalysis Json? to Lead model"
  ```

---

### Task 2: TDD — `competitorAnalysis.js` module

**Files:**
- Create: `tests/core/ai/competitorAnalysis.test.js`
- Create: `src/core/ai/competitorAnalysis.js`

- [ ] **Step 1: Write the failing tests**

  Create `tests/core/ai/competitorAnalysis.test.js`:

  ```js
  import { describe, it, expect, vi, beforeEach } from 'vitest';

  vi.mock('../../../src/core/ai/gemini.js', () => ({ callGemini: vi.fn() }));
  vi.mock('../../../src/core/db/index.js', () => ({ logError: vi.fn() }));

  import { callGemini } from '../../../src/core/ai/gemini.js';
  import { logError } from '../../../src/core/db/index.js';

  const LEAD = {
    business_name: 'Test Salon',
    category: 'salon',
    city: 'Mumbai',
    website_problems: ['no online booking'],
    tech_stack: ['WordPress'],
  };

  describe('analyzeCompetitors', () => {
    let analyzeCompetitors;

    beforeEach(async () => {
      vi.resetAllMocks();
      vi.resetModules();
      ({ analyzeCompetitors } = await import('../../../src/core/ai/competitorAnalysis.js'));
    });

    it('returns structured analysis on happy path', async () => {
      callGemini
        .mockResolvedValueOnce({ text: JSON.stringify([{ name: 'Rival Salon', website: 'rivalsalon.in' }]), costUsd: 0.001 })
        .mockResolvedValueOnce({ text: JSON.stringify({ clients: ['HDFC Bank'], portfolioHighlights: ['100+ weddings'] }), costUsd: 0.001 })
        .mockResolvedValueOnce({ text: JSON.stringify({ pros: ['Good rating'], cons: ['No SSL'], gaps: ['Rival lists clients'], opportunityHook: 'Your competitor lists enterprise clients.' }), costUsd: 0.001 });

      const result = await analyzeCompetitors(LEAD);

      expect(result).not.toBeNull();
      expect(result.competitors).toHaveLength(1);
      expect(result.competitors[0].clients).toContain('HDFC Bank');
      expect(result.cons).toContain('No SSL');
      expect(result.opportunityHook).toBeTruthy();
      // 1 discovery call + 1 scrape call (1 competitor) + 1 gap call = 3 × 0.001 = 0.003
      expect(result.costUsd).toBeCloseTo(0.003);
    });

    it('returns null when discovery returns malformed JSON', async () => {
      callGemini.mockResolvedValueOnce({ text: 'not json at all', costUsd: 0.001 });

      const result = await analyzeCompetitors(LEAD);

      expect(result).toBeNull();
      expect(logError).toHaveBeenCalledWith(
        'competitorAnalysis.parse.discovery',
        expect.any(Error),
        expect.objectContaining({ jobName: 'findLeads' })
      );
    });

    it('includes successful competitors when one Call 2 lambda throws', async () => {
      callGemini
        .mockResolvedValueOnce({ text: JSON.stringify([{ name: 'A', website: 'a.in' }, { name: 'B', website: 'b.in' }]), costUsd: 0.001 })
        .mockResolvedValueOnce({ text: JSON.stringify({ clients: ['Client X'], portfolioHighlights: [] }), costUsd: 0.001 })
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValueOnce({ text: JSON.stringify({ pros: [], cons: ['No SSL'], gaps: [], opportunityHook: 'hook' }), costUsd: 0.001 });

      const result = await analyzeCompetitors(LEAD);

      expect(result).not.toBeNull();
      expect(result.competitors).toHaveLength(1);
      expect(result.competitors[0].name).toBe('A');
    });

    it('returns null when gap comparison returns malformed JSON', async () => {
      callGemini
        .mockResolvedValueOnce({ text: JSON.stringify([{ name: 'Rival', website: 'rival.in' }]), costUsd: 0.001 })
        .mockResolvedValueOnce({ text: JSON.stringify({ clients: [], portfolioHighlights: [] }), costUsd: 0.001 })
        .mockResolvedValueOnce({ text: 'not json', costUsd: 0.001 });

      const result = await analyzeCompetitors(LEAD);

      expect(result).toBeNull();
      expect(logError).toHaveBeenCalledWith(
        'competitorAnalysis.parse.gap',
        expect.any(Error),
        expect.objectContaining({ jobName: 'findLeads' })
      );
    });
  });
  ```

- [ ] **Step 2: Run tests to confirm they fail**

  ```bash
  npm test -- tests/core/ai/competitorAnalysis.test.js
  ```

  Expected: 4 failures — module does not exist yet.

- [ ] **Step 3: Create `src/core/ai/competitorAnalysis.js`**

  ```js
  import 'dotenv/config';
  import { callGemini } from './gemini.js';
  import { withConcurrency } from '../lib/concurrency.js';
  import { logError } from '../db/index.js';

  function stripJson(text) {
    return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  }

  export async function analyzeCompetitors(lead) {
    const bizName = lead.business_name;
    try {
      // Call 1: Competitor discovery
      const discoveryResult = await callGemini(
        `Find the top 3 direct competitors of "${bizName}", a ${lead.category} business in ${lead.city}, India. Return ONLY valid JSON array, no markdown: [{"name":"string","website":"string"}]`,
        { useGrounding: true }
      );

      let competitors;
      try {
        competitors = JSON.parse(stripJson(discoveryResult.text));
        if (!Array.isArray(competitors) || competitors.length === 0) throw new Error('empty');
      } catch {
        await logError('competitorAnalysis.parse.discovery', new Error('invalid JSON'), { jobName: 'findLeads' });
        return null;
      }

      let totalCost = discoveryResult.costUsd;
      competitors = competitors.slice(0, 3);

      // Call 2: Client/portfolio scrape — each lambda catches own errors (withConcurrency contract)
      const profiles = await withConcurrency(competitors, 3, async (comp) => {
        try {
          const result = await callGemini(
            `Find notable clients, case studies, or portfolio work listed by "${comp.name}" (${comp.website}). Return ONLY valid JSON, no markdown: {"clients":[],"portfolioHighlights":[]}`,
            { useGrounding: true }
          );
          totalCost += result.costUsd;
          let profile;
          try { profile = JSON.parse(stripJson(result.text)); } catch { return null; }
          return {
            name: comp.name,
            website: comp.website,
            clients: profile.clients || [],
            portfolioHighlights: profile.portfolioHighlights || [],
          };
        } catch {
          return null;
        }
      });

      // filter(Boolean) removes nulls from failed lambdas before Call 3 prompt construction
      const validProfiles = profiles.filter(Boolean);

      // Call 3: Gap comparison
      const gapResult = await callGemini(
        `Compare "${bizName}" against these competitors: ${JSON.stringify(validProfiles)}.
  Known issues with ${bizName}: website problems: ${JSON.stringify(lead.website_problems || [])}, tech stack: ${JSON.stringify(lead.tech_stack || [])}.
  Return ONLY valid JSON, no markdown: {"pros":[],"cons":[],"gaps":[],"opportunityHook":"one sentence"}`,
        { useGrounding: false }
      );
      totalCost += gapResult.costUsd;

      let gap;
      try {
        gap = JSON.parse(stripJson(gapResult.text));
      } catch {
        await logError('competitorAnalysis.parse.gap', new Error('invalid JSON'), { jobName: 'findLeads' });
        return null;
      }

      return {
        competitors: validProfiles,
        pros: gap.pros || [],
        cons: gap.cons || [],
        gaps: gap.gaps || [],
        opportunityHook: gap.opportunityHook || '',
        costUsd: totalCost,
      };
    } catch (err) {
      await logError('competitorAnalysis', err, { jobName: 'findLeads' });
      return null;
    }
  }
  ```

- [ ] **Step 4: Run tests to confirm they pass**

  ```bash
  npm test -- tests/core/ai/competitorAnalysis.test.js
  ```

  Expected: 4 passing.

- [ ] **Step 5: Run full test suite to check for regressions**

  ```bash
  npm test
  ```

  Expected: all tests pass.

- [ ] **Step 6: Commit**

  ```bash
  git add src/core/ai/competitorAnalysis.js tests/core/ai/competitorAnalysis.test.js
  git commit -m "feat(ai): add analyzeCompetitors module — stage 9.5"
  ```

---

## Chunk 2: Wire stage 9.5 into `findLeads.js`

> **Prerequisites:** Chunk 1 must be fully complete before starting Chunk 2.
> - `src/core/ai/competitorAnalysis.js` must exist (created in Chunk 1 Task 2)
> - `competitorAnalysis Json?` column must exist on the Lead model and migration must have run (Chunk 1 Task 1)
> - Import path: `import { analyzeCompetitors } from '../core/ai/competitorAnalysis.js';`

### Task 3: Export `buildHookPrompt` and add competitor context param

**Files:**
- Modify: `src/engines/findLeads.js:193–222`
- Modify: `tests/engines/findLeads.unit.test.js`

- [ ] **Step 1: Update the import at the top of `tests/engines/findLeads.unit.test.js`**

  The existing import (line 3) only imports `buildDiscoveryPrompt`. Update it to also import `buildHookPrompt`:

  ```js
  import { buildDiscoveryPrompt, buildHookPrompt } from '../../src/engines/findLeads.js';
  ```

- [ ] **Step 2: Write the failing tests**

  In `tests/engines/findLeads.unit.test.js`, add after the existing `buildDiscoveryPrompt` describe block:

  ```js
  // import already updated in Step 1

  // ... existing tests ...

  describe('buildHookPrompt', () => {
    const lead = { business_name: 'Test Salon', website_url: 'testsalon.in', manual_hook_note: null };
    const persona = { role: 'full-stack developer', name: 'Darshan', company: 'Simple Inc' };

    it('does not include competitor block when competitorAnalysis is null', () => {
      const p = buildHookPrompt('A', lead, persona, [], null);
      expect(p).not.toContain('Competitor context');
    });

    it('does not include competitor block when competitorAnalysis is undefined', () => {
      const p = buildHookPrompt('A', lead, persona, []);
      expect(p).not.toContain('Competitor context');
    });

    it('includes opportunityHook and top 2 cons when competitorAnalysis is provided', () => {
      const ca = {
        opportunityHook: 'Your rival already lists Tata Motors as a client.',
        cons: ['No SSL certificate', 'Site loads in 8 seconds', 'No case studies'],
      };
      const p = buildHookPrompt('A', lead, persona, [], ca);
      expect(p).toContain('Competitor context');
      expect(p).toContain('Your rival already lists Tata Motors as a client.');
      expect(p).toContain('No SSL certificate');
      expect(p).toContain('Site loads in 8 seconds');
      expect(p).not.toContain('No case studies');
    });

    it('works for variant B as well', () => {
      const ca = { opportunityHook: 'hook text', cons: ['con1'] };
      const p = buildHookPrompt('B', lead, persona, [], ca);
      expect(p).toContain('Competitor context');
      expect(p).toContain('hook text');
    });
  });
  ```

- [ ] **Step 3: Run tests to confirm they fail**

  ```bash
  npm test -- tests/engines/findLeads.unit.test.js
  ```

  Expected: 4 new failures — `buildHookPrompt` not exported yet.

- [ ] **Step 4: Update `buildHookPrompt`, `generateHookVariant`, and `stage10_hook` in `findLeads.js`**

  **Replace** the `buildHookPrompt` function (currently at line ~193):

  ```js
  export function buildHookPrompt(variant, lead, persona, signals, competitorAnalysis = null) {
    const seed = VARIANT_SEEDS[variant];
    const opener = variant === 'A'
      ? `Write ONE sentence (max 20 words) that makes ${seed.angle} a ${persona.role} — outdated tech, missing feature, design issue. No fluff, no compliments.`
      : `${seed.angle.replace(/^a /, 'Write ')} ${persona.role} would ask ${lead.business_name}'s owner about their site (${lead.website_url}) — concrete, no fluff.`;
    const manualNote = lead.manual_hook_note ? `\n\nManual hook hint from operator: ${lead.manual_hook_note}` : '';
    const competitorBlock = competitorAnalysis
      ? `\n\nCompetitor context (use naturally, do not quote directly):\n- Hook insight: ${competitorAnalysis.opportunityHook}\n- Key gaps: ${(competitorAnalysis.cons || []).slice(0, 2).join('; ')}`
      : '';
    return opener + buildSignalsBlock(signals) + manualNote + competitorBlock;
  }
  ```

  **Replace** `generateHookVariant` (line ~202):

  ```js
  async function generateHookVariant(variant, lead, persona, signals, competitorAnalysis = null) {
    const prompt = buildHookPrompt(variant, lead, persona, signals, competitorAnalysis);
    if (ANTHROPIC_DISABLED) {
      const result = await callGemini(prompt);
      return { variant, hook: result.text.trim(), costUsd: result.costUsd, model: 'gemini-2.5-flash' };
    }
    const result = await callClaude('sonnet', prompt, { maxTokens: 60 });
    return { variant, hook: result.text.trim(), costUsd: result.costUsd, model: result.model };
  }
  ```

  **Replace** `stage10_hook` (line ~214):

  ```js
  async function stage10_hook(lead, persona, signals = [], competitorAnalysis = null) {
    const [a, b] = await Promise.all([
      generateHookVariant('A', lead, persona, signals, competitorAnalysis),
      generateHookVariant('B', lead, persona, signals, competitorAnalysis),
    ]);
    const chosen = Math.random() < 0.5 ? a : b;
    const totalCost = (a.costUsd || 0) + (b.costUsd || 0);
    return { hook: chosen.hook, costUsd: totalCost, model: chosen.model, hookVariantId: chosen.variant };
  }
  ```

- [ ] **Step 5: Run tests to confirm they pass**

  ```bash
  npm test -- tests/engines/findLeads.unit.test.js
  ```

  Expected: all tests pass (new 4 + existing).

- [ ] **Step 6: Commit**

  ```bash
  git add src/engines/findLeads.js tests/engines/findLeads.unit.test.js
  git commit -m "feat(findLeads): export buildHookPrompt, add competitor context param"
  ```

---

### Task 4: Wire stage 9.5 — `insertLead` + pipeline call

**Files:**
- Modify: `src/engines/findLeads.js:1` (import)
- Modify: `src/engines/findLeads.js:76` (`insertLead` geminiCostUsd line)
- Modify: `src/engines/findLeads.js:40–79` (`insertLead` data object — add `competitorAnalysis` field)
- Modify: `src/engines/findLeads.js:536–540` (add stage 9.5 block + update `stage10_hook` call)

- [ ] **Step 1: Add the import at the top of `findLeads.js`**

  After the existing imports (around line 10), add:

  ```js
  import { analyzeCompetitors } from '../core/ai/competitorAnalysis.js';
  ```

- [ ] **Step 2: Update `insertLead` to persist `competitorAnalysis` and include `competitorCost`**

  Note: the `competitorAnalysis` column was added to the Prisma schema in Chunk 1 Task 1. No additional migration needed here.

  In `insertLead` (line ~76), change:

  ```js
  geminiCostUsd: (lead.extractCost || 0) + (lead.icpCost || 0),
  ```

  to:

  ```js
  geminiCostUsd: (lead.extractCost || 0) + (lead.icpCost || 0) + (lead.competitorCost || 0),
  ```

  Also inside the `prisma.lead.create({ data: { ... } })` block, add after `manualHookNote` (or any nullable field):

  ```js
  competitorAnalysis: lead.competitorAnalysis || null,
  ```

- [ ] **Step 3: Add stage 9.5 block and update `stage10_hook` call**

  In `processLead`, after the signal collection block (after line ~537: `const topSignals = allSignals.slice(0, 3);`), add:

  ```js
  // ── Stage 9.5: Competitor analysis ──────────────────────────────────
  let competitorAnalysis = null;
  const competitorResult = await analyzeCompetitors(lead);
  if (competitorResult) {
    const { costUsd: competitorCost, ...competitorData } = competitorResult;
    competitorAnalysis = competitorData;
    Object.assign(lead, { competitorCost, competitorAnalysis: competitorData });
    // analyzeCompetitors always uses Gemini (not gated by ANTHROPIC_DISABLED),
    // same as Stage 2 (extraction) and Stage 9 (ICP) which also bump unconditionally.
    await bumpMetric('geminiCostUsd', competitorCost);
    await bumpMetric('totalApiCostUsd', competitorCost);
    totalCost += competitorCost;
  }
  ```

  Then update the stage 10 call (line ~540) from:

  ```js
  const hookResult = await stage10_hook(lead, persona, topSignals);
  ```

  to:

  ```js
  const hookResult = await stage10_hook(lead, persona, topSignals, competitorAnalysis);
  ```

- [ ] **Step 4: Run the full test suite**

  ```bash
  npm test
  ```

  Expected: all tests pass.

- [ ] **Step 5: Smoke test — verify `analyzeCompetitors` is called at the right stage**

  Run a dry-run of the pipeline on a real lead (requires `.env` to be set with `GEMINI_API_KEY`):

  ```bash
  node -e "
  import('./src/core/ai/competitorAnalysis.js').then(({ analyzeCompetitors }) =>
    analyzeCompetitors({ business_name: 'Test Cafe', category: 'restaurant', city: 'Mumbai', website_problems: ['no menu'], tech_stack: ['Wix'] })
  ).then(r => console.log(JSON.stringify(r, null, 2)));
  "
  ```

  Expected: JSON object with `competitors`, `pros`, `cons`, `gaps`, `opportunityHook`, `costUsd`.

- [ ] **Step 6: Commit**

  ```bash
  git add src/engines/findLeads.js
  git commit -m "feat(findLeads): wire stage 9.5 competitor analysis — store + inject into hooks"
  ```
