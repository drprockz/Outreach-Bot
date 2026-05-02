import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { operationalTechStackAdapter } from '../../../src/adapters/operational/techStack.js';
import type { AdapterContext } from '../../../src/types.js';
import { EMPTY_ANCHORS } from '../../../src/types.js';

const homepageFixture = readFileSync(join(__dirname, '../../fixtures/operational/homepage.html'), 'utf8');

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
    for (const [m, f] of routes) {
      const ok = m instanceof RegExp ? m.test(u) : u.includes(m);
      if (ok) return f();
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

describe('operationalTechStackAdapter', () => {
  it('exposes new contract fields', () => {
    expect(operationalTechStackAdapter.name).toBe('operational.tech_stack');
    expect(operationalTechStackAdapter.module).toBe('operational');
    expect(operationalTechStackAdapter.requiredEnv).toEqual([]);
    expect(operationalTechStackAdapter.estimatedCostInr).toBe(0);
    expect(operationalTechStackAdapter.gate).toBeUndefined();
  });

  it('detects tech stack from homepage', async () => {
    const http = fakeFetch([
      [/acme\.com\/?$/, () => new Response(homepageFixture, { status: 200, headers: { 'content-type': 'text/html' } })],
    ]);
    const result = await operationalTechStackAdapter.run(ctxWith(http));
    expect(result.status).toBe('ok');
    const tools = result.payload!.techStack.map((t) => t.name);
    expect(tools).toEqual(expect.arrayContaining(['Stripe', 'Segment', 'Sentry']));
  });

  it('returns error when homepage fetch fails', async () => {
    const http = fakeFetch([
      [/.*/, () => new Response('not found', { status: 404 })],
    ]);
    const result = await operationalTechStackAdapter.run(ctxWith(http));
    expect(result.status).toBe('error');
    expect(result.errors?.[0]).toContain('tech_stack');
  });
});
