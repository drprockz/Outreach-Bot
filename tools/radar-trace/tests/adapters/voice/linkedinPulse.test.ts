import { describe, it, expect, vi } from 'vitest';
import { makeVoiceLinkedinPulseAdapter } from '../../../src/adapters/voice/linkedinPulse.js';
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

describe('voiceLinkedinPulseAdapter', () => {
  it('contract surface', () => {
    const adapter = makeVoiceLinkedinPulseAdapter(() => makeSerperSpy([]));
    expect(adapter.name).toBe('voice.linkedin_pulse');
    expect(adapter.module).toBe('voice');
    expect(adapter.estimatedCostInr).toBe(0.03);
    expect(adapter.requiredEnv).toContain('SERPER_API_KEY');
  });

  it('returns multiple articles from pulse results', async () => {
    const organic = [
      { title: 'Why B2B matters', link: 'https://www.linkedin.com/pulse/why-b2b-matters-jane-doe/', snippet: 'B2B outreach...' },
      { title: 'Scaling your team', link: 'https://linkedin.com/pulse/scaling-team-jane-doe/', snippet: 'Team scaling...' },
      { title: 'Unrelated result', link: 'https://linkedin.com/in/someuser/', snippet: 'Not a pulse article' },
    ];
    const adapter = makeVoiceLinkedinPulseAdapter(() => makeSerperSpy(organic));
    const result = await adapter.run(makeCtx({ founder: 'Jane Doe' }));
    expect(result.status).toBe('ok');
    expect(result.payload!.articles.length).toBe(2);
    expect(result.payload!.articles[0]!.url).toContain('linkedin.com/pulse/');
    expect(result.payload!.articles[1]!.url).toContain('linkedin.com/pulse/');
  });

  it('returns empty when no pulse articles match', async () => {
    const organic = [
      { title: 'Some result', link: 'https://linkedin.com/in/someuser/', snippet: 'Not a pulse' },
    ];
    const adapter = makeVoiceLinkedinPulseAdapter(() => makeSerperSpy(organic));
    const result = await adapter.run(makeCtx());
    expect(result.status).toBe('empty');
    expect(result.payload!.articles).toHaveLength(0);
  });
});
