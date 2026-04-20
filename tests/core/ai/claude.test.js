import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { truncateAll, closeTestPrisma } from '../../helpers/testDb.js';

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn(() => ({
    messages: {
      create: vi.fn(async () => ({
        content: [{ text: 'mock claude response' }],
        usage: { input_tokens: 100, output_tokens: 50 }
      }))
    }
  }))
}));

beforeEach(async () => {
  process.env.CLAUDE_DAILY_SPEND_CAP = '3.00';
  await truncateAll();
  const { resetDb } = await import('../../../src/core/db/index.js');
  await resetDb();
});

afterAll(async () => {
  const { resetDb } = await import('../../../src/core/db/index.js');
  await resetDb();
  await closeTestPrisma();
});

describe('claude client', () => {
  it('callClaude returns text and cost', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const { callClaude } = await import('../../../src/core/ai/claude.js');
    const result = await callClaude('sonnet', 'test prompt');
    expect(result.text).toBe('mock claude response');
    expect(typeof result.costUsd).toBe('number');
  });

  it('throws when daily spend cap exceeded', async () => {
    process.env.CLAUDE_DAILY_SPEND_CAP = '0.00';
    // Simulate spend already at cap by inserting a daily_metrics row
    const { getPrisma, today } = await import('../../../src/core/db/index.js');
    await getPrisma().dailyMetrics.create({
      data: { date: today(), sonnetCostUsd: 0.01, haikuCostUsd: 0.01 },
    });
    const { callClaude } = await import('../../../src/core/ai/claude.js');
    await expect(callClaude('haiku', 'test')).rejects.toThrow(/spend cap/i);
  });
});
