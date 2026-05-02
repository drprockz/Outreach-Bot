import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hiringAdzunaAdapter } from '../../../src/adapters/hiring/adzuna.js';
import type { AdapterContext } from '../../../src/types.js';
import { EMPTY_ANCHORS } from '../../../src/types.js';

beforeAll(() => { vi.useFakeTimers({ now: new Date('2026-05-01T12:00:00Z') }); });
afterAll(() => { vi.useRealTimers(); });

const adzunaFixture = JSON.parse(
  readFileSync(join(__dirname, '../../fixtures/hiring/adzuna-acme.json'), 'utf8'),
);

function ctxWith(http: typeof fetch, env = { ADZUNA_APP_ID: 'a', ADZUNA_APP_KEY: 'b' }): AdapterContext {
  const noop = () => {};
  return {
    input: { name: 'Acme Corp', domain: 'acme.com' },
    http,
    cache: { read: async () => null, write: async () => {}, clear: async () => {} },
    logger: { debug: noop, info: noop, warn: noop, error: noop, child: () => ctxWith(http, env).logger },
    env,
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

describe('hiringAdzunaAdapter', () => {
  it('exposes new contract fields', () => {
    expect(hiringAdzunaAdapter.name).toBe('hiring.adzuna');
    expect(hiringAdzunaAdapter.module).toBe('hiring');
    expect(hiringAdzunaAdapter.requiredEnv).toEqual(['ADZUNA_APP_ID', 'ADZUNA_APP_KEY']);
    expect(hiringAdzunaAdapter.estimatedCostInr).toBe(0);
    expect(hiringAdzunaAdapter.gate).toBeUndefined();
  });

  it('returns ok with classified jobs', async () => {
    const http = fakeFetch({
      'api.adzuna.com': () => new Response(JSON.stringify(adzunaFixture), { status: 200 }),
    });
    const result = await hiringAdzunaAdapter.run(ctxWith(http));
    expect(result.status).toBe('ok');
    expect(result.payload).not.toBeNull();
    expect(result.payload!.jobs.length).toBe(3);
    expect(result.payload!.jobs[0]!.function).toBe('eng');
  });

  it('returns error on 5xx (after retry)', async () => {
    const http = fakeFetch({
      'api.adzuna.com': () => new Response('boom', { status: 500 }),
    });
    const result = await hiringAdzunaAdapter.run(ctxWith(http));
    expect(result.status).toBe('error');
    expect(result.errors?.[0]).toContain('adzuna');
  });

  it('returns empty (not error) when no results returned', async () => {
    const http = fakeFetch({
      'api.adzuna.com': () => new Response(JSON.stringify({ count: 0, results: [] }), { status: 200 }),
    });
    const result = await hiringAdzunaAdapter.run(ctxWith(http));
    expect(result.status).toBe('empty');
    expect(result.payload?.jobs).toEqual([]);
  });

  it('falls back to what= keyword search when company= returns 400', async () => {
    // Adzuna rejects short/unusual company names with 400 on the company= param.
    // The adapter should retry with what=<name> and return the results.
    let callCount = 0;
    const http: typeof fetch = (async (url: string | URL | Request) => {
      const u = typeof url === 'string' ? url : url.toString();
      callCount++;
      if (u.includes('company=')) {
        return new Response(JSON.stringify({ error: 'invalid company parameter' }), { status: 400 });
      }
      if (u.includes('what=')) {
        return new Response(JSON.stringify(adzunaFixture), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;

    const result = await hiringAdzunaAdapter.run(ctxWith(http));
    expect(result.status).toBe('ok');
    expect(result.payload!.jobs.length).toBe(3);
    expect(callCount).toBe(2); // first call company=, second call what=
  });

  it('returns empty (not error) when both company= and what= return 400', async () => {
    const http: typeof fetch = (async () =>
      new Response(JSON.stringify({ error: 'bad request' }), { status: 400 })
    ) as typeof fetch;
    const result = await hiringAdzunaAdapter.run(ctxWith(http));
    expect(result.status).toBe('empty');
  });
});
