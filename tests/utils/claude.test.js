import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

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

let tmpDir;
beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'radar-test-'));
  process.env.DB_PATH = join(tmpDir, 'radar.sqlite');
  process.env.CLAUDE_DAILY_SPEND_CAP = '3.00';
  const { resetDb, initSchema } = await import('../../utils/db.js');
  resetDb();
  initSchema();
});

afterEach(async () => {
  const { resetDb } = await import('../../utils/db.js');
  resetDb();
  rmSync(tmpDir, { recursive: true });
});

describe('claude client', () => {
  it('callClaude returns text and cost', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const { callClaude } = await import('../../utils/claude.js');
    const result = await callClaude('sonnet', 'test prompt');
    expect(result.text).toBe('mock claude response');
    expect(typeof result.costUsd).toBe('number');
  });

  it('throws when daily spend cap exceeded', async () => {
    process.env.CLAUDE_DAILY_SPEND_CAP = '0.00';
    // Simulate spend already at cap by inserting a daily_metrics row
    const { getDb, today } = await import('../../utils/db.js');
    getDb().prepare(
      `INSERT INTO daily_metrics (date, sonnet_cost_usd, haiku_cost_usd) VALUES (?, 0.01, 0.01)`
    ).run(today());
    const { callClaude } = await import('../../utils/claude.js');
    await expect(callClaude('haiku', 'test')).rejects.toThrow(/spend cap/i);
  });
});
