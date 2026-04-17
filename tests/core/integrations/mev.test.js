import { describe, it, expect, vi } from 'vitest';

vi.mock('axios', () => ({
  default: {
    get: vi.fn(async () => ({
      data: { status: 'valid', free_email: false, disposable: false, score: 0.9 }
    }))
  }
}));

describe('mev client', () => {
  it('verifyEmail returns status and confidence', async () => {
    process.env.MEV_API_KEY = 'test-key';
    const { verifyEmail } = await import('../../../src/core/integrations/mev.js');
    const result = await verifyEmail('test@example.com');
    expect(result.status).toBe('valid');
    expect(typeof result.confidence).toBe('number');
  });

  it('returns skipped when no API key', async () => {
    delete process.env.MEV_API_KEY;
    const { verifyEmail } = await import('../../../src/core/integrations/mev.js');
    const result = await verifyEmail('test@example.com');
    expect(result.status).toBe('skipped');
  });
});
