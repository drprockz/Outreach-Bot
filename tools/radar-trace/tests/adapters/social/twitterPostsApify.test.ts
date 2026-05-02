import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTwitterPostsApifyAdapter } from '../../../src/adapters/social/twitterPostsApify.js';
import type { AdapterContext } from '../../../src/types.js';
import { EMPTY_ANCHORS } from '../../../src/types.js';
import type { SerperClient } from '../../../src/clients/serper.js';
import type { ApifyClient } from '../../../src/clients/apify.js';

const twitterPostsFixture = JSON.parse(
  readFileSync(join(__dirname, '../../fixtures/apify/twitter-posts.json'), 'utf8'),
) as unknown[];

function makeCtx(overrides: Partial<AdapterContext> = {}): AdapterContext {
  const noop = () => {};
  return {
    input: { name: 'Acme Corp', domain: 'acme.com' },
    http: (() => {}) as unknown as typeof fetch,
    cache: { read: async () => null, write: async () => {}, clear: async () => {} },
    logger: { debug: noop, info: noop, warn: noop, error: noop, child: () => makeCtx().logger },
    env: { SERPER_API_KEY: 'fake-key', APIFY_TOKEN: 'fake-token' },
    signal: new AbortController().signal,
      anchors: EMPTY_ANCHORS,    ...overrides,
  };
}

function makeSerperSpy(
  organic: Array<{ title: string; link: string; snippet: string }>,
): SerperClient {
  return {
    search: vi.fn(async () => ({ organic, costPaise: 3 })),
    newsSearch: vi.fn(async () => ({ news: [], costPaise: 3 })),
  };
}

function makeApifySpy(items: unknown[]): ApifyClient {
  return {
    runActor: vi.fn(async () => ({
      items,
      costUsd: items.length * 0.005,
      truncated: false,
    })) as ApifyClient['runActor'],
  };
}

describe('twitterPostsApifyAdapter', () => {
  it('contract surface', () => {
    const adapter = makeTwitterPostsApifyAdapter({
      serper: () => makeSerperSpy([]),
      apify: () => makeApifySpy([]),
    });
    expect(adapter.name).toBe('social.twitter_posts_apify');
    expect(adapter.module).toBe('social');
    expect(adapter.version).toBe('0.2.0');
    expect(adapter.estimatedCostInr).toBe(100);
    expect(adapter.requiredEnv).toContain('APIFY_TOKEN');
    expect(adapter.requiredEnv).toContain('SERPER_API_KEY');
    expect(adapter.cacheTtlMs).toBe(6 * 60 * 60 * 1000);
    expect(adapter.gate).toBeUndefined();
  });

  it('discovers Twitter URL via Serper, runs Apify, returns tweets', async () => {
    const organic = [
      {
        title: 'Acme Corp (@acmecorp) / X',
        link: 'https://twitter.com/acmecorp',
        snippet: 'Official account',
      },
      // A tweet URL that should NOT match (has a path beyond the handle)
      {
        title: 'Some tweet',
        link: 'https://twitter.com/acmecorp/status/1234',
        snippet: '',
      },
    ];
    const adapter = makeTwitterPostsApifyAdapter({
      serper: () => makeSerperSpy(organic),
      apify: () => makeApifySpy(twitterPostsFixture),
    });

    const result = await adapter.run(makeCtx());
    expect(result.status).toBe('ok');
    expect(result.payload!.twitterUrl).toBe('https://twitter.com/acmecorp');
    expect(result.payload!.tweets).toHaveLength(3);
    expect(result.payload!.totalFetched).toBe(3);

    // First tweet has image
    const firstTweet = result.payload!.tweets[0]!;
    expect(firstTweet.text).toContain('shipped v2.0');
    expect(firstTweet.likes).toBe(284);
    expect(firstTweet.retweets).toBe(67);
    expect(firstTweet.quoteCount).toBe(12);
    expect(firstTweet.mediaType).toBe('image');
    expect(firstTweet.tweetUrl).toContain('twitter.com');

    // Second tweet has no media
    const secondTweet = result.payload!.tweets[1]!;
    expect(secondTweet.mediaType).toBe('none');

    // Third tweet has video
    const thirdTweet = result.payload!.tweets[2]!;
    expect(thirdTweet.mediaType).toBe('video');
  });

  it('returns empty when Serper finds no Twitter handle URL', async () => {
    const organic = [
      // tweet-specific URL — should not match
      { title: 'Acme tweet', link: 'https://twitter.com/acmecorp/status/12345', snippet: '' },
      { title: 'Other site', link: 'https://acme.com', snippet: '' },
    ];
    const apifySpy = makeApifySpy(twitterPostsFixture);
    const adapter = makeTwitterPostsApifyAdapter({
      serper: () => makeSerperSpy(organic),
      apify: () => apifySpy,
    });

    const result = await adapter.run(makeCtx());
    expect(result.status).toBe('empty');
    expect(result.payload).toBeNull();
    // Apify must not be called
    expect(apifySpy.runActor).not.toHaveBeenCalled();
  });

  it('reports costMeta.costUsd and costPaise correctly', async () => {
    const organic = [
      { title: 'Acme Corp (@acmecorp) / X', link: 'https://twitter.com/acmecorp', snippet: '' },
    ];
    const adapter = makeTwitterPostsApifyAdapter({
      serper: () => makeSerperSpy(organic),
      apify: () => makeApifySpy(twitterPostsFixture),
    });

    const result = await adapter.run(makeCtx());
    expect(result.status).toBe('ok');

    const itemCount = twitterPostsFixture.length; // 3
    const expectedApifyUsd = itemCount * 0.005;
    expect(result.costMeta?.costUsd).toBeCloseTo(expectedApifyUsd);
    expect(result.costMeta?.apifyResults).toBe(itemCount);

    // costPaise = Serper (3) + Apify (3 × 0.005 × 84 × 100 = 126)
    const expectedApifyPaise = Math.round(expectedApifyUsd * 84 * 100);
    expect(result.costPaise).toBe(3 + expectedApifyPaise);
  });
});
