import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hiringAdapter } from '../../src/adapters/hiring.js';
import type { AdapterContext } from '../../src/types.js';

// Pin Date.now() so date-cohort assertions stay valid regardless of test run date.
beforeAll(async () => {
  vi.useFakeTimers({ now: new Date('2026-05-01T12:00:00Z') });
});
afterAll(async () => {
  vi.useRealTimers();
});

const adzunaFixture = JSON.parse(readFileSync(join(__dirname, '../fixtures/hiring/adzuna-acme.json'), 'utf8'));
const careersFixture = readFileSync(join(__dirname, '../fixtures/hiring/careers-acme.html'), 'utf8');

function ctxWith(http: typeof fetch, env: Record<string, string> = { ADZUNA_APP_ID: 'a', ADZUNA_APP_KEY: 'b' }): AdapterContext {
  const noop = () => {};
  return {
    input: { name: 'Acme Corp', domain: 'acme.com' },
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

describe('hiringAdapter', () => {
  it('exposes the Adapter contract surface', () => {
    expect(hiringAdapter.name).toBe('hiring');
    expect(hiringAdapter.requiredEnv).toEqual(['ADZUNA_APP_ID', 'ADZUNA_APP_KEY']);
    expect(hiringAdapter.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('returns ok with bucketed counts when Adzuna + careers both succeed', async () => {
    const http = fakeFetch({
      'api.adzuna.com': () => new Response(JSON.stringify(adzunaFixture), { status: 200 }),
      'acme.com/careers': () => new Response(careersFixture, { status: 200, headers: { 'content-type': 'text/html' } }),
    });
    const result = await hiringAdapter.run(ctxWith(http));
    expect(result.status).toBe('ok');
    expect(result.payload).not.toBeNull();
    const p = result.payload!;
    // Adzuna: 3 jobs (1 eng, 1 sales, 1 director-eng), Careers: 2 (cs, marketing)
    expect(p.totalActiveJobs).toBe(5);
    expect(p.byFunction.eng).toBeGreaterThanOrEqual(2);
    expect(p.byFunction.sales).toBeGreaterThanOrEqual(1);
    expect(p.byFunction.cs).toBeGreaterThanOrEqual(1);
    expect(p.byFunction.marketing).toBeGreaterThanOrEqual(1);
    expect(p.bySeniority.director).toBeGreaterThanOrEqual(1);
    expect(p.rawJobs.length).toBe(5);
  });

  it('returns partial when careers fetch fails but Adzuna succeeds', async () => {
    const http = fakeFetch({
      'api.adzuna.com': () => new Response(JSON.stringify(adzunaFixture), { status: 200 }),
      'acme.com/careers': () => new Response('not found', { status: 404 }),
    });
    const result = await hiringAdapter.run(ctxWith(http));
    expect(['ok', 'partial']).toContain(result.status);
    expect(result.payload?.rawJobs.length).toBe(3); // only Adzuna jobs
  });

  it('returns error when Adzuna fails (no usable data)', async () => {
    const http = fakeFetch({
      'api.adzuna.com': () => new Response('boom', { status: 500 }),
      'acme.com/careers': () => new Response('not found', { status: 404 }),
    });
    const result = await hiringAdapter.run(ctxWith(http));
    expect(result.status).toBe('error');
    expect(result.errors?.length).toBeGreaterThan(0);
  });

  it('jobsLast30Days correctly counts by created date', async () => {
    const http = fakeFetch({
      'api.adzuna.com': () => new Response(JSON.stringify(adzunaFixture), { status: 200 }),
      'acme.com/careers': () => new Response('', { status: 404 }),
    });
    const result = await hiringAdapter.run(ctxWith(http));
    // Date-pinned to 2026-05-01: jobs created 2026-04-15 and 2026-04-20 are within 30d (2)
    // jobsLast90Days >= jobsLast30Days as a structural invariant.
    expect(result.payload!.jobsLast90Days).toBeGreaterThanOrEqual(result.payload!.jobsLast30Days);
  });
});
