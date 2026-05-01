#!/usr/bin/env node
import { Command } from 'commander';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { runEnrichment } from './orchestrator.js';
import { createFileCache } from './cache.js';
import { createHttp } from './http.js';
import { createLogger } from './logger.js';
import { loadEnv } from './env.js';
import { EnrichedDossierSchema, type EnrichedDossier } from './schemas.js';
import { voiceStub } from './adapters/voice.stub.js';
import { positioningStub } from './adapters/positioning.stub.js';
import { hiringAdapter } from './adapters/hiring.js';
import { productAdapter } from './adapters/product.js';
import { customerAdapter } from './adapters/customer.js';
import { operationalAdapter } from './adapters/operational.js';
import { mapContext, toStage10Signals } from './synthesis/contextMapper.js';
import { generateHooks, loadRealRegenerateHook } from './synthesis/hookGenerator.js';
import type { Adapter, CompanyInput } from './types.js';
import type { RegenerateHookFn } from './synthesis/hookGenerator.js';

const ALL_MODULES = ['hiring', 'product', 'customer', 'voice', 'operational', 'positioning'] as const;
type ModuleName = typeof ALL_MODULES[number];

export interface CliOptions {
  action: 'enrich' | 'clear-cache';
  input: CompanyInput;
  modules: ModuleName[];
  outPath?: string;
  useCache: boolean;
  concurrency: number;
  timeoutMs: number;
  verbose: boolean;
  debugContext: boolean;
}

export interface MainDeps {
  /** Override for tests; defaults to loadRealRegenerateHook() (lazy). */
  loadRegenerateHook?: () => Promise<RegenerateHookFn>;
}

export function buildOptions(argv: string[]): CliOptions {
  const program = new Command()
    .exitOverride()
    .name('radar-enrich')
    .option('-c, --company <name>', 'Company name')
    .option('-d, --domain <domain>', 'Primary domain (e.g. acme.com)')
    .option('-l, --location <location>', '"City, Country"')
    .option('-f, --founder <name>', 'Founder/CEO name')
    .option('-m, --modules <list>', 'Comma-separated module list', ALL_MODULES.join(','))
    .option('-o, --out <path>', 'Write JSON to file (default: stdout)')
    .option('--no-cache', 'Skip cache reads (writes still happen)')
    .option('--clear-cache', 'Wipe ./cache/ then exit')
    .option('--debug-context', 'Include synthetic LeadContext in output')
    .option('--concurrency <n>', 'Adapter parallelism', (v) => parseInt(v, 10), 4)
    .option('--timeout <ms>', 'Per-adapter timeout in ms', (v) => parseInt(v, 10), 30000)
    .option('-v, --verbose', 'Per-adapter progress, timing, cost', false);

  program.parse(argv, { from: 'user' });
  const o = program.opts<{
    company?: string; domain?: string; location?: string; founder?: string;
    modules: string; out?: string; cache: boolean; clearCache?: boolean;
    debugContext?: boolean; concurrency: number; timeout: number; verbose: boolean;
  }>();

  if (o.clearCache) {
    return {
      action: 'clear-cache',
      input: { name: '', domain: '' },
      modules: [...ALL_MODULES],
      useCache: o.cache,
      concurrency: o.concurrency,
      timeoutMs: o.timeout,
      verbose: o.verbose,
      debugContext: false,
    };
  }

  if (!o.company) throw new Error('Missing required --company');
  if (!o.domain) throw new Error('Missing required --domain');

  const requested = o.modules.split(',').map((s) => s.trim()).filter(Boolean);
  for (const m of requested) {
    if (!(ALL_MODULES as readonly string[]).includes(m)) {
      throw new Error(`Unknown module: ${m} (valid: ${ALL_MODULES.join(',')})`);
    }
  }

  return {
    action: 'enrich',
    input: { name: o.company, domain: o.domain, location: o.location, founder: o.founder },
    modules: requested as ModuleName[],
    outPath: o.out,
    useCache: o.cache,
    concurrency: o.concurrency,
    timeoutMs: o.timeout,
    verbose: o.verbose,
    debugContext: !!o.debugContext,
  };
}

