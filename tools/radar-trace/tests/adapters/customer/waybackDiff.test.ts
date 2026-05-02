import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { customerWaybackDiffAdapter } from '../../../src/adapters/customer/waybackDiff.js';
import type { AdapterContext } from '../../../src/types.js';
import { EMPTY_ANCHORS } from '../../../src/types.js';

const currentHtml = readFileSync(join(__dirname, '../../fixtures/customer/customers-current.html'), 'utf8');
const oldHtml = readFileSync(join(__dirname, '../../fixtures/customer/customers-old.html'), 'utf8');
const waybackFixture = JSON.parse(readFileSync(join(__dirname, '../../fixtures/customer/wayback-availability.json'), 'utf8'));

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

describe('customerWaybackDiffAdapter', () => {
  it('exposes new contract fields', () => {
    expect(customerWaybackDiffAdapter.name).toBe('customer.wayback_diff');
    expect(customerWaybackDiffAdapter.module).toBe('customer');
    expect(customerWaybackDiffAdapter.requiredEnv).toEqual([]);
    expect(customerWaybackDiffAdapter.estimatedCostInr).toBe(0);
    expect(customerWaybackDiffAdapter.cacheTtlMs).toBe(7 * 24 * 60 * 60 * 1000);
    expect(customerWaybackDiffAdapter.gate).toBeUndefined();
  });

  it('diffs logos against Wayback snapshot', async () => {
    const http = fakeFetch([
      ['web.archive.org/web/', () => new Response(oldHtml, { status: 200 })],
      ['archive.org/wayback/available', () => new Response(JSON.stringify(waybackFixture), { status: 200 })],
      ['https://acme.com/customers', () => new Response(currentHtml, { status: 200, headers: { 'content-type': 'text/html' } })],
      ['https://acme.com/pricing', () => new Response('not found', { status: 404 })],
      ['https://acme.com/', () => new Response('<html><body><h1>welcome</h1><p>tagline</p></body></html>', { status: 200 })],
    ]);
    const result = await customerWaybackDiffAdapter.run(ctxWith(http));
    expect(result.status).toBe('ok');
    const p = result.payload!;
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
    const result = await customerWaybackDiffAdapter.run(ctxWith(http));
    expect(result.status).toBe('ok');
    expect(result.payload!.addedLogosLast90d).toEqual([]);
    expect(result.payload!.removedLogosLast90d).toEqual([]);
  });

  it('returns empty when no customers page and no signals', async () => {
    const http = fakeFetch([
      [/.*/, () => new Response('not found', { status: 404 })],
    ]);
    const result = await customerWaybackDiffAdapter.run(ctxWith(http));
    expect(['empty', 'error']).toContain(result.status);
  });
});
