import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { operationalWhoisAdapter } from '../../../src/adapters/operational/whois.js';
import type { AdapterContext } from '../../../src/types.js';

// Pin time so ageDays is deterministic: 2026-05-01 - 2018-03-15 = ~2968 days
beforeAll(() => { vi.useFakeTimers({ now: new Date('2026-05-01T12:00:00Z') }); });
afterAll(() => { vi.useRealTimers(); });

const rdapFixture = JSON.parse(readFileSync(join(__dirname, '../../fixtures/operational/rdap-response.json'), 'utf8'));

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

describe('operationalWhoisAdapter', () => {
  it('contract surface', () => {
    expect(operationalWhoisAdapter.name).toBe('operational.whois');
    expect(operationalWhoisAdapter.module).toBe('operational');
    expect(operationalWhoisAdapter.requiredEnv).toEqual([]);
    expect(operationalWhoisAdapter.estimatedCostInr).toBe(0);
    expect(operationalWhoisAdapter.cacheTtlMs).toBe(30 * 24 * 60 * 60 * 1000);
    expect(operationalWhoisAdapter.gate).toBeUndefined();
  });

  it('parses RDAP response correctly', async () => {
    const http = fakeFetch({
      'rdap.org': () => new Response(JSON.stringify(rdapFixture), { status: 200, headers: { 'content-type': 'application/json' } }),
    });
    const result = await operationalWhoisAdapter.run(ctxWith(http));
    expect(result.status).toBe('ok');
    const p = result.payload!;
    expect(p.domain).toBe('acme.com');
    expect(p.registrar).toBe('Example Registrar Inc.');
    expect(p.registeredOn).toContain('2018-03-15');
    expect(p.expiresOn).toContain('2027-03-15');
    expect(p.ageDays).toBeGreaterThan(2900);
    expect(p.status).toContain('client transfer prohibited');
    expect(p.nameservers).toContain('ns1.cloudflare.com');
    expect(p.nameservers).toContain('ns2.cloudflare.com');
  });

  it('returns empty (not error) when RDAP returns 404 — ccTLD coverage gap', async () => {
    // .in / .co / many ccTLDs have no RDAP record at rdap.org; 404 is expected and
    // not a system failure. Callers should see status:'empty', not 'error'.
    const http = fakeFetch({
      'rdap.org': () => new Response('not found', { status: 404 }),
    });
    const result = await operationalWhoisAdapter.run(ctxWith(http));
    expect(result.status).toBe('empty');
    expect(result.payload).toBeNull();
    expect(result.errors?.[0]).toContain('whois');
  });

  it('returns error on non-404 HTTP failures (e.g. 500)', async () => {
    const http = fakeFetch({
      'rdap.org': () => new Response('internal error', { status: 500 }),
    });
    const result = await operationalWhoisAdapter.run(ctxWith(http));
    expect(result.status).toBe('error');
    expect(result.errors?.[0]).toContain('whois');
  });
});