const STUB_ADAPTERS: Record<ModuleName, Adapter<unknown>> = {
  hiring: hiringAdapter as Adapter<unknown>,
  product: productAdapter as Adapter<unknown>,
  customer: customerAdapter as Adapter<unknown>,
  operational: operationalAdapter as Adapter<unknown>,
  voice: voiceStub as Adapter<unknown>,
  positioning: positioningStub as Adapter<unknown>,
};

function resolveAdapters(modules: ModuleName[]): Adapter<unknown>[] {
  const out: Adapter<unknown>[] = [];
  for (const m of modules) {
    const a = STUB_ADAPTERS[m];
    if (!a) throw new Error(`No adapter registered for module: ${m}`);
    out.push(a);
  }
  return out;
}

export async function main(argv: string[], deps: MainDeps = {}): Promise<number> {
  const opts = buildOptions(argv);
  const logger = createLogger({ level: opts.verbose ? 'debug' : 'info', pretty: process.stdout.isTTY ?? false });
  const env = loadEnv(process.env);
  const cache = createFileCache(resolve(process.cwd(), 'cache'));

  if (opts.action === 'clear-cache') {
    await cache.clear();
    logger.info('cache cleared');
    return 0;
  }

  const http = createHttp({ timeoutMs: opts.timeoutMs });
  const adapters = resolveAdapters(opts.modules);

  const { results, summary } = await runEnrichment({
    input: opts.input, env, adapters, cache, logger, http,
    concurrency: opts.concurrency, timeoutMs: opts.timeoutMs, useCache: opts.useCache,
  });

  const ctx = mapContext(opts.input, {
    hiring:      results.hiring      ?? emptyResult('hiring'),
    product:     results.product     ?? emptyResult('product'),
    customer:    results.customer    ?? emptyResult('customer'),
    operational: results.operational ?? emptyResult('operational'),
  });

  let signalSummary;
  try {
    const loader = deps.loadRegenerateHook ?? loadRealRegenerateHook;
    const regenerate = await loader();
    const hooks = await generateHooks(ctx, { regenerateHook: regenerate });
    signalSummary = {
      topSignals: hooks.topSignals,
      suggestedHooks: hooks.suggestedHooks,
      totalCostUsd: hooks.totalCostUsd,
      ...(opts.debugContext ? {
        _debug: {
          synthesizedContext: { lead: ctx.lead, persona: ctx.persona, signals: toStage10Signals(ctx.signals) },
          stage10: { path: 'src/core/pipeline/regenerateHook.js', gitSha: gitShaSafe() },
        },
      } : {}),
    };
  } catch (err) {
    logger.warn('synthesis failed', { error: (err as Error).message });
    signalSummary = { topSignals: [], suggestedHooks: [], totalCostUsd: 0 };
  }

  const dossier: EnrichedDossier = {
    company: opts.input,
    enrichedAt: new Date().toISOString(),
    totalCostPaise: summary.totalCostPaise,
    totalDurationMs: summary.totalDurationMs,
    modules: {
      hiring:      results.hiring      ?? emptyResult('hiring'),
      product:     results.product     ?? emptyResult('product'),
      customer:    results.customer    ?? emptyResult('customer'),
      voice:       results.voice       ?? emptyResult('voice'),
      operational: results.operational ?? emptyResult('operational'),
      positioning: results.positioning ?? emptyResult('positioning'),
    },
    signalSummary,
  };

  const validated = EnrichedDossierSchema.parse(dossier);
  const json = JSON.stringify(validated, null, 2);
  if (opts.outPath) {
    await writeFile(opts.outPath, json, 'utf8');
    logger.info('dossier written', { path: opts.outPath });
  } else {
    process.stdout.write(json + '\n');
  }

  if (opts.verbose) {
    logger.info('summary', {
      totalCostPaise: summary.totalCostPaise,
      totalDurationMs: summary.totalDurationMs,
      perAdapter: summary.perAdapter,
    });
  }

  return 0;
}

function emptyResult(name: string) {
  return {
    source: name, fetchedAt: new Date().toISOString(), status: 'empty' as const,
    payload: null, costPaise: 0, durationMs: 0,
  };
}

function gitShaSafe(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

// Entrypoint guard: only run when invoked directly (not when imported by tests)
const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => { process.stderr.write(`error: ${(err as Error).message}\n`); process.exit(1); },
  );
}
