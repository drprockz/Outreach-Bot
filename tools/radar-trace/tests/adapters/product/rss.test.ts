import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { productRssAdapter } from '../../../src/adapters/product/rss.js';
import type { AdapterContext } from '../../../src/types.js';
import { EMPTY_ANCHORS } from '../../../src/types.js';

const homepageHtml = readFileSync(join(__dirname, '../../fixtures/product/rss-with-link.html'), 'utf8');
const feedXml = readFileSync(join(__dirname, '../../fixtures/product/rss-feed.xml'), 'utf8');

function ctxWith(http: typeof fetch): AdapterContext {
  const noop = () => {};
  return {
    input: { name: 'Acme', domain: 'acme.com' },
    http,
    cache: { read: async () => null, write: async () => {}, clear: async () => {} },
    logger: { debug: noop, info: noop, warn: noop, error: noop, child: () => ctxWith(http).logger },
    env: {},
    signal: new AbortController().signal,
      anchors: EMPTY_ANCHORS,
  };
}

function fakeFetch(routes: Record<string, () => Response>): typeof fetch {
  return (async (url: string | URL | Request) => {
    const u = typeof url === 'string' ? url : url.toString();
    for (const [match, factory] of Object.entries(routes)) {
      if (u.includes(match)) return factory();
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

describe('productRssAdapter', () => {
  it('contract surface', () => {
    expect(productRssAdapter.name).toBe('product.rss');
    expect(productRssAdapter.module).toBe('product');
    expect(productRssAdapter.requiredEnv).toEqual([]);
    expect(productRssAdapter.estimatedCostInr).toBe(0);
  });

  it('finds RSS link in homepage <head> and parses feed', async () => {
    const http = fakeFetch({
      '/feed.xml': () => new Response(feedXml, { status: 200, headers: { 'content-type': 'application/rss+xml' } }),
      '/atom.xml': () => new Response('not found', { status: 404 }),
      'acme.com': () => new Response(homepageHtml, { status: 200, headers: { 'content-type': 'text/html' } }),
    });
    const result = await productRssAdapter.run(ctxWith(http));
    expect(result.status).toBe('ok');
    const p = result.payload!;
    expect(p.feeds.length).toBeGreaterThanOrEqual(1);
    expect(p.feeds[0]!.url).toContain('feed.xml');
    expect(p.feeds[0]!.items.length).toBe(2);
    expect(p.feeds[0]!.items[0]!.title).toContain('Shipped');
  });

  it('returns empty when homepage has no RSS link', async () => {
    const http = fakeFetch({
      'acme.com': () => new Response('<html><head></head><body>nothing</body></html>', { status: 200 }),
    });
    const result = await productRssAdapter.run(ctxWith(http));
    expect(result.status).toBe('empty');
    expect(result.payload?.feeds).toEqual([]);
  });

  it('returns error when homepage fetch fails entirely', async () => {
    const http = fakeFetch({
      'acme.com': () => new Response('not found', { status: 404 }),
    });
    const result = await productRssAdapter.run(ctxWith(http));
    expect(result.status).toBe('error');
  });
});
