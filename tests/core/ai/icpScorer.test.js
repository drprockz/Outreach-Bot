import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { bucket, clampInt } from '../../../src/core/ai/icpScorer.js';
import { truncateAll, closeTestPrisma, getTestPrisma } from '../../helpers/testDb.js';

describe('bucket()', () => {
  it('returns A when score >= threshA', () => {
    expect(bucket(70, 70, 40)).toBe('A');
    expect(bucket(100, 70, 40)).toBe('A');
  });
  it('returns B when threshB <= score < threshA', () => {
    expect(bucket(69, 70, 40)).toBe('B');
    expect(bucket(40, 70, 40)).toBe('B');
  });
  it('returns C when score < threshB', () => {
    expect(bucket(39, 70, 40)).toBe('C');
    expect(bucket(0, 70, 40)).toBe('C');
  });
});

describe('clampInt()', () => {
  it('clamps low', () => expect(clampInt(-5, 0, 100)).toBe(0));
  it('clamps high', () => expect(clampInt(200, 0, 100)).toBe(100));
  it('passes through valid', () => expect(clampInt(50, 0, 100)).toBe(50));
  it('rounds floats', () => expect(clampInt(49.7, 0, 100)).toBe(50));
  it('handles NaN', () => expect(clampInt(NaN, 0, 100)).toBe(0));
});

describe('loadScoringContext', () => {
  beforeEach(async () => { await truncateAll(); });
  afterAll(async () => { await closeTestPrisma(); });

  it('throws when offer.problem is empty (seeded but unconfigured)', async () => {
    const { loadScoringContext } = await import('../../../src/core/ai/icpScorer.js');
    const prisma = getTestPrisma();
    await prisma.offer.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
    await prisma.icpProfile.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
    await expect(loadScoringContext(prisma)).rejects.toThrow(/offer\.problem/);
  });

  it('throws when icp_profile.industries is empty array', async () => {
    const { loadScoringContext } = await import('../../../src/core/ai/icpScorer.js');
    const prisma = getTestPrisma();
    await prisma.offer.upsert({
      where: { id: 1 },
      create: { id: 1, problem: 'outdated websites' },
      update: { problem: 'outdated websites' },
    });
    await prisma.icpProfile.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
    await expect(loadScoringContext(prisma)).rejects.toThrow(/industries/);
  });

  it('returns parsed context when both rows properly configured', async () => {
    const { loadScoringContext } = await import('../../../src/core/ai/icpScorer.js');
    const prisma = getTestPrisma();
    await prisma.offer.upsert({
      where: { id: 1 },
      create: { id: 1, problem: 'outdated websites' },
      update: { problem: 'outdated websites' },
    });
    await prisma.icpProfile.upsert({
      where: { id: 1 },
      create: { id: 1, industries: ['restaurants', 'salons'] },
      update: { industries: ['restaurants', 'salons'] },
    });
    const ctx = await loadScoringContext(prisma);
    expect(ctx.offer.problem).toBe('outdated websites');
    expect(ctx.icp.industries).toEqual(['restaurants', 'salons']);
  });
});

vi.mock('../../../src/core/ai/gemini.js', () => ({
  callGemini: vi.fn()
}));

