import { describe, it, expect, vi } from 'vitest';
import { makeVoiceFounderLinkedinUrlAdapter } from '../../../src/adapters/voice/founderLinkedinUrl.js';
import type { AdapterContext } from '../../../src/types.js';
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
  };
}

function makeSerperSpy(organic: Array<{ title: string; link: string; snippet: string }>): SerperClient {
  return {
    search: vi.fn(async () => ({ organic, costPaise: 3 })),
    newsSearch: vi.fn(async () => ({ news: [], costPaise: 3 })),
  };
}

describe('voiceFounderLinkedinUrlAdapter', () => {
  it('contract surface', () => {
    const adapter = makeVoiceFounderLinkedinUrlAdapter(() => makeSerperSpy([]));
    expect(adapter.name).toBe('voice.founder_linkedin_url');
    expect(adapter.module).toBe('voice');
    expect(adapter.version).toBe('0.1.0');
    expect(adapter.estimatedCostInr).toBe(0.03);
    expect(adapter.requiredEnv).toContain('SERPER_API_KEY');
    expect(adapter.gate).toBeUndefined();
  });

  it('returns ok with URL when Serper finds linkedin.com/in/ result', async () => {
    const organic = [
      { title: 'Jane Doe - Founder at Acme - LinkedIn', link: 'https://www.linkedin.com/in/janedoe/', snippet: 'Jane Doe...' },
      { title: 'Acme Corp', link: 'https://acme.com/about', snippet: 'Founded by Jane...' },
    ];
    const serperSpy = makeSerperSpy(organic);
    const adapter = makeVoiceFounderLinkedinUrlAdapter(() => serperSpy);
    const result = await adapter.run(makeCtx({ founder: 'Jane Doe' }));
    expect(result.status).toBe('ok');
    expect(result.payload!.url).toBe('https://www.linkedin.com/in/janedoe/');
    expect(result.payload!.candidates.length).toBeGreaterThan(0);
    expect(result.costPaise).toBe(3);
  });

  it('returns empty when no founder name provided', async () => {
    const serperSpy = makeSerperSpy([]);
    const adapter = makeVoiceFounderLinkedinUrlAdapter(() => serperSpy);
    const result = await adapter.run(makeCtx({ founder: undefined }));
    expect(result.status).toBe('empty');
    expect(result.payload!.url).toBeNull();
    expect(serperSpy.search).not.toHaveBeenCalled();
  });

  it('returns ok with URL when input.founderLinkedinUrl is already set (no Serper call)', async () => {
    const serperSpy = makeSerperSpy([]);
    const adapter = makeVoiceFounderLinkedinUrlAdapter(() => serperSpy);
    const result = await adapter.run(makeCtx({
      founder: 'Jane Doe',
      founderLinkedinUrl: 'https://linkedin.com/in/janedoe',
    }));
    expect(result.status).toBe('ok');
    expect(result.payload!.url).toBe('https://linkedin.com/in/janedoe');
    expect(serperSpy.search).not.toHaveBeenCalled();
  });

  it('returns error when Serper throws', async () => {
    const errorSerper: SerperClient = {
      search: vi.fn(async () => { throw new Error('rate limited'); }),
      newsSearch: vi.fn(async () => { throw new Error('rate limited'); }),
    };
    const adapter = makeVoiceFounderLinkedinUrlAdapter(() => errorSerper);
    const result = await adapter.run(makeCtx({ founder: 'Jane Doe' }));
    expect(result.status).toBe('error');
    expect(result.errors?.[0]).toContain('rate limited');
  });
});
