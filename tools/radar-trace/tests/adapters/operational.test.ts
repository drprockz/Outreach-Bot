import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { operationalAdapter, makeOperationalAdapter } from '../../src/adapters/operational.js';
import type { AdapterContext } from '../../src/types.js';

const homepageFixture = readFileSync(join(__dirname, '../fixtures/operational/homepage.html'), 'utf8');
const crtshFixture = JSON.parse(readFileSync(join(__dirname, '../fixtures/operational/crtsh.json'), 'utf8'));

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

const fakeDnsOk = {
  resolveMx: async () => [{ exchange: 'aspmx.l.google.com', priority: 1 }],
  resolveTxt: async () => [['v=spf1 include:_spf.google.com'], ['intercom-domain-verification=xyz']],
};

const fakeDnsFail = {
  resolveMx: async () => { throw new Error('ENOTFOUND'); },
  resolveTxt: async () => { throw new Error('ENOTFOUND'); },
};

describe('operationalAdapter', () => {
  it('exposes the Adapter contract surface', () => {
    expect(operationalAdapter.name).toBe('operational');
    expect(operationalAdapter.requiredEnv).toEqual([]);
  });

  it('detects tech stack, infers email provider, and flags notable subdomains', async () => {
    const adapter = makeOperationalAdapter(fakeDnsOk);
    const http = fakeFetch([
      [/acme\.com\/?$/, () => new Response(homepageFixture, { status: 200, headers: { 'content-type': 'text/html' } })],
      [/crt\.sh/, () => new Response(JSON.stringify(crtshFixture), { status: 200 })],
    ]);
    const result = await adapter.run(ctxWith(http));
    expect(result.status).toBe('ok');
    const p = result.payload!;
    const tools = p.techStack.map((t) => t.name);
    expect(tools).toEqual(expect.arrayContaining(['Stripe', 'Segment', 'Sentry']));
    expect(p.emailProvider).toBe('Google');
    expect(p.knownSaaSVerifications).toEqual(expect.arrayContaining(['intercom']));
    expect(p.subdomains).toEqual(expect.arrayContaining(['app.acme.com', 'api.acme.com', 'staging.acme.com']));
    expect(p.notableSubdomains).toEqual(expect.arrayContaining(['app.acme.com', 'api.acme.com', 'staging.acme.com']));
    expect(p.notableSubdomains).not.toContain('marketing-page.acme.com');
  });

  it('tolerates DNS failure — returns partial with techStack still populated', async () => {
    const adapter = makeOperationalAdapter(fakeDnsFail);
    const http = fakeFetch([
      [/acme\.com\/?$/, () => new Response(homepageFixture, { status: 200 })],
      [/crt\.sh/, () => new Response(JSON.stringify(crtshFixture), { status: 200 })],
    ]);
    const result = await adapter.run(ctxWith(http));
    expect(['ok', 'partial']).toContain(result.status);
    expect(result.payload!.emailProvider).toBeNull();
    expect(result.payload!.techStack.length).toBeGreaterThan(0);
  });

  it('returns error when nothing succeeds', async () => {
    const adapter = makeOperationalAdapter(fakeDnsFail);
    const http = fakeFetch([[/.*/, () => new Response('not found', { status: 404 })]]);
    const result = await adapter.run(ctxWith(http));
    expect(result.status).toBe('error');
  });
});
