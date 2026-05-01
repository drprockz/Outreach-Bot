import { describe, it, expect, vi } from 'vitest';
import { makeVoiceYoutubeChannelAdapter } from '../../../src/adapters/voice/youtubeChannel.js';
import type { AdapterContext } from '../../../src/types.js';
import type { SerperClient } from '../../../src/clients/serper.js';

const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/">
  <entry>
    <title>Acme Demo Day 2025</title>
    <yt:videoId>abc123</yt:videoId>
    <published>2025-04-01T10:00:00+00:00</published>
    <media:description>Our annual demo day highlights.</media:description>
  </entry>
  <entry>
    <title>How We Built Acme</title>
    <yt:videoId>def456</yt:videoId>
    <published>2025-03-15T10:00:00+00:00</published>
    <media:description>Behind the scenes at Acme.</media:description>
  </entry>
</feed>`;

const SAMPLE_HANDLE_HTML = `<html>
  <head>
    <meta itemprop="channelId" content="UCfakeChannelId123abc">
  </head>
  <body>Acme YouTube</body>
</html>`;

function makeCtx(
  httpRoutes: Record<string, () => Response> = {},
  overrides: Partial<AdapterContext['input']> = {},
): AdapterContext {
  const noop = () => {};
  const http = (async (url: string | URL | Request) => {
    const u = typeof url === 'string' ? url : url.toString();
    for (const [match, factory] of Object.entries(httpRoutes)) {
      if (u.includes(match)) return factory();
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  return {
    input: { name: 'Acme', domain: 'acme.com', ...overrides },
    http,
    cache: { read: async () => null, write: async () => {}, clear: async () => {} },
    logger: { debug: noop, info: noop, warn: noop, error: noop, child: () => makeCtx(httpRoutes, overrides).logger },
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

describe('voiceYoutubeChannelAdapter', () => {
  it('contract surface', () => {
    const adapter = makeVoiceYoutubeChannelAdapter(() => makeSerperSpy([]));
    expect(adapter.name).toBe('voice.youtube_channel');
    expect(adapter.module).toBe('voice');
    expect(adapter.estimatedCostInr).toBe(0.03);
    expect(adapter.requiredEnv).toContain('SERPER_API_KEY');
    expect(adapter.gate).toBeUndefined();
  });

  it('finds channel via /channel/ID URL and parses RSS', async () => {
    const organic = [
      { title: 'Acme - YouTube', link: 'https://www.youtube.com/channel/UCfakeChannelId123abc', snippet: 'Acme official channel' },
    ];
    const adapter = makeVoiceYoutubeChannelAdapter(() => makeSerperSpy(organic));
    const ctx = makeCtx({
      'feeds/videos.xml': () => new Response(SAMPLE_RSS, { status: 200 }),
    });
    const result = await adapter.run(ctx);
    expect(result.status).toBe('ok');
    expect(result.payload!.channelId).toBe('UCfakeChannelId123abc');
    expect(result.payload!.channelUrl).toContain('/channel/');
    expect(result.payload!.recentVideos.length).toBe(2);
    expect(result.payload!.recentVideos[0]!.title).toBe('Acme Demo Day 2025');
    expect(result.payload!.recentVideos[0]!.url).toContain('watch?v=abc123');
  });

  it('finds channel via @handle URL and extracts channel ID from page HTML', async () => {
    const organic = [
      { title: 'Acme - YouTube', link: 'https://www.youtube.com/@AcmeCorp', snippet: 'Acme Corp YouTube' },
    ];
    const adapter = makeVoiceYoutubeChannelAdapter(() => makeSerperSpy(organic));
    const ctx = makeCtx({
      '@AcmeCorp': () => new Response(SAMPLE_HANDLE_HTML, { status: 200 }),
      'feeds/videos.xml': () => new Response(SAMPLE_RSS, { status: 200 }),
    });
    const result = await adapter.run(ctx);
    expect(result.status).toBe('ok');
    expect(result.payload!.channelUrl).toContain('@AcmeCorp');
    expect(result.payload!.channelId).toBe('UCfakeChannelId123abc');
    expect(result.payload!.recentVideos.length).toBe(2);
  });

  it('returns empty when no YouTube presence found', async () => {
    const adapter = makeVoiceYoutubeChannelAdapter(() => makeSerperSpy([]));
    const result = await adapter.run(makeCtx());
    expect(result.status).toBe('empty');
    expect(result.payload!.channelUrl).toBeNull();
    expect(result.payload!.channelId).toBeNull();
    expect(result.payload!.recentVideos).toHaveLength(0);
  });
});
