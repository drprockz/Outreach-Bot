import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { productSitemapAdapter } from '../../../src/adapters/product/sitemap.js';
import type { AdapterContext } from '../../../src/types.js';
import { EMPTY_ANCHORS } from '../../../src/types.js';

const sitemapXml = readFileSync(join(__dirname, '../../fixtures/product/sitemap.xml'), 'utf8');

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

describe('productSitemapAdapter', () => {
  it('contract surface', () => {
    expect(productSitemapAdapter.name).toBe('product.sitemap');
    expect(productSitemapAdapter.module).toBe('product');
    expect(productSitemapAdapter.requiredEnv).toEqual([]);
    expect(productSitemapAdapter.estimatedCostInr).toBe(0);
  });

  it('parses sitemap.xml and computes byPathPrefix correctly', async () => {
    const http = fakeFetch({
      '/sitemap.xml': () => new Response(sitemapXml, { status: 200, headers: { 'content-type': 'application/xml' } }),
    });
    const result = await productSitemapAdapter.run(ctxWith(http));
    expect(result.status).toBe('ok');
    const p = result.payload!;
    expect(p.url).toContain('/sitemap.xml');
    expect(p.totalUrls).toBe(10);
    expect(p.urls.length).toBe(10);
    expect(p.byPathPrefix['/blog']).toBe(3);
    expect(p.byPathPrefix['/products']).toBe(2);
    expect(p.byPathPrefix['/customers']).toBe(2);
  });

  it('falls back to /sitemap_index.xml if /sitemap.xml returns 404', async () => {
    const http = fakeFetch({
      '/sitemap.xml': () => new Response('not found', { status: 404 }),
      '/sitemap_index.xml': () => new Response(sitemapXml, { status: 200 }),
    });
    const result = await productSitemapAdapter.run(ctxWith(http));
    expect(result.status).toBe('ok');
    expect(result.payload!.url).toContain('sitemap_index.xml');
  });

  it('returns empty if no sitemap found', async () => {
    const http = fakeFetch({
      '/sitemap.xml': () => new Response('not found', { status: 404 }),
      '/sitemap_index.xml': () => new Response('not found', { status: 404 }),
    });
    const result = await productSitemapAdapter.run(ctxWith(http));
    expect(result.status).toBe('empty');
    expect(result.payload!.totalUrls).toBe(0);
    expect(result.payload!.urls).toEqual([]);
  });
});
