import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeFacebookPostsApifyAdapter } from '../../../src/adapters/social/facebookPostsApify.js';
import type { AdapterContext } from '../../../src/types.js';
import type { SerperClient } from '../../../src/clients/serper.js';
import type { ApifyClient } from '../../../src/clients/apify.js';

const facebookPostsFixture = JSON.parse(
  readFileSync(join(__dirname, '../../fixtures/apify/facebook-posts.json'), 'utf8'),
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

describe('facebookPostsApifyAdapter', () => {
  it('contract surface', () => {
    const adapter = makeFacebookPostsApifyAdapter({
      serper: () => makeSerperSpy([]),
      apify: () => makeApifySpy([]),
    });
    expect(adapter.name).toBe('social.facebook_posts_apify');
    expect(adapter.module).toBe('social');
    expect(adapter.version).toBe('0.1.0');
    expect(adapter.estimatedCostInr).toBe(100);
    expect(adapter.requiredEnv).toContain('APIFY_TOKEN');
    expect(adapter.requiredEnv).toContain('SERPER_API_KEY');
    expect(adapter.cacheTtlMs).toBe(6 * 60 * 60 * 1000);
    expect(adapter.gate).toBeUndefined();
  });

  it('discovers Facebook URL via Serper, runs Apify, returns posts', async () => {
    const organic = [
      {
        title: 'Acme Corp | Facebook',
        link: 'https://www.facebook.com/acmecorp',
        snippet: 'B2B SaaS company',
      },
      // Post URL that should NOT match
      {
        title: 'Acme Corp Post',
        link: 'https://www.facebook.com/acmecorp/posts/987654321',
        snippet: '',
      },
    ];
    const adapter = makeFacebookPostsApifyAdapter({
      serper: () => makeSerperSpy(organic),
      apify: () => makeApifySpy(facebookPostsFixture),
    });

    const result = await adapter.run(makeCtx());
    expect(result.status).toBe('ok');
    expect(result.payload!.facebookUrl).toBe('https://www.facebook.com/acmecorp');
    expect(result.payload!.posts).toHaveLength(3);
    expect(result.payload!.totalFetched).toBe(3);

    // First post has image
    const firstPost = result.payload!.posts[0]!;
    expect(firstPost.text).toContain('10,000 followers');
    expect(firstPost.likes).toBe(378);
    expect(firstPost.comments).toBe(203);
    expect(firstPost.shares).toBe(156);
    expect(firstPost.mediaType).toBe('image');
    expect(firstPost.postUrl).toContain('facebook.com');

    // Second post has no media
    const secondPost = result.payload!.posts[1]!;
    expect(secondPost.mediaType).toBe('none');
    expect(secondPost.mediaUrl).toBeNull();

    // Third post has video
    const thirdPost = result.payload!.posts[2]!;
    expect(thirdPost.mediaType).toBe('video');
  });

  it('returns empty when Serper finds no Facebook page URL', async () => {
    const organic = [
      // Post URL — has /posts/ path segment, should not match
      { title: 'Acme Post', link: 'https://www.facebook.com/acmecorp/posts/12345', snippet: '' },
      { title: 'Other', link: 'https://acme.com', snippet: '' },
    ];
    const apifySpy = makeApifySpy(facebookPostsFixture);
    const adapter = makeFacebookPostsApifyAdapter({
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
      { title: 'Acme Corp | Facebook', link: 'https://www.facebook.com/acmecorp', snippet: '' },
    ];
    const adapter = makeFacebookPostsApifyAdapter({
      serper: () => makeSerperSpy(organic),
      apify: () => makeApifySpy(facebookPostsFixture),
    });

    const result = await adapter.run(makeCtx());
    expect(result.status).toBe('ok');

    const itemCount = facebookPostsFixture.length; // 3
    const expectedApifyUsd = itemCount * 0.005;
    expect(result.costMeta?.costUsd).toBeCloseTo(expectedApifyUsd);
    expect(result.costMeta?.apifyResults).toBe(itemCount);

    const expectedApifyPaise = Math.round(expectedApifyUsd * 84 * 100);
    expect(result.costPaise).toBe(3 + expectedApifyPaise);
  });
});
