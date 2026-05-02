import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { operationalPagespeedAdapter } from '../../../src/adapters/operational/pagespeed.js';
import type { AdapterContext } from '../../../src/types.js';

const psiFixture = JSON.parse(readFileSync(join(__dirname, '../../fixtures/operational/pagespeed-response.json'), 'utf8'));

function ctxWith(http: typeof fetch, env: Record<string, string> = {}): AdapterContext {
  const noop = () => {};
  return {
    input: { name: 'Acme', domain: 'acme.com' },
    http,
    cache: { read: async () => null, write: async () => {}, clear: async () => {} },
    logger: { debug: noop, info: noop, warn: noop, error: noop, child: () => ctxWith(http, env).logger },
    env,
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

describe('operationalPagespeedAdapter', () => {
  it('contract surface', () => {
    expect(operationalPagespeedAdapter.name).toBe('operational.pagespeed');
    expect(operationalPagespeedAdapter.module).toBe('operational');
    expect(operationalPagespeedAdapter.requiredEnv).toEqual([]);
    expect(operationalPagespeedAdapter.estimatedCostInr).toBe(0);
    expect(operationalPagespeedAdapter.gate).toBeUndefined();
  });

  it('returns ok with full metrics from PSI fixture', async () => {
    const http = fakeFetch({
      'pagespeedonline': () => new Response(JSON.stringify(psiFixture), { status: 200 }),
    });
    const result = await operationalPagespeedAdapter.run(ctxWith(http));
    expect(result.status).toBe('ok');
    const p = result.payload!;
    expect(p.strategy).toBe('mobile');
    expect(p.performanceScore).toBe(87);
    expect(p.fetchedFrom).toBe('field');
    expect(p.metrics.lcpMs).toBeCloseTo(1823.4, 0);
    expect(p.metrics.fcpMs).toBeCloseTo(987.6, 0);
    expect(p.metrics.cls).toBeCloseTo(0.012, 3);
    expect(p.metrics.ttfbMs).toBeCloseTo(148.2, 0);
    expect(p.metrics.inpMs).toBeCloseTo(96.0, 0);
  });

  it('returns partial when some metrics are missing from PSI response', async () => {
    const partial = {
      ...psiFixture,
      lighthouseResult: {
        ...psiFixture.lighthouseResult,
        audits: {
          'largest-contentful-paint': { numericValue: 2500 },
          // all others missing
        },
      },
    };
    const http = fakeFetch({
      'pagespeedonline': () => new Response(JSON.stringify(partial), { status: 200 }),
    });
    const result = await operationalPagespeedAdapter.run(ctxWith(http));
    expect(result.status).toBe('ok'); // has at least one metric
    const p = result.payload!;
    expect(p.metrics.lcpMs).toBe(2500);
    expect(p.metrics.fcpMs).toBeNull();
    expect(p.metrics.cls).toBeNull();
    expect(p.metrics.inpMs).toBeNull();
  });

  it('returns error on 5xx response', async () => {
    const http = fakeFetch({
      'pagespeedonline': () => new Response('internal error', { status: 500 }),
    });
    const result = await operationalPagespeedAdapter.run(ctxWith(http));
    expect(result.status).toBe('error');
    expect(result.errors?.[0]).toContain('pagespeed');
  });

  it('returns empty (not error) on 429 rate limit and includes helpful message', async () => {
    // Without PAGESPEED_API_KEY, Google rate-limits aggressively.
    // This is a configuration gap, not a system failure.
    const http = fakeFetch({
      'pagespeedonline': () => new Response('Too Many Requests', { status: 429 }),
    });
    const result = await operationalPagespeedAdapter.run(ctxWith(http));
    expect(result.status).toBe('empty');
    expect(result.payload).toBeNull();
    expect(result.errors?.[0]).toMatch(/rate limited/i);
    expect(result.errors?.[0]).toMatch(/PAGESPEED_API_KEY/);
  });
});
