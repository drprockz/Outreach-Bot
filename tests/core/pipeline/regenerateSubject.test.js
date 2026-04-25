process.env.ANTHROPIC_DISABLED = 'false';
process.env.ANTHROPIC_API_KEY = 'test-key';

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/core/ai/claude.js', () => ({
  callClaude: vi.fn(async () => ({ text: '  Quick question for Acme  ', costUsd: 0.0001, model: 'mock-haiku' })),
}));

const { regenerateSubject } = await import('../../../src/core/pipeline/regenerateSubject.js');

describe('regenerateSubject', () => {
  it('returns trimmed subject + cost', async () => {
    const r = await regenerateSubject({ business_name: 'Acme' });
    expect(r.subject).toBe('Quick question for Acme');
    expect(r.costUsd).toBe(0.0001);
  });
});
