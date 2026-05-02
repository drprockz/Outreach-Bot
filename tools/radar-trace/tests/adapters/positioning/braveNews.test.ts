import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makePositioningBraveNewsAdapter } from '../../../src/adapters/positioning/braveNews.js';
import type { AdapterContext } from '../../../src/types.js';
import { EMPTY_ANCHORS } from '../../../src/types.js';
import type { BraveClient } from '../../../src/clients/brave.js';

const braveFixture = JSON.parse(
  readFileSync(join(__dirname, '../../fixtures/brave/news-search.json'), 'utf8'),
);

function makeCtx(overrides: Partial<AdapterContext['input']> = {}): AdapterContext {
  const noop = () => {};
  return {
    input: { name: 'Acme Corp', domain: 'acme.com', ...overrides },
    http: (() => {}) as unknown as typeof fetch,
    cache: { read: async () => null, write: async () => {}, clear: async () => {} },
    logger: { debug: noop, info: noop, warn: noop, error: noop, child: () => makeCtx(overrides).logger },
    env: { BRAVE_API_KEY: 'fake-brave-key' },
    signal: new AbortController().signal,
      anchors: EMPTY_ANCHORS,
  };
}

function makeBraveSpy(results: typeof braveFixture.results): BraveClient {
  return {
    newsSearch: vi.fn(async () => ({ results, costPaise: 50 })),
  };
}

describe('positioningBraveNewsAdapter', () => {
  it('contract surface', () => {
    const adapter = makePositioningBraveNewsAdapter(() => makeBraveSpy([]));
    expect(adapter.name).toBe('positioning.brave_news');
    expect(adapter.module).toBe('positioning');
    expect(adapter.estimatedCostInr).toBe(1.0);
    expect(adapter.requiredEnv).toContain('BRAVE_API_KEY');
    expect(adapter.gate).toBeUndefined();
  });

  it('parses brave news fixture into results', async () => {
    const adapter = makePositioningBraveNewsAdapter(() => makeBraveSpy(braveFixture.results));
    const result = await adapter.run(makeCtx());
    expect(result.status).toBe('ok');
    expect(result.payload!.results.length).toBe(2);
    expect(result.payload!.results[0]!.title).toBe('Acme Corp Raises $10M in Series A Funding');
    expect(result.payload!.results[0]!.source).toBe('TechCrunch');
    expect(result.costPaise).toBe(50);
  });

  it('returns empty when no results found', async () => {
    const adapter = makePositioningBraveNewsAdapter(() => makeBraveSpy([]));
    const result = await adapter.run(makeCtx());
    expect(result.status).toBe('empty');
    expect(result.payload!.results).toHaveLength(0);
  });
});
