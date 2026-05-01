import pLimit from 'p-limit';
import { hashCompanyInput, todayStamp } from './cache.js';
import { assertRequiredEnv } from './env.js';
import type {
  Adapter, AdapterContext, AdapterResult, Cache, Company, Env, Logger, PartialDossier,
} from './types.js';

export interface RunOptions {
  input: Company;
  env: Env;
  adapters: ReadonlyArray<Adapter<unknown>>;
  cache: Cache;
  logger: Logger;
  http: typeof fetch;
  concurrency: number;
  timeoutMs: number;
  useCache: boolean;
}

export interface RunOutput {
  results: Record<string, AdapterResult<unknown>>;
  summary: {
    totalCostInr: number;
    totalDurationMs: number;
    perAdapter: Array<{
      name: string; status: string; durationMs: number; costInr: number; cached: boolean;
    }>;
  };
}

export async function runEnrichment(opts: RunOptions): Promise<RunOutput> {
  const limit = pLimit(opts.concurrency);
  const startWall = Date.now();
  const inputHash = hashCompanyInput(opts.input);
  const date = todayStamp();

  const wave1 = opts.adapters.filter((a) => !a.gate);
  const wave2 = opts.adapters.filter((a) => a.gate);

  // Wave 1 — all ungated adapters run in parallel
  const wave1Results = await Promise.all(
    wave1.map((a) => limit(() => runOneAdapter(a, opts, inputHash, date))),
  );

  // Build partial dossier (frozen at runtime) from Wave 1 results
  const partial: Record<string, AdapterResult<unknown>> = {};
  for (const { name, result } of wave1Results) partial[name] = result;
  const partialDossier: PartialDossier = Object.freeze(partial);

  // Wave 2 — gated adapters with gate(partialDossier) evaluated first
  const wave2Results = await Promise.all(
    wave2.map((a) => limit(() => runGatedAdapter(a, opts, inputHash, date, partialDossier))),
  );

  const all = [...wave1Results, ...wave2Results];
  const results: Record<string, AdapterResult<unknown>> = {};
  const perAdapter: RunOutput['summary']['perAdapter'] = [];
  let totalPaise = 0;
  for (const { name, result, cached } of all) {
    results[name] = result;
    totalPaise += result.costPaise;
    perAdapter.push({
      name, status: result.status, durationMs: result.durationMs,
      costInr: result.costPaise / 100, cached,
    });
  }

  return {
    results,
    summary: {
      totalCostInr: totalPaise / 100,
      totalDurationMs: Date.now() - startWall,
      perAdapter,
    },
  };
}

async function runGatedAdapter(
  adapter: Adapter<unknown>,
  opts: RunOptions,
  inputHash: string,
  date: string,
  partial: PartialDossier,
): Promise<{ name: string; result: AdapterResult<unknown>; cached: boolean }> {
  const log = opts.logger.child({ adapter: adapter.name });
  let gateResult = false;
  try {
    gateResult = adapter.gate!(partial);
  } catch (err) {
    log.warn('gate threw', { error: (err as Error).message });
    return {
      name: adapter.name,
      result: {
        source: adapter.name,
        fetchedAt: new Date().toISOString(),
        status: 'empty',
        payload: null,
        errors: [`gate threw: ${(err as Error).message}`],
        costPaise: 0,
        durationMs: 0,
      },
      cached: false,
    };
  }
  if (!gateResult) {
    // Intentional skip — gate returned false. Not an error.
    return {
      name: adapter.name,
      result: {
        source: adapter.name,
        fetchedAt: new Date().toISOString(),
        status: 'empty',
        payload: null,
        costPaise: 0,
        durationMs: 0,
      },
      cached: false,
    };
  }
  return runOneAdapter(adapter, opts, inputHash, date);
}

async function runOneAdapter(
  adapter: Adapter<unknown>,
  opts: RunOptions,
  inputHash: string,
  date: string,
): Promise<{ name: string; result: AdapterResult<unknown>; cached: boolean }> {
  const log = opts.logger.child({ adapter: adapter.name });
  const cacheKey = { adapterName: adapter.name, adapterVersion: adapter.version, inputHash, date };

  // 1. Cache read (if enabled)
  if (opts.useCache) {
    const cached = await opts.cache.read<unknown>(cacheKey, adapter.cacheTtlMs);
    if (cached) {
      log.info('cache hit', { status: cached.status });
      return { name: adapter.name, result: cached, cached: true };
    }
  }

  // 2. Required env check (fail-fast → status:error, no run)
  try {
    assertRequiredEnv(opts.env, adapter.name, adapter.requiredEnv);
  } catch (err) {
    const result: AdapterResult<unknown> = {
      source: adapter.name,
      fetchedAt: new Date().toISOString(),
      status: 'error',
      payload: null,
      errors: [(err as Error).message],
      costPaise: 0,
      durationMs: 0,
    };
    log.warn('skipped: missing env', { errors: result.errors });
    return { name: adapter.name, result, cached: false };
  }

  // 3. Run with timeout + try/catch isolation
  const timeoutCtrl = new AbortController();
  const timer = setTimeout(() => timeoutCtrl.abort(new Error(`timeout after ${opts.timeoutMs}ms`)), opts.timeoutMs);
  const ctx: AdapterContext = {
    input: opts.input,
    http: opts.http,
    cache: opts.cache,
    logger: log,
    env: opts.env,
    signal: timeoutCtrl.signal,
  };

  log.info('start');
  const t0 = Date.now();
  let result: AdapterResult<unknown>;
  try {
    result = await adapter.run(ctx);
  } catch (err) {
    result = {
      source: adapter.name,
      fetchedAt: new Date().toISOString(),
      status: 'error',
      payload: null,
      errors: [(err as Error).message ?? String(err)],
      costPaise: 0,
      durationMs: Date.now() - t0,
    };
  } finally {
    clearTimeout(timer);
  }

  // 4. Validate payload through adapter.schema (only if status was ok and payload non-null)
  if (result.status === 'ok' && result.payload !== null) {
    const parsed = adapter.schema.safeParse(result.payload);
    if (!parsed.success) {
      result = {
        ...result,
        status: 'partial',
        errors: [...(result.errors ?? []), parsed.error.message],
      };
    }
  }

  log.info('done', { status: result.status, durationMs: result.durationMs, costPaise: result.costPaise });

  // 5. Cache write (skip on error)
  if (result.status !== 'error') {
    await opts.cache.write(cacheKey, result);
  }

  return { name: adapter.name, result, cached: false };
}
