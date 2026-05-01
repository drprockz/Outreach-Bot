import { describe, it, expect, vi } from 'vitest';
import { makePositioningCrunchbaseSnippetAdapter } from '../../../src/adapters/positioning/crunchbaseSnippet.js';
import type { AdapterContext } from '../../../src/types.js';
import type { SerperClient } from '../../../src/clients/serper.js';

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

function makeSerperSpy(organic: Array<{ title: string; link: string; snippet: string }>): SerperClient {
  return {
    search: vi.fn(async () => ({ organic, costPaise: 3 })),
    newsSearch: vi.fn(async () => ({ news: [], costPaise: 3 })),
  };
}

describe('positioningCrunchbaseSnippetAdapter', () => {
  it('contract surface', () => {
    const adapter = makePositioningCrunchbaseSnippetAdapter(() => makeSerperSpy([]));
    expect(adapter.name).toBe('positioning.crunchbase_snippet');
    expect(adapter.module).toBe('positioning');
    expect(adapter.estimatedCostInr).toBe(0.03);
    expect(adapter.requiredEnv).toContain('SERPER_API_KEY');
    expect(adapter.gate).toBeUndefined();
  });

  it('finds crunchbase URL and snippet', async () => {
    const organic = [
      {
        title: 'Acme Corp - Crunchbase',
        link: 'https://www.crunchbase.com/organization/acme-corp',
        snippet: 'Acme Corp provides B2B SaaS solutions. The company has raised $5M in a Series A round led by...',
      },
    ];
    const adapter = makePositioningCrunchbaseSnippetAdapter(() => makeSerperSpy(organic));
    const result = await adapter.run(makeCtx());
    expect(result.status).toBe('ok');
    expect(result.payload!.crunchbaseUrl).toBe('https://www.crunchbase.com/organization/acme-corp');
    expect(result.payload!.snippet).toContain('Series A');
  });

  it('extracts funding hint from snippet via regex', async () => {
    const organic = [
      {
        title: 'Acme Corp - Crunchbase',
        link: 'https://www.crunchbase.com/organization/acme-corp',
        snippet: 'Acme Corp raised $10M in a Series B funding round in January 2024.',
      },
    ];
    const adapter = makePositioningCrunchbaseSnippetAdapter(() => makeSerperSpy(organic));
    const result = await adapter.run(makeCtx());
    expect(result.status).toBe('ok');
    expect(result.payload!.fundingHint).toBeTruthy();
    expect(result.payload!.fundingHint!.toLowerCase()).toMatch(/raised|series/i);
  });

  it('returns empty when no crunchbase result found', async () => {
    const organic = [
      { title: 'Some other result', link: 'https://example.com', snippet: 'Not crunchbase' },
    ];
    const adapter = makePositioningCrunchbaseSnippetAdapter(() => makeSerperSpy(organic));
    const result = await adapter.run(makeCtx());
    expect(result.status).toBe('empty');
    expect(result.payload!.crunchbaseUrl).toBeNull();
  });
});
