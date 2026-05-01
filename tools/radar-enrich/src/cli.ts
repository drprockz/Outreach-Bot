#!/usr/bin/env node
import { Command } from 'commander';
import { z } from 'zod';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
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
import type { Adapter, CompanyInput } from './types.js';

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

const STUB_ADAPTERS: Record<ModuleName, Adapter<unknown> | null> = {
  hiring: hiringAdapter as Adapter<unknown>,
  product: productAdapter as Adapter<unknown>,
  customer: null,      // wired in Chunk 5
  operational: null,   // wired in Chunk 5
  voice: voiceStub as Adapter<unknown>,
  positioning: positioningStub as Adapter<unknown>,
};

function resolveAdapters(modules: ModuleName[]): Adapter<unknown>[] {
  const out: Adapter<unknown>[] = [];
  for (const m of modules) {
    const a = STUB_ADAPTERS[m];
    if (a) {
      out.push(a);
    } else {
      // Pre-Chunk-5: every real adapter is "not implemented" → emit a stub-empty adapter inline
      out.push(notImplementedAdapter(m));
    }
  }
  return out;
}

// Pre-Chunk-5 placeholder. The four real adapter imports replace it in Chunk 5,
// at which point this function and the `STUB_ADAPTERS[m] === null` branch above
// are deleted (Task 5.0/6.4).
function notImplementedAdapter(name: ModuleName): Adapter<unknown> {
  return {
    name,
    version: '0.0.0',
    estimatedCostPaise: 0,
    requiredEnv: [],
    schema: z.unknown(),
    async run() {
      return {
        source: name,
        fetchedAt: new Date().toISOString(),
        status: 'empty',
        payload: null,
        errors: ['adapter not yet implemented'],
        costPaise: 0,
        durationMs: 0,
      };
    },
  };
}

export async function main(argv: string[]): Promise<number> {
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

  // Synthesis is wired in Chunk 7. For now emit an empty signalSummary.
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
    signalSummary: { topSignals: [], suggestedHooks: [], totalCostUsd: 0 },
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

// Entrypoint guard: only run when invoked directly (not when imported by tests)
const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => { process.stderr.write(`error: ${(err as Error).message}\n`); process.exit(1); },
  );
}
