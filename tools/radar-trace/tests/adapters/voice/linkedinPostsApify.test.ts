import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeVoiceLinkedinPostsApifyAdapter } from '../../../src/adapters/voice/linkedinPostsApify.js';
import type { AdapterContext } from '../../../src/types.js';
import type { SerperClient } from '../../../src/clients/serper.js';
import type { ApifyClient } from '../../../src/clients/apify.js';

const linkedinPostsFixture = JSON.parse(
  readFileSync(join(__dirname, '../../fixtures/apify/linkedin-posts.json'), 'utf8'),
) as unknown[];

function makeCtx(overrides: Partial<AdapterContext> = {}): AdapterContext {
  const noop = () => {};
  return {
    input: { name: 'Acme Corp', domain: 'acme.com', founder: 'John Doe' },
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

describe('voiceLinkedinPostsApifyAdapter', () => {
  it('contract surface', () => {
    const adapter = makeVoiceLinkedinPostsApifyAdapter({
      serper: () => makeSerperSpy([]),
      apify: () => makeApifySpy([]),
    });
    expect(adapter.name).toBe('voice.linkedin_posts_apify');
    expect(adapter.module).toBe('voice');
    expect(adapter.version).toBe('0.1.0');
    expect(adapter.estimatedCostInr).toBe(100);
    expect(adapter.requiredEnv).toContain('APIFY_TOKEN');
    expect(adapter.requiredEnv).toContain('SERPER_API_KEY');
    expect(adapter.cacheTtlMs).toBe(6 * 60 * 60 * 1000);
    expect(adapter.gate).toBeUndefined();
  });

  it('discovers URL via Serper, runs Apify, returns posts', async () => {
    const organic = [
      {
        title: 'John Doe | LinkedIn',
        link: 'https://www.linkedin.com/in/johndoe/',
        snippet: 'Co-founder at Acme Corp',
      },
    ];
    const serperSpy = makeSerperSpy(organic);
    const apifySpy = makeApifySpy(linkedinPostsFixture);
    const adapter = makeVoiceLinkedinPostsApifyAdapter({
      serper: () => serperSpy,
      apify: () => apifySpy,
    });

    const result = await adapter.run(makeCtx());
    expect(result.status).toBe('ok');
    expect(result.payload!.founderLinkedinUrl).toBe('https://www.linkedin.com/in/johndoe/');
    expect(result.payload!.posts).toHaveLength(3);
    expect(result.payload!.totalFetched).toBe(3);

    // Check first post mapping
    const firstPost = result.payload!.posts[0]!;
    expect(firstPost.text).toContain('Series A');
    expect(firstPost.reactionsCount).toBe(342);
    expect(firstPost.commentsCount).toBe(47);
    expect(firstPost.sharesCount).toBe(28);
    expect(firstPost.mediaType).toBe('image');
    expect(firstPost.postUrl).toContain('linkedin.com');

    // Second post has article
    const secondPost = result.payload!.posts[1]!;
    expect(secondPost.mediaType).toBe('article');
    expect(secondPost.mediaUrl).toContain('blog.acme.com');

    // Third post has no media
    const thirdPost = result.payload!.posts[2]!;
    expect(thirdPost.mediaType).toBe('none');
    expect(thirdPost.mediaUrl).toBeNull();
  });

  it('returns empty when Serper finds no LinkedIn profile URL AND founderLinkedinUrl not provided', async () => {
    const organic = [
      { title: 'Acme Corp LinkedIn', link: 'https://linkedin.com/company/acme', snippet: '' },
      { title: 'Something else', link: 'https://example.com', snippet: '' },
    ];
    const serperSpy = makeSerperSpy(organic);
    const apifySpy = makeApifySpy(linkedinPostsFixture);
    const adapter = makeVoiceLinkedinPostsApifyAdapter({
      serper: () => serperSpy,
      apify: () => apifySpy,
    });

    const result = await adapter.run(makeCtx());
    expect(result.status).toBe('empty');
    expect(result.payload).toBeNull();
    expect(result.errors).toContain('no founder URL');
    // Apify should NOT have been called
    expect(apifySpy.runActor).not.toHaveBeenCalled();
  });

  it('uses founderLinkedinUrl directly — no Serper call', async () => {
    const serperSpy = makeSerperSpy([]);
    const apifySpy = makeApifySpy(linkedinPostsFixture);
    const adapter = makeVoiceLinkedinPostsApifyAdapter({
      serper: () => serperSpy,
      apify: () => apifySpy,
    });

    const ctx = makeCtx({
      input: {
        name: 'Acme Corp',
        domain: 'acme.com',
        founder: 'John Doe',
        founderLinkedinUrl: 'https://www.linkedin.com/in/johndoe/',
      },
    });

    const result = await adapter.run(ctx);
    expect(result.status).toBe('ok');
    expect(result.payload!.founderLinkedinUrl).toBe('https://www.linkedin.com/in/johndoe/');
    // Serper should NOT have been called
    expect(serperSpy.search).not.toHaveBeenCalled();
  });

  it('reports costMeta.costUsd and costPaise correctly', async () => {
    const organic = [
      {
        title: 'John Doe | LinkedIn',
        link: 'https://www.linkedin.com/in/johndoe/',
        snippet: '',
      },
    ];
    const adapter = makeVoiceLinkedinPostsApifyAdapter({
      serper: () => makeSerperSpy(organic),
      apify: () => makeApifySpy(linkedinPostsFixture),
    });

    const result = await adapter.run(makeCtx());
    expect(result.status).toBe('ok');

    const itemCount = linkedinPostsFixture.length; // 3
    const expectedApifyUsd = itemCount * 0.005;
    expect(result.costMeta?.costUsd).toBeCloseTo(expectedApifyUsd);
    expect(result.costMeta?.apifyResults).toBe(itemCount);

    // costPaise = Serper (3) + Apify (3 × 0.005 × 84 × 100 = 126)
    const expectedApifyPaise = Math.round(expectedApifyUsd * 84 * 100);
    expect(result.costPaise).toBe(3 + expectedApifyPaise);
  });
});
