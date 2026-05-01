import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { runEnrichment } from '../src/orchestrator.js';
import type { Adapter, AdapterContext, AdapterResult, Cache, CompanyInput, Env, Logger } from '../src/types.js';

function silentLogger(): Logger {
  const noop = () => {};
  return { debug: noop, info: noop, warn: noop, error: noop, child: () => silentLogger() };
}

function memoryCache(): Cache {
  const store = new Map<string, AdapterResult<unknown>>();
  const k = (key: { adapterName: string; adapterVersion: string; inputHash: string; date: string }) =>
    `${key.adapterName}-${key.inputHash}-${key.adapterVersion}-${key.date}`;
  return {
    async read<T>(key: { adapterName: string; adapterVersion: string; inputHash: string; date: string }) {
      return (store.get(k(key)) as AdapterResult<T> | undefined) ?? null;
    },
    async write<T>(key: { adapterName: string; adapterVersion: string; inputHash: string; date: string }, v: AdapterResult<T>) {
      store.set(k(key), v as AdapterResult<unknown>);
    },
    async clear() { store.clear(); },
  };
}

const fakeInput: CompanyInput = { name: 'Acme', domain: 'acme.com' };
const fakeEnv: Env = {};

function makeAdapter(name: string, behavior: (ctx: AdapterContext) => Promise<AdapterResult<unknown>>): Adapter<unknown> {
  return {
    name,
    version: '1.0.0',
    estimatedCostPaise: 0,
    requiredEnv: [],
    schema: z.unknown(),
    run: behavior,
  };
}

