process.env.ANTHROPIC_DISABLED = 'false';
process.env.ANTHROPIC_API_KEY = 'test-key';

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/core/ai/claude.js', () => ({
  callClaude: vi.fn(async () => ({ text: '  body text  ', costUsd: 0.0005, model: 'mock-haiku' })),
}));

const { regenerateBody } = await import('../../../src/core/pipeline/regenerateBody.js');

describe('regenerateBody', () => {
  it('returns trimmed body + cost + model', async () => {
    const lead = { business_name: 'Acme', contact_name: 'Priya', owner_name: null };
    const persona = { name: 'D', role: 'dev', company: 'X', services: 's', tone: 'casual' };
    const r = await regenerateBody(lead, 'the hook', persona);
    expect(r.body).toBe('body text');
    expect(r.costUsd).toBe(0.0005);
    expect(r.model).toBe('mock-haiku');
  });

  it('passes hook into prompt verbatim', async () => {
    const { callClaude } = await import('../../../src/core/ai/claude.js');
    callClaude.mockClear();
    await regenerateBody({ business_name: 'A' }, 'UNIQUE_HOOK_TOKEN', { name: 'D', role: 'r', company: 'c', services: 's', tone: 't' });
    expect(callClaude.mock.calls[0][1]).toContain('UNIQUE_HOOK_TOKEN');
  });
});
