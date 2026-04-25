process.env.ANTHROPIC_DISABLED = 'false';
process.env.ANTHROPIC_API_KEY = 'test-key';

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/core/ai/claude.js', () => ({
  callClaude: vi.fn(async (model, prompt) => ({
    text: prompt.includes('curious-question') ? 'B-hook' : 'A-hook',
    costUsd: 0.001,
    model: `mock-${model}`,
  })),
}));

const { regenerateHook } = await import('../../../src/core/pipeline/regenerateHook.js');

describe('regenerateHook', () => {
  const lead = { business_name: 'Acme', website_url: 'https://acme.test', manual_hook_note: null };
  const persona = { name: 'D', role: 'dev', company: 'X', services: 's', tone: 'casual' };

  it('returns chosen variant + summed cost of A+B', async () => {
    const r = await regenerateHook(lead, persona, []);
    expect(['A-hook', 'B-hook']).toContain(r.hook);
    expect(r.costUsd).toBeCloseTo(0.002, 6);
    expect(r.hookVariantId).toMatch(/^[AB]$/);
    expect(r.model).toMatch(/^mock-sonnet$/);
  });

  it('weaves signals into prompt when present', async () => {
    const { callClaude } = await import('../../../src/core/ai/claude.js');
    callClaude.mockClear();
    await regenerateHook(lead, persona, [{ signalType: 'hiring', headline: 'h1', url: 'u1' }]);
    const prompt = callClaude.mock.calls[0][1];
    expect(prompt).toContain('hiring');
    expect(prompt).toContain('h1');
  });

  it('appends manual_hook_note hint when set', async () => {
    const { callClaude } = await import('../../../src/core/ai/claude.js');
    callClaude.mockClear();
    await regenerateHook({ ...lead, manual_hook_note: 'angle: US expansion' }, persona, []);
    const prompt = callClaude.mock.calls[0][1];
    expect(prompt).toContain('angle: US expansion');
  });
});
