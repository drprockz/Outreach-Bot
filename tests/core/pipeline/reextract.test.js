process.env.ANTHROPIC_DISABLED = 'true';  // reextract uses callGemini regardless

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/core/ai/gemini.js', () => ({
  callGemini: vi.fn(async () => ({
    text: JSON.stringify({
      owner_name: 'Priya', owner_role: 'Founder',
      contact_email: 'priya@acme.test', contact_confidence: 'high', contact_source: 'pattern',
      tech_stack: ['WordPress'], website_problems: ['no SSL'],
      last_updated: '2024', has_ssl: 0, has_analytics: 0,
      business_signals: ['low reviews'], social_active: 0,
      website_quality_score: 4, judge_reason: 'dated',
      employees_estimate: '1-10', business_stage: 'owner-operated',
    }),
    costUsd: 0.0002,
  })),
}));

const { reextract } = await import('../../../src/core/pipeline/reextract.js');

describe('reextract', () => {
  it('returns parsed extraction data + cost', async () => {
    const r = await reextract({ business_name: 'Acme', website_url: 'https://acme.test', city: 'Mumbai' });
    expect(r.data.owner_name).toBe('Priya');
    expect(r.data.tech_stack).toEqual(['WordPress']);
    expect(r.costUsd).toBe(0.0002);
  });

  it('returns null data on parse failure', async () => {
    const { callGemini } = await import('../../../src/core/ai/gemini.js');
    callGemini.mockResolvedValueOnce({ text: 'not json', costUsd: 0.0001 });
    const r = await reextract({ business_name: 'X', website_url: 'https://x.test', city: 'M' });
    expect(r.data).toBeNull();
    expect(r.costUsd).toBe(0.0001);
  });
});
