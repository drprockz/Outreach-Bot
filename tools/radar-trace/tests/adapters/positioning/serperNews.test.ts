import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makePositioningSerperNewsAdapter } from '../../../src/adapters/positioning/serperNews.js';
import type { AdapterContext } from '../../../src/types.js';
import type { SerperClient } from '../../../src/clients/serper.js';

const serperNewsFixture = JSON.parse(
  readFileSync(join(__dirname, '../../fixtures/serper/news-search.json'), 'utf8'),
);

function makeCtx(overrides: Partial<AdapterContext['input']> = {}): AdapterContext {
  const noop = () => {};
  return {
    input: { name: 'Acme Corp', domain: 'acme.com', ...overrides },
    http: (() => {}) as unknown as typeof fetch,
    cache: { read: async () => null, write: async () => {}, clear: async () => {} },
    logger: { debug: noop, info: noop, warn: noop, error: noop, child: () => makeCtx(overrides).logger },
    env: { SERPER_API_KEY: 'fake-key' },
    signal: new AbortController().signal,
  };
}

function makeSerperSpy(newsResults: typeof serperNewsFixture.news): SerperClient {
  return {
    search: vi.fn(async () => ({ organic: [], costPaise: 3 })),
    newsSearch: vi.fn(async () => ({ news: newsResults, costPaise: 3 })),
  };
}

describe('positioningSerperNewsAdapter', () => {
  it('contract surface', () => {
    const adapter = makePositioningSerperNewsAdapter(() => makeSerperSpy([]));
    expect(adapter.name).toBe('positioning.serper_news');
    expect(adapter.module).toBe('positioning');
    expect(adapter.estimatedCostInr).toBe(0.03);
    expect(adapter.requiredEnv).toContain('SERPER_API_KEY');
    expect(adapter.gate).toBeUndefined();
  });

  it('parses serper news fixture into results', async () => {
    const adapter = makePositioningSerperNewsAdapter(() => makeSerperSpy(serperNewsFixture.news));
    const result = await adapter.run(makeCtx());
    expect(result.status).toBe('ok');
    expect(result.payload!.results.length).toBe(2);
    expect(result.payload!.results[0]!.title).toBe('Acme Corp Raises $10M Series A');
    expect(result.payload!.results[0]!.url).toContain('techcrunch.com');
    expect(result.costPaise).toBe(3);
  });

  it('returns empty when no results found', async () => {
    const adapter = makePositioningSerperNewsAdapter(() => makeSerperSpy([]));
    const result = await adapter.run(makeCtx());
    expect(result.status).toBe('empty');
    expect(result.payload!.results).toHaveLength(0);
  });
});
