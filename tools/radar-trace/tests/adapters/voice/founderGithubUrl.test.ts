import { describe, it, expect, vi } from 'vitest';
import { makeVoiceFounderGithubUrlAdapter } from '../../../src/adapters/voice/founderGithubUrl.js';
import type { AdapterContext } from '../../../src/types.js';
import { EMPTY_ANCHORS } from '../../../src/types.js';
import type { SerperClient } from '../../../src/clients/serper.js';

function makeCtx(overrides: Partial<AdapterContext['input']> = {}): AdapterContext {
  const noop = () => {};
  return {
    input: { name: 'Acme', domain: 'acme.com', ...overrides },
    http: (() => {}) as unknown as typeof fetch,
    cache: { read: async () => null, write: async () => {}, clear: async () => {} },
    logger: { debug: noop, info: noop, warn: noop, error: noop, child: () => makeCtx(overrides).logger },
    env: { SERPER_API_KEY: 'fake-key' },
    signal: new AbortController().signal,
      anchors: EMPTY_ANCHORS,
  };
}

function makeSerperSpy(organic: Array<{ title: string; link: string; snippet: string }>): SerperClient {
  return {
    search: vi.fn(async () => ({ organic, costPaise: 3 })),
    newsSearch: vi.fn(async () => ({ news: [], costPaise: 3 })),
  };
}

describe('voiceFounderGithubUrlAdapter', () => {
  it('contract surface', () => {
    const adapter = makeVoiceFounderGithubUrlAdapter(() => makeSerperSpy([]));
    expect(adapter.name).toBe('voice.founder_github_url');
    expect(adapter.module).toBe('voice');
    expect(adapter.estimatedCostInr).toBe(0.5);
    expect(adapter.requiredEnv).toContain('SERPER_API_KEY');
    expect(adapter.gate).toBeUndefined();
  });

  it('returns ok with URL when Serper finds github.com/{user} result', async () => {
    const organic = [
      { title: 'janedoe (Jane Doe) - GitHub', link: 'https://github.com/janedoe', snippet: 'Founder at Acme' },
      { title: 'janedoe/acme-sdk', link: 'https://github.com/janedoe/acme-sdk', snippet: 'SDK for Acme' },
    ];
    const adapter = makeVoiceFounderGithubUrlAdapter(() => makeSerperSpy(organic));
    const result = await adapter.run(makeCtx({ founder: 'Jane Doe' }));
    expect(result.status).toBe('ok');
    expect(result.payload!.url).toBe('https://github.com/janedoe');
    expect(result.costPaise).toBe(3);
  });

  it('returns empty when no founder name provided', async () => {
    const serperSpy = makeSerperSpy([]);
    const adapter = makeVoiceFounderGithubUrlAdapter(() => serperSpy);
    const result = await adapter.run(makeCtx({ founder: undefined }));
    expect(result.status).toBe('empty');
    expect(result.payload!.url).toBeNull();
    expect(serperSpy.search).not.toHaveBeenCalled();
  });

  it('returns error when Serper throws', async () => {
    const errorSerper: SerperClient = {
      search: vi.fn(async () => { throw new Error('network timeout'); }),
      newsSearch: vi.fn(async () => { throw new Error('network timeout'); }),
    };
    const adapter = makeVoiceFounderGithubUrlAdapter(() => errorSerper);
    const result = await adapter.run(makeCtx({ founder: 'Jane Doe' }));
    expect(result.status).toBe('error');
    expect(result.errors?.[0]).toContain('network timeout');
  });
});
