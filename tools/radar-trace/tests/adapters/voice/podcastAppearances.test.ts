import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeVoicePodcastAppearancesAdapter } from '../../../src/adapters/voice/podcastAppearances.js';
import type { AdapterContext } from '../../../src/types.js';

const listenNotesFixture = JSON.parse(
  readFileSync(join(__dirname, '../../fixtures/voice/listennotes-search.json'), 'utf8'),
);

function makeCtx(overrides: Partial<AdapterContext['input']> = {}): AdapterContext {
  const noop = () => {};
  return {
    input: { name: 'Acme', domain: 'acme.com', ...overrides },
    http: (() => {}) as unknown as typeof fetch,
    cache: { read: async () => null, write: async () => {}, clear: async () => {} },
    logger: { debug: noop, info: noop, warn: noop, error: noop, child: () => makeCtx(overrides).logger },
    env: { LISTEN_NOTES_KEY: 'fake-ln-key' },
    signal: new AbortController().signal,
  };
}

describe('voicePodcastAppearancesAdapter', () => {
  it('contract surface', () => {
    const adapter = makeVoicePodcastAppearancesAdapter();
    expect(adapter.name).toBe('voice.podcast_appearances');
    expect(adapter.module).toBe('voice');
    expect(adapter.estimatedCostInr).toBe(0);
    expect(adapter.requiredEnv).toContain('LISTEN_NOTES_KEY');
    expect(adapter.gate).toBeUndefined();
  });

  it('parses Listen Notes fixture into episodes', async () => {
    const fakeHttp = vi.fn(async () =>
      new Response(JSON.stringify(listenNotesFixture), { status: 200 }),
    ) as unknown as typeof fetch;
    const adapter = makeVoicePodcastAppearancesAdapter(() => fakeHttp);
    const result = await adapter.run(makeCtx({ founder: 'Jane Doe' }));
    expect(result.status).toBe('ok');
    expect(result.payload!.episodes.length).toBe(2);
    const ep1 = result.payload!.episodes[0]!;
    expect(ep1.podcastName).toBe('SaaS Founders Podcast');
    expect(ep1.episodeTitle).toBe('Jane Doe on Building Acme from Scratch');
    expect(ep1.publishedAt).toContain('2024');
    expect(ep1.listenNotesUrl).toContain('listennotes.com/e/ep1abc');
    expect(ep1.audioUrl).toBe('https://media.listennotes.com/ep1abc.mp3');
    const ep2 = result.payload!.episodes[1]!;
    expect(ep2.audioUrl).toBeNull();
    expect(result.payload!.totalFound).toBe(2);
  });

  it('returns error on 4xx response', async () => {
    const fakeHttp = vi.fn(async () =>
      new Response('unauthorized', { status: 401 }),
    ) as unknown as typeof fetch;
    const adapter = makeVoicePodcastAppearancesAdapter(() => fakeHttp);
    const result = await adapter.run(makeCtx());
    expect(result.status).toBe('error');
    expect(result.errors?.[0]).toContain('listennotes');
  });
});
