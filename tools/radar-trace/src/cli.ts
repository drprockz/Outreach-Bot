#!/usr/bin/env node
import { Command } from 'commander';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runEnrichment } from './orchestrator.js';
import { createFileCache } from './cache.js';
import { createHttp } from './http.js';
import { createLogger } from './logger.js';
import { loadEnv } from './env.js';
import {
  RadarTraceDossierSchema,
  ALL_MODULE_NAMES,
  type RadarTraceDossier,
} from './schemas.js';
import { hiringAdzunaAdapter } from './adapters/hiring/adzuna.js';
import { hiringCareersAdapter } from './adapters/hiring/careers.js';
import { productGithubOrgAdapter } from './adapters/product/githubOrg.js';
import { productGithubEventsAdapter } from './adapters/product/githubEvents.js';
import { productGithubReleasesAdapter } from './adapters/product/githubReleases.js';
import { productChangelogAdapter } from './adapters/product/changelog.js';
import { productRssAdapter } from './adapters/product/rss.js';
import { customerLogosCurrentAdapter } from './adapters/customer/logosCurrent.js';
import { customerWaybackDiffAdapter } from './adapters/customer/waybackDiff.js';
import { operationalTechStackAdapter } from './adapters/operational/techStack.js';
import { operationalCrtshAdapter } from './adapters/operational/crtsh.js';
import { operationalDnsAdapter } from './adapters/operational/dns.js';
// voice / positioning / social / ads / directories added in chunks 3-5
import type { Adapter, AdapterResult, Company, ModuleName } from './types.js';

const ALL_ADAPTERS: ReadonlyArray<Adapter<unknown>> = [
  hiringAdzunaAdapter as Adapter<unknown>,
  hiringCareersAdapter as Adapter<unknown>,
  productGithubOrgAdapter as Adapter<unknown>,
  productGithubEventsAdapter as Adapter<unknown>,
  productGithubReleasesAdapter as Adapter<unknown>,
  productChangelogAdapter as Adapter<unknown>,
  productRssAdapter as Adapter<unknown>,
  customerLogosCurrentAdapter as Adapter<unknown>,
  customerWaybackDiffAdapter as Adapter<unknown>,
  operationalTechStackAdapter as Adapter<unknown>,
  operationalCrtshAdapter as Adapter<unknown>,
  operationalDnsAdapter as Adapter<unknown>,
  // voice / positioning / social / ads / directories added in chunks 3-5
];

export interface CliOptions {
  action: 'enrich' | 'clear-cache';
  input: Company;
  modules: ModuleName[];
  outPath?: string;
  useCache: boolean;
  concurrency: number;
  timeoutMs: number;
  verbose: boolean;
}

export function buildOptions(argv: string[]): CliOptions {
  const program = new Command()
    .exitOverride()
    .name('radar-trace')
    .option('-c, --company <name>', 'Company name')
    .option('-d, --domain <domain>', 'Primary domain (e.g. acme.com)')
    .option('-l, --location <location>', '"City, Country"')
    .option('-f, --founder <name>', 'Founder/CEO name')
    .option('--linkedin <url>', 'Founder LinkedIn URL')
    .option('-m, --modules <list>', 'Comma-separated module list', ALL_MODULE_NAMES.join(','))
    .option('-o, --out <path>', 'Write JSON to file (default: stdout)')
    .option('--no-cache', 'Skip cache reads (writes still happen)')
    .option('--clear-cache', 'Wipe ./cache/ then exit')
    .option('--concurrency <n>', 'Adapter parallelism', (v) => parseInt(v, 10), 4)
    .option('--timeout <ms>', 'Per-adapter timeout in ms', (v) => parseInt(v, 10), 30000)
    .option('-v, --verbose', 'Per-adapter progress, timing, cost', false);

  program.parse(argv, { from: 'user' });
  const o = program.opts<{
    company?: string; domain?: string; location?: string; founder?: string;
    linkedin?: string; modules: string; out?: string; cache: boolean;
    clearCache?: boolean; concurrency: number; timeout: number; verbose: boolean;
  }>();

  if (o.clearCache) {
    return {
      action: 'clear-cache',
      input: { name: '', domain: '' },
      modules: [...ALL_MODULE_NAMES],
      useCache: o.cache,
      concurrency: o.concurrency,
      timeoutMs: o.timeout,
      verbose: o.verbose,
    };
  }

  if (!o.company) throw new Error('Missing required --company');
  if (!o.domain) throw new Error('Missing required --domain');

  const requested = o.modules.split(',').map((s) => s.trim()).filter(Boolean);
  for (const m of requested) {
    if (!(ALL_MODULE_NAMES as readonly string[]).includes(m)) {
      throw new Error(`Unknown module: ${m} (valid: ${ALL_MODULE_NAMES.join(',')})`);
    }
  }

  return {
    action: 'enrich',
    input: {
      name: o.company,
      domain: o.domain,
      location: o.location,
      founder: o.founder,
      founderLinkedinUrl: o.linkedin,
    },
    modules: requested as ModuleName[],
    outPath: o.out,
    useCache: o.cache,
    concurrency: o.concurrency,
    timeoutMs: o.timeout,
    verbose: o.verbose,
  };
}

