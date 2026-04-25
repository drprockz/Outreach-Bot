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