describe('scoreLead', () => {
  const ctx = {
    offer: { problem: 'outdated sites', use_cases: [], triggers: [], alternatives: [], required_inputs: [], proof_points: [] },
    icp: { industries: ['restaurants'], geography: [], stage: [], tech_stack: [], internal_capabilities: [],
           impacted_kpis: [], initiator_roles: [], decision_roles: [], objections: [], intent_signals: [],
           current_tools: [], workarounds: [], frustrations: [], switching_barriers: [], hard_disqualifiers: [] },
    weights: { firmographic: 20, problem: 20, intent: 15, tech: 15, economic: 15, buying: 15 },
    threshA: 70, threshB: 40,
  };
  const lead = { business_name: 'X', category: 'restaurant', city: 'Mumbai' };

  beforeEach(async () => {
    await truncateAll();
    const { callGemini } = await import('../../../src/core/ai/gemini.js');
    callGemini.mockReset();
  });
  afterAll(async () => { await closeTestPrisma(); });

  it('returns normalized result on valid JSON', async () => {
    const { callGemini } = await import('../../../src/core/ai/gemini.js');
    callGemini.mockResolvedValueOnce({
      text: JSON.stringify({
        score: 75,
        breakdown: { firmographic: 18, problem: 17, intent: 10, tech: 12, economic: 10, buying: 8 },
        key_matches: ['restaurant industry match', 'Mumbai geo'],
        key_gaps: ['budget unknown'],
        disqualifiers: []
      }),
      costUsd: 0.001,
    });
    const { scoreLead } = await import('../../../src/core/ai/icpScorer.js');
    const result = await scoreLead(lead, ctx);
    expect(result.icp_score).toBe(75);
    expect(result.icp_priority).toBe('A');
    expect(result.icp_key_matches).toEqual(['restaurant industry match', 'Mumbai geo']);
    expect(result.icp_disqualifiers).toEqual([]);
    expect(result.costUsd).toBe(0.001);
  });

  it('falls back to 0/C/parse_error on malformed JSON', async () => {
    const { callGemini } = await import('../../../src/core/ai/gemini.js');
    callGemini.mockResolvedValueOnce({ text: 'not json at all', costUsd: 0.001 });
    const { scoreLead } = await import('../../../src/core/ai/icpScorer.js');
    const result = await scoreLead(lead, ctx);
    expect(result.icp_score).toBe(0);
    expect(result.icp_priority).toBe('C');
    expect(result.icp_key_gaps).toEqual(['scorer_parse_error']);
    expect(result.icp_reason).toBe('parse error');
  });

  it('clamps negative scores to 0', async () => {
    const { callGemini } = await import('../../../src/core/ai/gemini.js');
    callGemini.mockResolvedValueOnce({ text: JSON.stringify({ score: -5, breakdown: {}, key_matches: [], key_gaps: [], disqualifiers: [] }), costUsd: 0 });
    const { scoreLead } = await import('../../../src/core/ai/icpScorer.js');
    const result = await scoreLead(lead, ctx);
    expect(result.icp_score).toBe(0);
  });

  it('clamps scores over 100 to 100', async () => {
    const { callGemini } = await import('../../../src/core/ai/gemini.js');
    callGemini.mockResolvedValueOnce({ text: JSON.stringify({ score: 200, breakdown: {}, key_matches: [], key_gaps: [], disqualifiers: [] }), costUsd: 0 });
    const { scoreLead } = await import('../../../src/core/ai/icpScorer.js');
    const result = await scoreLead(lead, ctx);
    expect(result.icp_score).toBe(100);
  });

  it('preserves disqualifiers array', async () => {
    const { callGemini } = await import('../../../src/core/ai/gemini.js');
    callGemini.mockResolvedValueOnce({
      text: JSON.stringify({ score: 20, breakdown: {}, key_matches: [], key_gaps: [], disqualifiers: ['locked-in 3yr contract'] }),
      costUsd: 0
    });
    const { scoreLead } = await import('../../../src/core/ai/icpScorer.js');
    const result = await scoreLead(lead, ctx);
    expect(result.icp_disqualifiers).toEqual(['locked-in 3yr contract']);
  });

  it('handles Gemini response wrapped in markdown fences', async () => {
    const { callGemini } = await import('../../../src/core/ai/gemini.js');
    callGemini.mockResolvedValueOnce({
      text: '```json\n{"score":50,"breakdown":{},"key_matches":[],"key_gaps":[],"disqualifiers":[]}\n```',
      costUsd: 0
    });
    const { scoreLead } = await import('../../../src/core/ai/icpScorer.js');
    const result = await scoreLead(lead, ctx);
    expect(result.icp_score).toBe(50);
    expect(result.icp_priority).toBe('B');
  });
});
