import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeInstagramPostsApifyAdapter } from '../../../src/adapters/social/instagramPostsApify.js';
import type { AdapterContext } from '../../../src/types.js';
import type { SerperClient } from '../../../src/clients/serper.js';
import type { ApifyClient } from '../../../src/clients/apify.js';

const instagramPostsFixture = JSON.parse(
  readFileSync(join(__dirname, '../../fixtures/apify/instagram-posts.json'), 'utf8'),
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
    ...overrides,
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

describe('instagramPostsApifyAdapter', () => {
  it('contract surface', () => {
    const adapter = makeInstagramPostsApifyAdapter({
      serper: () => makeSerperSpy([]),
      apify: () => makeApifySpy([]),
    });
    expect(adapter.name).toBe('social.instagram_posts_apify');
    expect(adapter.module).toBe('social');
    expect(adapter.version).toBe('0.1.0');
    expect(adapter.estimatedCostInr).toBe(100);
    expect(adapter.requiredEnv).toContain('APIFY_TOKEN');
    expect(adapter.requiredEnv).toContain('SERPER_API_KEY');
    expect(adapter.cacheTtlMs).toBe(6 * 60 * 60 * 1000);
    expect(adapter.gate).toBeUndefined();
  });

  it('discovers Instagram URL via Serper, runs Apify, returns posts', async () => {
    const organic = [
      {
        title: 'Acme Corp (@acmecorp) • Instagram photos and videos',
        link: 'https://www.instagram.com/acmecorp/',
        snippet: 'B2B SaaS startup',
      },
    ];
    const apifySpy = makeApifySpy(instagramPostsFixture);
    const adapter = makeInstagramPostsApifyAdapter({
      serper: () => makeSerperSpy(organic),
      apify: () => apifySpy,
    });

    const result = await adapter.run(makeCtx());
    expect(result.status).toBe('ok');
    expect(result.payload!.instagramUrl).toBe('https://www.instagram.com/acmecorp/');
    expect(result.payload!.posts).toHaveLength(3);
    expect(result.payload!.totalFetched).toBe(3);

    // First post is carousel
    const firstPost = result.payload!.posts[0]!;
    expect(firstPost.caption).toContain('offsite');
    expect(firstPost.likes).toBe(1247);
    expect(firstPost.comments).toBe(89);
    expect(firstPost.mediaType).toBe('carousel');
    expect(firstPost.postUrl).toContain('instagram.com/p/');

    // Second post is image
    const secondPost = result.payload!.posts[1]!;
    expect(secondPost.mediaType).toBe('image');

    // Third post is video
    const thirdPost = result.payload!.posts[2]!;
    expect(thirdPost.mediaType).toBe('video');
  });

  it('returns empty when Serper finds no Instagram profile URL', async () => {
    const organic = [
      // post URL — should not match profile pattern
      { title: 'Some post', link: 'https://www.instagram.com/p/C5xyz123/', snippet: '' },
      { title: 'Other site', link: 'https://acme.com', snippet: '' },
    ];
    const apifySpy = makeApifySpy(instagramPostsFixture);
    const adapter = makeInstagramPostsApifyAdapter({
      serper: () => makeSerperSpy(organic),
      apify: () => apifySpy,
    });

    const result = await adapter.run(makeCtx());
    expect(result.status).toBe('empty');
    expect(result.payload).toBeNull();
    expect(apifySpy.runActor).not.toHaveBeenCalled();
  });

  it('reports costMeta.costUsd and costPaise correctly', async () => {
    const organic = [
      { title: 'Acme Corp Instagram', link: 'https://www.instagram.com/acmecorp/', snippet: '' },
    ];
    const adapter = makeInstagramPostsApifyAdapter({
      serper: () => makeSerperSpy(organic),
      apify: () => makeApifySpy(instagramPostsFixture),
    });

    const result = await adapter.run(makeCtx());
    expect(result.status).toBe('ok');

    const itemCount = instagramPostsFixture.length; // 3
    const expectedApifyUsd = itemCount * 0.005;
    expect(result.costMeta?.costUsd).toBeCloseTo(expectedApifyUsd);
    expect(result.costMeta?.apifyResults).toBe(itemCount);

    const expectedApifyPaise = Math.round(expectedApifyUsd * 84 * 100);
    expect(result.costPaise).toBe(3 + expectedApifyPaise);
  });
});
