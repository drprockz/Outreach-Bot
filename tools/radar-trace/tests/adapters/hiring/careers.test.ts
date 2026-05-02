import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hiringCareersAdapter } from '../../../src/adapters/hiring/careers.js';
import type { AdapterContext } from '../../../src/types.js';
import { EMPTY_ANCHORS } from '../../../src/types.js';

const careersFixture = readFileSync(join(__dirname, '../../fixtures/hiring/careers-acme.html'), 'utf8');

function ctxWith(http: typeof fetch): AdapterContext {
  const noop = () => {};
  return {
    input: { name: 'Acme Corp', domain: 'acme.com' },
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

describe('hiringCareersAdapter', () => {
  it('exposes new contract fields', () => {
    expect(hiringCareersAdapter.name).toBe('hiring.careers');
    expect(hiringCareersAdapter.module).toBe('hiring');
    expect(hiringCareersAdapter.requiredEnv).toEqual([]);
    expect(hiringCareersAdapter.estimatedCostInr).toBe(0);
    expect(hiringCareersAdapter.gate).toBeUndefined();
  });

  it('returns ok with extracted job titles from careers page', async () => {
    const http = fakeFetch({
      'acme.com/careers': () => new Response(careersFixture, { status: 200, headers: { 'content-type': 'text/html' } }),
    });
    const result = await hiringCareersAdapter.run(ctxWith(http));
    expect(result.status).toBe('ok');
    expect(result.payload).not.toBeNull();
    expect(result.payload!.jobs.length).toBeGreaterThan(0);
    expect(result.payload!.url).toContain('acme.com/careers');
  });

  it('returns error when careers page returns 404', async () => {
    const http = fakeFetch({
      'acme.com/careers': () => new Response('not found', { status: 404 }),
    });
    const result = await hiringCareersAdapter.run(ctxWith(http));
    expect(result.status).toBe('error');
    expect(result.errors?.[0]).toContain('careers');
  });

  it('returns empty when page has no matching job titles', async () => {
    const emptyPageHtml = '<html><body><h1>Welcome to Acme</h1><p>We are a company.</p></body></html>';
    const http = fakeFetch({
      'acme.com/careers': () => new Response(emptyPageHtml, { status: 200, headers: { 'content-type': 'text/html' } }),
    });
    const result = await hiringCareersAdapter.run(ctxWith(http));
    expect(result.status).toBe('empty');
    expect(result.payload?.jobs).toEqual([]);
  });

  it('excludes all-caps single-word nav items (e.g. PRODUCT, CUSTOMERS) from job list', async () => {
    // Mobcast-style: nav bar contains keyword-matching all-caps items, no real job listings
    const navTrapHtml = `<!doctype html>
<html><body>
<nav>
  <a href="/product">PRODUCT</a>
  <a href="/customers">CUSTOMERS</a>
  <a href="/careers">CAREERS</a>
  <a href="/about">ABOUT</a>
</nav>
<main>
  <h2>Join our team</h2>
  <p>No positions open right now. Check back soon!</p>
</main>
</body></html>`;
    const http = fakeFetch({
      'acme.com/careers': () => new Response(navTrapHtml, { status: 200, headers: { 'content-type': 'text/html' } }),
    });
    const result = await hiringCareersAdapter.run(ctxWith(http));
    expect(result.status).toBe('empty');
    expect(result.payload!.jobs).toEqual([]);
  });

  it('includes real multi-word job titles while excluding nav items on the same page', async () => {
    const mixedHtml = `<!doctype html>
<html><body>
<nav>
  <a href="/product">PRODUCT</a>
  <a href="/customers">CUSTOMERS</a>
</nav>
<main>
  <div class="openings">
    <h3>Software Engineer</h3>
    <h3>Product Manager</h3>
  </div>
</main>
</body></html>`;
    const http = fakeFetch({
      'acme.com/careers': () => new Response(mixedHtml, { status: 200, headers: { 'content-type': 'text/html' } }),
    });
    const result = await hiringCareersAdapter.run(ctxWith(http));
    expect(result.status).toBe('ok');
    const titles = result.payload!.jobs.map((j) => j.title);
    expect(titles).toContain('Software Engineer');
    expect(titles).toContain('Product Manager');
    expect(titles).not.toContain('PRODUCT');
    expect(titles).not.toContain('CUSTOMERS');
  });
});
