import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { customerLogosCurrentAdapter } from '../../../src/adapters/customer/logosCurrent.js';
import type { AdapterContext } from '../../../src/types.js';

const currentHtml = readFileSync(join(__dirname, '../../fixtures/customer/customers-current.html'), 'utf8');

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

describe('customerLogosCurrentAdapter', () => {
  it('exposes new contract fields', () => {
    expect(customerLogosCurrentAdapter.name).toBe('customer.logos_current');
    expect(customerLogosCurrentAdapter.module).toBe('customer');
    expect(customerLogosCurrentAdapter.requiredEnv).toEqual([]);
    expect(customerLogosCurrentAdapter.estimatedCostInr).toBe(0);
    expect(customerLogosCurrentAdapter.gate).toBeUndefined();
  });

  it('extracts current logos from customers page', async () => {
    const http = fakeFetch([
      ['https://acme.com/customers', () => new Response(currentHtml, { status: 200, headers: { 'content-type': 'text/html' } })],
    ]);
    const result = await customerLogosCurrentAdapter.run(ctxWith(http));
    expect(result.status).toBe('ok');
    expect(result.payload!.customersPageUrl).toContain('/customers');
    expect(result.payload!.currentLogos).toEqual(expect.arrayContaining(['Acme', 'Foo Corp', 'Bar Inc']));
  });

  it('returns empty when no customers page found', async () => {
    const http = fakeFetch([
      [/.*/, () => new Response('not found', { status: 404 })],
    ]);
    const result = await customerLogosCurrentAdapter.run(ctxWith(http));
    expect(result.status).toBe('empty');
    expect(result.payload!.customersPageUrl).toBeNull();
    expect(result.payload!.currentLogos).toEqual([]);
  });
});
