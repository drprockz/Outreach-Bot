import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { truncateAll, closeTestPrisma, getTestPrisma } from '../helpers/testDb.js';

// State module so test assertions can read what the AI mocks observed.
// .env has ANTHROPIC_DISABLED=true which routes hook gen to Gemini, so capture there too.
const promptState = { lastHook: '' };
vi.mock('../../src/core/ai/gemini.js', () => ({
  callGemini: vi.fn(async (prompt) => {
    if (prompt.toLowerCase().includes('discover')) {
      return { text: JSON.stringify([
        { business_name: 'Acme SaaS', website_url: 'https://acmesaas.io', city: 'Bangalore', category: 'saas' },
      ]), costUsd: 0.001, inputTokens: 0, outputTokens: 0 };
    }
    if (prompt.includes('Analyze this business')) {
      return { text: JSON.stringify({
        owner_name: 'Asha Iyer', owner_role: 'Founder',
        contact_email: 'asha@acmesaas.io',
        contact_confidence: 'medium', contact_source: 'guess',
        tech_stack: ['Rails', 'Postgres'], website_problems: [],
        last_updated: '2026', has_ssl: 1, has_analytics: 1,
        business_signals: ['hiring'], social_active: 1,
        website_quality_score: 6, judge_reason: 'looks active',
        employees_estimate: '11-50', business_stage: 'growing',
      }), costUsd: 0.001, inputTokens: 0, outputTokens: 0 };
    }
    if (prompt.includes('ONE sentence')) {
      promptState.lastHook = prompt;
      return { text: 'Your hiring page lists 12 roles but no engineering manager track.', costUsd: 0.002, inputTokens: 0, outputTokens: 0 };
    }
    if (prompt.includes('cold email from')) {
      return { text: 'Hi Asha,\n\nNoticed your hiring page... etc.\n\nBest,\nDarshan', costUsd: 0.001, inputTokens: 0, outputTokens: 0 };
    }
    if (prompt.includes('subject line')) {
      return { text: 'Quick note on Acme', costUsd: 0.001, inputTokens: 0, outputTokens: 0 };
    }
    return { text: '{}', costUsd: 0, inputTokens: 0, outputTokens: 0 };
  }),
}));

vi.mock('../../src/core/ai/claude.js', () => ({
  callClaude: vi.fn(async (model, prompt) => {
    if (prompt.includes('ONE sentence')) {
      promptState.lastHook = prompt;
      return { text: 'Your hiring page lists 12 roles but no engineering manager track.', costUsd: 0.002, model: 'claude-sonnet-4-20250514' };
    }
    return { text: '{}', costUsd: 0, model: 'claude-haiku-4-5-20251001' };
  }),
}));

vi.mock('../../src/core/ai/icpScorer.js', () => ({
  loadScoringContext: vi.fn(async () => ({})),
  scoreLead: vi.fn(async () => ({
    icp_score: 78,
    icp_reason: 'good fit',
    icp_breakdown: { firmographic: 18, problem: 17 },
    icp_key_matches: ['saas'],
    icp_key_gaps: [],
    icp_disqualifiers: [],
    costUsd: 0.001,
  })),
}));

vi.mock('../../src/core/integrations/mev.js', () => ({
  verifyEmail: vi.fn(async () => ({ status: 'valid', confidence: 0.95 })),
}));

vi.mock('../../src/core/integrations/telegram.js', () => ({
  sendAlert: vi.fn(async () => {}),
}));

const FAKE_SIGNALS = [
  { signalType: 'hiring',  headline: 'Hiring 12 roles',     url: 'https://acmesaas.io/jobs', payload: { count: 12 }, confidence: 0.85, signalDate: null },
  { signalType: 'funding', headline: 'Raised $5M Series A', url: 'https://news.example/a',   payload: {}, confidence: 0.9,  signalDate: null },
];
vi.mock('../../src/core/signals/index.js', () => ({
  gatherSignals: vi.fn(async () => ({
    signals: [...FAKE_SIGNALS].sort((a, b) => b.confidence - a.confidence),
    bySource: [
      { source: 'careers_page', signals: [FAKE_SIGNALS[0]] },
      { source: 'google_news',  signals: [FAKE_SIGNALS[1]] },
    ],
  })),
  persistSignals: vi.fn(async (prisma, leadId, bySource) => {
    for (const { source, signals } of bySource) {
      for (const s of signals) {
        await prisma.leadSignal.create({
          data: {
            leadId, source,
            signalType: s.signalType, headline: s.headline, url: s.url ?? '',
            payloadJson: s.payload, confidence: s.confidence,
            signalDate: s.signalDate ? new Date(s.signalDate) : null,
          },
        });
      }
    }
  }),
}));

beforeEach(async () => {
  await truncateAll();
  const { resetDb, seedConfigDefaults, seedNichesAndDefaults } = await import('../../src/core/db/index.js');
  await resetDb();
  await seedConfigDefaults();
  await seedNichesAndDefaults();

  const prisma = getTestPrisma();
  await prisma.config.update({ where: { key: 'find_leads_count' }, data: { value: '50' } });
  await prisma.config.update({ where: { key: 'find_leads_per_batch' }, data: { value: '50' } });
  await prisma.config.update({ where: { key: 'find_leads_enabled' }, data: { value: '1' } });
  await prisma.offer.update({ where: { id: 1 }, data: { problem: 'outdated sites' } });
  await prisma.icpProfile.update({ where: { id: 1 }, data: { industries: ['saas', 'restaurants'] } });

  promptState.lastHook = '';
});

afterEach(async () => {
  const { resetDb } = await import('../../src/core/db/index.js');
  await resetDb();
});

afterAll(async () => { await closeTestPrisma(); });

describe('findLeads × signals integration', () => {
  it('passes top signals into the hook prompt and persists signalsUsedJson + lead_signals', async () => {
    const { default: findLeads } = await import('../../src/engines/findLeads.js');
    await findLeads();

    const prisma = getTestPrisma();
    const emails = await prisma.email.findMany({ where: { sequenceStep: 0 } });
    expect(emails.length).toBeGreaterThan(0);

    expect(emails[0].signalsUsedJson).toBeTruthy();
    const used = emails[0].signalsUsedJson;
    expect(used.length).toBeGreaterThan(0);
    // Sorted by confidence desc — funding (0.9) before hiring (0.85)
    expect(used[0].signalType).toBe('funding');

    const leadSignals = await prisma.leadSignal.findMany();
    expect(leadSignals.length).toBe(2);
    expect(leadSignals.map(s => s.source).sort()).toEqual(['careers_page', 'google_news']);

    expect(promptState.lastHook).toContain('Recent signals about this business');
    expect(promptState.lastHook).toMatch(/funding/i);
    expect(promptState.lastHook).toMatch(/hiring/i);
  });
});
