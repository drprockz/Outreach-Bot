import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { customerAdapter } from '../../src/adapters/customer.js';
import type { AdapterContext } from '../../src/types.js';

const currentHtml = readFileSync(join(__dirname, '../fixtures/customer/customers-current.html'), 'utf8');
const oldHtml = readFileSync(join(__dirname, '../fixtures/customer/customers-old.html'), 'utf8');
const waybackFixture = JSON.parse(readFileSync(join(__dirname, '../fixtures/customer/wayback-availability.json'), 'utf8'));

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

function fakeFetch(routes: Array<[RegExp | string, () => Response]>): typeof fetch {
  return (async (url: string | URL | Request) => {
    const u = typeof url === 'string' ? url : url.toString();
    for (const [match, factory] of routes) {
      const m = match instanceof RegExp ? match.test(u) : u.includes(match);
      if (m) return factory();
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

describe('customerAdapter', () => {
  it('exposes the Adapter contract surface', () => {
    expect(customerAdapter.name).toBe('customer');
    expect(customerAdapter.requiredEnv).toEqual([]);
  });

  it('extracts current logos and diffs against an older Wayback snapshot', async () => {
    const http = fakeFetch([
      // wayback snapshots — check FIRST (more specific)
      ['web.archive.org/web/', () => new Response(oldHtml, { status: 200 })],
      // wayback availability lookup returns a snapshot URL
      ['archive.org/wayback/available', () => new Response(JSON.stringify(waybackFixture), { status: 200 })],
      // current customers page on acme.com
      ['https://acme.com/customers', () => new Response(currentHtml, { status: 200, headers: { 'content-type': 'text/html' } })],
      // pricing + home not present — return 404 so those diffs are empty
      ['https://acme.com/pricing', () => new Response('not found', { status: 404 })],
      ['https://acme.com/', () => new Response('<html><body><h1>welcome</h1><p>tagline</p></body></html>', { status: 200 })],
    ]);
    const result = await customerAdapter.run(ctxWith(http));
    expect(result.status).toBe('ok');
    const p = result.payload!;
    expect(p.customersPageUrl).toContain('/customers');
    expect(p.currentLogos).toEqual(expect.arrayContaining(['Acme', 'Foo Corp', 'Bar Inc']));
    expect(p.addedLogosLast90d).toEqual(expect.arrayContaining(['Acme', 'Bar Inc']));
    expect(p.removedLogosLast90d).toEqual(expect.arrayContaining(['Legacy Co']));
    expect(p.snapshotsAnalyzed.length).toBeGreaterThan(0);
  });

  it('returns ok with empty diffs when no Wayback snapshot exists', async () => {
    const http = fakeFetch([
      ['https://acme.com/customers', () => new Response(currentHtml, { status: 200 })],
      ['archive.org/wayback/available', () => new Response(JSON.stringify({ archived_snapshots: {} }), { status: 200 })],
      ['https://acme.com/', () => new Response('<html><body></body></html>', { status: 200 })],
    ]);
    const result = await customerAdapter.run(ctxWith(http));
    expect(result.status).toBe('ok');
    expect(result.payload!.addedLogosLast90d).toEqual([]);
    expect(result.payload!.removedLogosLast90d).toEqual([]);
  });

  it('returns empty when no customers/clients/case-studies page can be found and no signals at all', async () => {
    const http = fakeFetch([
      [/.*/, () => new Response('not found', { status: 404 })],
    ]);
    const result = await customerAdapter.run(ctxWith(http));
    expect(['empty', 'error']).toContain(result.status);
  });
});