function resolveAdapters(modules: ModuleName[]): Adapter<unknown>[] {
  const moduleSet = new Set<string>(modules);
  return ALL_ADAPTERS.filter((a) => a.module && moduleSet.has(a.module));
}

function buildModulesBlock(
  enabled: ReadonlyArray<Adapter<unknown>>,
): RadarTraceDossier['modules'] {
  const out = Object.fromEntries(
    ALL_MODULE_NAMES.map((m) => [m, { adapters: [] as string[] }]),
  ) as RadarTraceDossier['modules'];
  for (const a of enabled) {
    if (a.module) {
      out[a.module]!.adapters.push(a.name);
    }
  }
  return out;
}

function computeCostBreakdown(
  results: Record<string, AdapterResult<unknown>>,
  usdToInr: number,
): RadarTraceDossier['totalCostBreakdown'] {
  let serper = 0, brave = 0, listenNotes = 0, pagespeed = 0, apifyUsd = 0;
  for (const [name, r] of Object.entries(results)) {
    const inr = r.costPaise / 100;
    if (name.includes('apify')) apifyUsd += r.costMeta?.costUsd ?? 0;
    else if (
      name === 'voice.linkedin_pulse' || name.startsWith('voice.founder_') ||
      name === 'positioning.crunchbase_snippet' || name === 'positioning.serper_news' ||
      name === 'voice.youtube_channel'
    ) serper += inr;
    else if (name === 'positioning.brave_news') brave += inr;
    else if (name === 'voice.podcast_appearances') listenNotes += inr;
    else if (name === 'operational.pagespeed') pagespeed += inr;
  }
  return {
    serper, brave, listenNotes, pagespeed, apifyUsd,
    apifyInr: apifyUsd * usdToInr,
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

  const usdToInr = parseFloat(env.USD_INR_RATE ?? '84.0');
  const totalCostBreakdown = computeCostBreakdown(results, usdToInr);

  const dossier: RadarTraceDossier = {
    radarTraceVersion: '1.0.0',
    company: opts.input,
    tracedAt: new Date().toISOString(),
    totalCostInr: summary.totalCostInr,
    totalCostBreakdown,
    totalDurationMs: summary.totalDurationMs,
    adapters: results,
    modules: buildModulesBlock(adapters),
    signalSummary: null,
  };

  const validated = RadarTraceDossierSchema.parse(dossier);
  const json = JSON.stringify(validated, null, 2);
  if (opts.outPath) {
    await writeFile(opts.outPath, json, 'utf8');
    logger.info('dossier written', { path: opts.outPath });
  } else {
    process.stdout.write(json + '\n');
  }

  if (opts.verbose) {
    logger.info('summary', {
      totalCostInr: summary.totalCostInr,
      totalDurationMs: summary.totalDurationMs,
      perAdapter: summary.perAdapter,
    });
  }

  return 0;
}

// Entrypoint guard: only run when invoked directly (not when imported by tests)
const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => { process.stderr.write(`error: ${(err as Error).message}\n`); process.exit(1); },
  );
}
