import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { productChangelogAdapter } from '../../../src/adapters/product/changelog.js';
import type { AdapterContext } from '../../../src/types.js';

beforeAll(() => { vi.useFakeTimers({ now: new Date('2026-05-01T12:00:00Z') }); });
afterAll(() => { vi.useRealTimers(); });

const changelogFixture = readFileSync(join(__dirname, '../../fixtures/product/changelog.html'), 'utf8');

function ctxWith(http: typeof fetch): AdapterContext {
  const noop = () => {};
  return {
    input: { name: 'Acme', domain: 'acme.com' },
    http,
    cache: { read: async () => null, write: async () => {}, clear: async () => {} },
    logger: { debug: noop, info: noop, warn: noop, error: noop, child: () => ctxWith(http).logger },
    env: {},
    signal: new AbortController().signal,
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

describe('productChangelogAdapter', () => {
  it('exposes new contract fields', () => {
    expect(productChangelogAdapter.name).toBe('product.changelog');
    expect(productChangelogAdapter.module).toBe('product');
    expect(productChangelogAdapter.requiredEnv).toEqual([]);
    expect(productChangelogAdapter.estimatedCostInr).toBe(0);
    expect(productChangelogAdapter.gate).toBeUndefined();
  });

  it('returns ok with entries when changelog page found', async () => {
    const http = fakeFetch({
      '/changelog': () => new Response(changelogFixture, { status: 200, headers: { 'content-type': 'text/html' } }),
    });
    const result = await productChangelogAdapter.run(ctxWith(http));
    expect(result.status).toBe('ok');
    expect(result.payload!.entries.length).toBeGreaterThanOrEqual(1);
    expect(result.payload!.discoveredAt).not.toBeNull();
  });

  it('returns empty when no changelog pages found', async () => {
    const http = fakeFetch({
      '/changelog': () => new Response('not found', { status: 404 }),
      '/blog': () => new Response('not found', { status: 404 }),
      '/release-notes': () => new Response('not found', { status: 404 }),
      '/whats-new': () => new Response('not found', { status: 404 }),
    });
    const result = await productChangelogAdapter.run(ctxWith(http));
    expect(result.status).toBe('empty');
    expect(result.payload!.entries).toEqual([]);
    expect(result.payload!.discoveredAt).toBeNull();
  });

  it('returns empty when all candidate paths serve the homepage (index.php fallthrough)', async () => {
    // Mobcast-style: site routes unknown paths back to homepage with 200.
    // The homepage hero text ("Get heard. Everywhere.") gets scraped as changelog entries.
    const homepageHtml = `<!doctype html>
<html><head><title>Mobcast - Home</title></head>
<body>
<h2>Get heard. Everywhere.</h2>
<h2>Trusted by 500+ brands</h2>
<p>The leading podcast distribution platform.</p>
</body></html>`;
    const http = fakeFetch({
      '/': () => new Response(homepageHtml, { status: 200 }),
      '/changelog': () => new Response(homepageHtml, { status: 200 }),
      '/blog': () => new Response(homepageHtml, { status: 200 }),
      '/release-notes': () => new Response(homepageHtml, { status: 200 }),
      '/whats-new': () => new Response(homepageHtml, { status: 200 }),
    });
    const result = await productChangelogAdapter.run(ctxWith(http));
    expect(result.status).toBe('empty');
    expect(result.payload!.entries).toEqual([]);
    expect(result.payload!.discoveredAt).toBeNull();
  });
});
