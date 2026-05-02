import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { operationalCrtshAdapter } from '../../../src/adapters/operational/crtsh.js';
import type { AdapterContext } from '../../../src/types.js';

const crtshFixture = JSON.parse(readFileSync(join(__dirname, '../../fixtures/operational/crtsh.json'), 'utf8'));

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
    for (const [m, f] of routes) {
      const ok = m instanceof RegExp ? m.test(u) : u.includes(m);
      if (ok) return f();
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

describe('operationalCrtshAdapter', () => {
  it('exposes new contract fields', () => {
    expect(operationalCrtshAdapter.name).toBe('operational.crtsh');
    expect(operationalCrtshAdapter.module).toBe('operational');
    expect(operationalCrtshAdapter.requiredEnv).toEqual([]);
    expect(operationalCrtshAdapter.estimatedCostInr).toBe(0);
    expect(operationalCrtshAdapter.gate).toBeUndefined();
    // crt.sh is slow from India — needs 60s timeout, not the global 30s default
    expect(operationalCrtshAdapter.timeoutMs).toBe(60_000);
  });

  it('returns subdomains and notable subdomains from crt.sh', async () => {
    const http = fakeFetch([
      [/crt\.sh/, () => new Response(JSON.stringify(crtshFixture), { status: 200 })],
    ]);
    const result = await operationalCrtshAdapter.run(ctxWith(http));
    expect(result.status).toBe('ok');
    expect(result.payload!.subdomains).toEqual(expect.arrayContaining(['app.acme.com', 'api.acme.com', 'staging.acme.com']));
    expect(result.payload!.notableSubdomains).toEqual(expect.arrayContaining(['app.acme.com', 'api.acme.com', 'staging.acme.com']));
    expect(result.payload!.notableSubdomains).not.toContain('marketing-page.acme.com');
  });

  it('returns error on crt.sh failure', async () => {
    const http = fakeFetch([
      [/crt\.sh/, () => new Response('not found', { status: 404 })],
    ]);
    const result = await operationalCrtshAdapter.run(ctxWith(http));
    expect(result.status).toBe('error');
    expect(result.errors?.[0]).toContain('crtsh');
  });
});