describe('runEnrichment', () => {
  it('runs every adapter and returns its result keyed by name', async () => {
    const adapters = [
      makeAdapter('hiring', async () => ({ source: 'hiring', fetchedAt: 'x', status: 'ok', payload: { jobs: 5 }, costPaise: 0, durationMs: 10 })),
      makeAdapter('product', async () => ({ source: 'product', fetchedAt: 'x', status: 'ok', payload: { repos: 3 }, costPaise: 0, durationMs: 20 })),
    ];
    const out = await runEnrichment({
      input: fakeInput, env: fakeEnv, adapters,
      cache: memoryCache(), logger: silentLogger(),
      http: globalThis.fetch, concurrency: 2, timeoutMs: 5000, useCache: true,
    });
    expect(out.results.hiring!.status).toBe('ok');
    expect(out.results.product!.status).toBe('ok');
    expect(out.results.hiring!.payload).toEqual({ jobs: 5 });
  });

  it('isolates a failing adapter — others still return successfully', async () => {
    const adapters = [
      makeAdapter('hiring', async () => { throw new Error('boom'); }),
      makeAdapter('product', async () => ({ source: 'product', fetchedAt: 'x', status: 'ok', payload: {}, costPaise: 0, durationMs: 5 })),
    ];
    const out = await runEnrichment({
      input: fakeInput, env: fakeEnv, adapters,
      cache: memoryCache(), logger: silentLogger(),
      http: globalThis.fetch, concurrency: 2, timeoutMs: 5000, useCache: true,
    });
    expect(out.results.hiring!.status).toBe('error');
    expect(out.results.hiring!.errors).toEqual(expect.arrayContaining([expect.stringContaining('boom')]));
    expect(out.results.product!.status).toBe('ok');
  });

  it('does not write cache entries for adapters that errored', async () => {
    const cache = memoryCache();
    const writeSpy = vi.spyOn(cache, 'write');
    const adapters = [
      makeAdapter('hiring', async () => { throw new Error('boom'); }),
    ];
    await runEnrichment({
      input: fakeInput, env: fakeEnv, adapters,
      cache, logger: silentLogger(),
      http: globalThis.fetch, concurrency: 2, timeoutMs: 5000, useCache: true,
    });
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('uses cache when present and useCache is true', async () => {
    const cache = memoryCache();
    const { hashCompanyInput, todayStamp } = await import('../src/cache.js');
    const cached: AdapterResult<{ cached: true }> = {
      source: 'hiring', fetchedAt: 'cached', status: 'ok', payload: { cached: true }, costPaise: 0, durationMs: 0,
    };
    await cache.write(
      { adapterName: 'hiring', adapterVersion: '1.0.0', inputHash: hashCompanyInput(fakeInput), date: todayStamp() },
      cached,
    );

    const runSpy = vi.fn(async () => ({ source: 'hiring', fetchedAt: 'fresh', status: 'ok', payload: { fresh: true }, costPaise: 0, durationMs: 10 } satisfies AdapterResult<unknown>));
    const adapters = [makeAdapter('hiring', runSpy)];
    const out = await runEnrichment({
      input: fakeInput, env: fakeEnv, adapters,
      cache, logger: silentLogger(),
      http: globalThis.fetch, concurrency: 2, timeoutMs: 5000, useCache: true,
    });
    expect(out.results.hiring!.payload).toEqual({ cached: true });
    expect(runSpy).not.toHaveBeenCalled();
  });

  it('skips cache reads when useCache is false but still writes', async () => {
    const cache = memoryCache();
    const { hashCompanyInput, todayStamp } = await import('../src/cache.js');
    await cache.write(
      { adapterName: 'hiring', adapterVersion: '1.0.0', inputHash: hashCompanyInput(fakeInput), date: todayStamp() },
      { source: 'hiring', fetchedAt: 'cached', status: 'ok', payload: { cached: true }, costPaise: 0, durationMs: 0 },
    );
    const adapters = [makeAdapter('hiring', async () => ({ source: 'hiring', fetchedAt: 'fresh', status: 'ok', payload: { fresh: true }, costPaise: 0, durationMs: 10 }))];
    const out = await runEnrichment({
      input: fakeInput, env: fakeEnv, adapters,
      cache, logger: silentLogger(),
      http: globalThis.fetch, concurrency: 2, timeoutMs: 5000, useCache: false,
    });
    expect(out.results.hiring!.payload).toEqual({ fresh: true });
  });

  it('produces status:partial when payload fails the adapter schema, preserving the payload, and STILL writes cache', async () => {
    const cache = memoryCache();
    const writeSpy = vi.spyOn(cache, 'write');
    const adapter: Adapter<{ jobs: number }> = {
      name: 'hiring', version: '1.0.0', estimatedCostPaise: 0, requiredEnv: [],
      schema: z.object({ jobs: z.number() }),
      run: async () => ({ source: 'hiring', fetchedAt: 'x', status: 'ok', payload: { jobs: 'not-a-number' as unknown as number }, costPaise: 0, durationMs: 10 }),
    };
    const out = await runEnrichment({
      input: fakeInput, env: fakeEnv, adapters: [adapter as Adapter<unknown>],
      cache, logger: silentLogger(),
      http: globalThis.fetch, concurrency: 2, timeoutMs: 5000, useCache: true,
    });
    expect(out.results.hiring!.status).toBe('partial');
    expect(out.results.hiring!.payload).toEqual({ jobs: 'not-a-number' });
    expect(out.results.hiring!.errors?.[0]).toContain('jobs');
    // Partial results ARE cached (only 'error' status skips caching) — so flaky API responses
    // don't keep retrying expensive calls during the same day.
    expect(writeSpy).toHaveBeenCalledTimes(1);
  });

  it('skips an adapter and returns status:error when its requiredEnv is missing', async () => {
    const adapter: Adapter<unknown> = {
      ...makeAdapter('hiring', async () => ({ source: 'hiring', fetchedAt: 'x', status: 'ok', payload: {}, costPaise: 0, durationMs: 0 })),
      requiredEnv: ['ADZUNA_APP_ID'],
    };
    const out = await runEnrichment({
      input: fakeInput, env: {}, adapters: [adapter],
      cache: memoryCache(), logger: silentLogger(),
      http: globalThis.fetch, concurrency: 2, timeoutMs: 5000, useCache: true,
    });
    expect(out.results.hiring!.status).toBe('error');
    expect(out.results.hiring!.errors?.[0]).toContain('ADZUNA_APP_ID');
  });

  it('aborts an adapter that exceeds the per-adapter timeout', async () => {
    const adapter = makeAdapter('hiring', async (ctx) =>
      new Promise<AdapterResult<unknown>>((resolve) => {
        ctx.signal.addEventListener('abort', () => resolve({
          source: 'hiring', fetchedAt: 'x', status: 'error', payload: null, errors: ['aborted-by-test'], costPaise: 0, durationMs: 0,
        }));
      }),
    );
    const out = await runEnrichment({
      input: fakeInput, env: fakeEnv, adapters: [adapter],
      cache: memoryCache(), logger: silentLogger(),
      http: globalThis.fetch, concurrency: 2, timeoutMs: 50, useCache: true,
    });
    expect(out.results.hiring!.status).toBe('error');
  });

  it('summary.totalCostPaise is the sum of per-adapter costPaise', async () => {
    const adapters = [
      makeAdapter('hiring', async () => ({ source: 'hiring', fetchedAt: 'x', status: 'ok', payload: {}, costPaise: 100, durationMs: 5 })),
      makeAdapter('product', async () => ({ source: 'product', fetchedAt: 'x', status: 'ok', payload: {}, costPaise: 250, durationMs: 5 })),
    ];
    const out = await runEnrichment({
      input: fakeInput, env: fakeEnv, adapters,
      cache: memoryCache(), logger: silentLogger(),
      http: globalThis.fetch, concurrency: 2, timeoutMs: 5000, useCache: true,
    });
    expect(out.summary.totalCostPaise).toBe(350);
  });
});
