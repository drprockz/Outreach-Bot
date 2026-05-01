import pLimit from 'p-limit';
import { hashCompanyInput, todayStamp } from './cache.js';
import { assertRequiredEnv } from './env.js';
import type {
  Adapter, AdapterContext, AdapterResult, Cache, CompanyInput, Env, Logger,
} from './types.js';

export interface RunOptions {
  input: CompanyInput;
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
    totalCostPaise: number;
    totalDurationMs: number;
    perAdapter: Array<{ name: string; status: string; durationMs: number; costPaise: number; cached: boolean }>;
  };
}

export async function runEnrichment(opts: RunOptions): Promise<RunOutput> {
  const limit = pLimit(opts.concurrency);
  const startWall = Date.now();
  const inputHash = hashCompanyInput(opts.input);
  const date = todayStamp();

  const tasks = opts.adapters.map((adapter) =>
    limit(() => runOneAdapter(adapter, opts, inputHash, date)),
  );
  const settled = await Promise.all(tasks);

  const results: Record<string, AdapterResult<unknown>> = {};
  const perAdapter: RunOutput['summary']['perAdapter'] = [];
  let totalCostPaise = 0;
  for (const { name, result, cached } of settled) {
    results[name] = result;
    totalCostPaise += result.costPaise;
    perAdapter.push({ name, status: result.status, durationMs: result.durationMs, costPaise: result.costPaise, cached });
  }
  return {
    results,
    summary: { totalCostPaise, totalDurationMs: Date.now() - startWall, perAdapter },
  };
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
    const cached = await opts.cache.read<unknown>(cacheKey);
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
