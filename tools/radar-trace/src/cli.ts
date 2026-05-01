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
import { productSitemapAdapter } from './adapters/product/sitemap.js';
import { customerLogosCurrentAdapter } from './adapters/customer/logosCurrent.js';
import { customerWaybackDiffAdapter } from './adapters/customer/waybackDiff.js';
import { operationalTechStackAdapter } from './adapters/operational/techStack.js';
import { operationalCrtshAdapter } from './adapters/operational/crtsh.js';
import { operationalDnsAdapter } from './adapters/operational/dns.js';
import { operationalPagespeedAdapter } from './adapters/operational/pagespeed.js';
import { operationalHttpHeadersAdapter } from './adapters/operational/httpHeaders.js';
import { operationalRobotsTxtAdapter } from './adapters/operational/robotsTxt.js';
import { operationalWhoisAdapter } from './adapters/operational/whois.js';
import { voiceFounderLinkedinUrlAdapter } from './adapters/voice/founderLinkedinUrl.js';
import { voiceFounderGithubUrlAdapter } from './adapters/voice/founderGithubUrl.js';
import { voiceLinkedinPulseAdapter } from './adapters/voice/linkedinPulse.js';
import { voicePodcastAppearancesAdapter } from './adapters/voice/podcastAppearances.js';
import { voiceYoutubeChannelAdapter } from './adapters/voice/youtubeChannel.js';
import { positioningCrunchbaseSnippetAdapter } from './adapters/positioning/crunchbaseSnippet.js';
import { positioningBraveNewsAdapter } from './adapters/positioning/braveNews.js';
import { positioningSerperNewsAdapter } from './adapters/positioning/serperNews.js';
import { adsMetaLibraryUrlAdapter } from './adapters/ads/metaLibraryUrl.js';
import { adsGoogleTransparencyUrlAdapter } from './adapters/ads/googleTransparencyUrl.js';
import { socialLinksAdapter } from './adapters/social/links.js';
// directories — chunk 5
import { zaubacorpAdapter } from './adapters/directories/zaubacorp.js';
import { ambitionboxAdapter } from './adapters/directories/ambitionbox.js';
import { crunchbaseUrlAdapter } from './adapters/directories/crunchbaseUrl.js';
import { linkedinCompanyApifyAdapter } from './adapters/directories/linkedinCompanyApify.js';
import { g2CapterraAdapter } from './adapters/directories/g2Capterra.js';
import { glassdoorApifyAdapter } from './adapters/directories/glassdoorApify.js';
// chunk 6 — paid Apify scrapers
import { voiceLinkedinPostsApifyAdapter } from './adapters/voice/linkedinPostsApify.js';
import { twitterPostsApifyAdapter } from './adapters/social/twitterPostsApify.js';
import { instagramPostsApifyAdapter } from './adapters/social/instagramPostsApify.js';
import { facebookPostsApifyAdapter } from './adapters/social/facebookPostsApify.js';
import { adsMetaCreativesApifyAdapter } from './adapters/ads/metaCreativesApify.js';
import { adsGoogleCreativesApifyAdapter } from './adapters/ads/googleCreativesApify.js';
import type { Adapter, AdapterResult, Company, ModuleName } from './types.js';

const ALL_ADAPTERS: ReadonlyArray<Adapter<unknown>> = [
  hiringAdzunaAdapter as Adapter<unknown>,
  hiringCareersAdapter as Adapter<unknown>,
  productGithubOrgAdapter as Adapter<unknown>,
  productGithubEventsAdapter as Adapter<unknown>,
  productGithubReleasesAdapter as Adapter<unknown>,
  productChangelogAdapter as Adapter<unknown>,
  productRssAdapter as Adapter<unknown>,
  productSitemapAdapter as Adapter<unknown>,
  customerLogosCurrentAdapter as Adapter<unknown>,
  customerWaybackDiffAdapter as Adapter<unknown>,
  operationalTechStackAdapter as Adapter<unknown>,
  operationalCrtshAdapter as Adapter<unknown>,
  operationalDnsAdapter as Adapter<unknown>,
  operationalPagespeedAdapter as Adapter<unknown>,
  operationalHttpHeadersAdapter as Adapter<unknown>,
  operationalRobotsTxtAdapter as Adapter<unknown>,
  operationalWhoisAdapter as Adapter<unknown>,
  voiceFounderLinkedinUrlAdapter as Adapter<unknown>,
  voiceFounderGithubUrlAdapter as Adapter<unknown>,
  voiceLinkedinPulseAdapter as Adapter<unknown>,
  voicePodcastAppearancesAdapter as Adapter<unknown>,
  voiceYoutubeChannelAdapter as Adapter<unknown>,
  positioningCrunchbaseSnippetAdapter as Adapter<unknown>,
  positioningBraveNewsAdapter as Adapter<unknown>,
  positioningSerperNewsAdapter as Adapter<unknown>,
  adsMetaLibraryUrlAdapter as Adapter<unknown>,
  adsGoogleTransparencyUrlAdapter as Adapter<unknown>,
  socialLinksAdapter as Adapter<unknown>,
  // directories — chunk 5 (Wave 1: no gate)
  zaubacorpAdapter as Adapter<unknown>,
  ambitionboxAdapter as Adapter<unknown>,
  crunchbaseUrlAdapter as Adapter<unknown>,
  linkedinCompanyApifyAdapter as Adapter<unknown>,
  // directories — chunk 5 (Wave 2: gated)
  g2CapterraAdapter as Adapter<unknown>,
  glassdoorApifyAdapter as Adapter<unknown>,
  // chunk 6 — paid Apify scrapers (Wave 1: no gate)
  voiceLinkedinPostsApifyAdapter as Adapter<unknown>,
  twitterPostsApifyAdapter as Adapter<unknown>,
  instagramPostsApifyAdapter as Adapter<unknown>,
  facebookPostsApifyAdapter as Adapter<unknown>,
  adsMetaCreativesApifyAdapter as Adapter<unknown>,
  adsGoogleCreativesApifyAdapter as Adapter<unknown>,
];

export interface CliOptions {
  action: 'enrich' | 'clear-cache';
  input: Company;
  modules: ModuleName[];
  /** When true, Apify adapters are excluded from the run (their slots in the dossier are status:'empty'). */
  skipPaid: boolean;
  /** When set, pre-flight cost (sum of estimatedCostInr across enabled adapters) must not exceed this value. */
  maxCostInr?: number;
  /** When set, overrides --modules and runs only the listed adapter names. */
  adapters?: string[];
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
    .option('-a, --adapters <list>', 'Override: run only these adapters (e.g. "hiring.adzuna,operational.crtsh")')
    .option('--skip-paid', 'Skip all Apify-paid adapters (validation-cost mode; ~₹2/lead)', false)
    .option('--max-cost-inr <n>', 'Abort run if pre-flight worst-case cost exceeds this INR threshold (assumes all gates fire)', (v) => parseFloat(v))
    .option('-o, --out <path>', 'Write JSON to file (default: stdout)')
    .option('--no-cache', 'Skip cache reads (writes still happen)')
    .option('--clear-cache', 'Wipe ./cache/ then exit')
    .option('--concurrency <n>', 'Adapter parallelism', (v) => parseInt(v, 10), 4)
    .option('--timeout <ms>', 'Per-adapter timeout in ms', (v) => parseInt(v, 10), 30000)
    .option('-v, --verbose', 'Per-adapter progress, timing, cost', false);

  program.parse(argv, { from: 'user' });
  const o = program.opts<{
    company?: string; domain?: string; location?: string; founder?: string;
    linkedin?: string; modules: string; adapters?: string; skipPaid: boolean;
    maxCostInr?: number; out?: string; cache: boolean;
    clearCache?: boolean; concurrency: number; timeout: number; verbose: boolean;
  }>();

  if (o.clearCache) {
    return {
      action: 'clear-cache',
      input: { name: '', domain: '' },
      modules: [...ALL_MODULE_NAMES],
      skipPaid: false,
      useCache: o.cache,
      concurrency: o.concurrency,
      timeoutMs: o.timeout,
      verbose: o.verbose,
    };
  }

  if (!o.company) throw new Error('Missing required --company');
  if (!o.domain) throw new Error('Missing required --domain');

  // --adapters overrides --modules (granular > coarse)
  let adapterNames: string[] | undefined;
  if (o.adapters !== undefined) {
    const names = o.adapters.split(',').map((s) => s.trim()).filter(Boolean);
    if (names.length === 0) {
      throw new Error('--adapters requires at least one adapter name (e.g. "hiring.adzuna,operational.crtsh")');
    }
    const validNames = new Set(ALL_ADAPTERS.map((a) => a.name));
    const unknown = names.filter((n) => !validNames.has(n));
    if (unknown.length > 0) {
      throw new Error(
        `Unknown adapter(s): ${unknown.join(', ')}\nValid adapter names:\n  ${[...validNames].sort().join('\n  ')}`,
      );
    }
    adapterNames = names;
  }

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
    adapters: adapterNames,
    skipPaid: o.skipPaid,
    maxCostInr: o.maxCostInr,
    outPath: o.out,
    useCache: o.cache,
    concurrency: o.concurrency,
    timeoutMs: o.timeout,
    verbose: o.verbose,
  };
}

function resolveAdapters(opts: Pick<CliOptions, 'modules' | 'adapters' | 'skipPaid'>): Adapter<unknown>[] {
  let selected: Adapter<unknown>[];
  if (opts.adapters && opts.adapters.length > 0) {
    // --adapters overrides --modules
    const nameSet = new Set(opts.adapters);
    selected = ALL_ADAPTERS.filter((a) => nameSet.has(a.name));
  } else {
    const moduleSet = new Set<string>(opts.modules);
    selected = ALL_ADAPTERS.filter((a) => a.module && moduleSet.has(a.module));
  }
  if (opts.skipPaid) {
    selected = selected.filter((a) => !a.name.includes('_apify'));
  }
  return selected;
}

/** Build the empty-result stub for a skipped/not-run adapter. */
function makeEmptyResult(a: Adapter<unknown>): AdapterResult<unknown> {
  return {
    source: a.name,
    fetchedAt: new Date().toISOString(),
    status: 'empty',
    payload: null,
    costPaise: 0,
    durationMs: 0,
  };
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

// Adapters that use BOTH Serper (URL discovery) AND Apify (scrape).
// Their Serper spend = costPaise - apifyPaise, so we need to back it out.
const APIFY_SERPER_ADAPTERS = new Set([
  'voice.linkedin_posts_apify',
  'social.twitter_posts_apify',
  'social.instagram_posts_apify',
  'social.facebook_posts_apify',
  'directories.linkedin_company_apify',
]);

function computeCostBreakdown(
  results: Record<string, AdapterResult<unknown>>,
  usdToInr: number,
): RadarTraceDossier['totalCostBreakdown'] {
  let serper = 0, brave = 0, listenNotes = 0, pagespeed = 0, apifyUsd = 0;
  for (const [name, r] of Object.entries(results)) {
    const inr = r.costPaise / 100;
    if (name.includes('apify')) {
      // Accumulate Apify USD spend for all *_apify adapters
      apifyUsd += r.costMeta?.costUsd ?? 0;
      // For adapters that also use Serper, back out the Serper portion
      if (APIFY_SERPER_ADAPTERS.has(name)) {
        const apifyInr = (r.costMeta?.costUsd ?? 0) * usdToInr;
        const serperInr = inr - apifyInr;
        if (serperInr > 0) serper += serperInr;
      }
    } else if (
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

  // Determine which adapters will actually run vs. be skipped
  const adaptersToRun = resolveAdapters(opts);

  // Determine which adapters are skipped (present in ALL_ADAPTERS but not in the run set)
  // When --skip-paid is set, Apify adapters are in ALL_ADAPTERS but excluded from run.
  // When --adapters is set, only those adapters run; all others are skipped.
  const runSet = new Set(adaptersToRun.map((a) => a.name));
  // For modules block: track the "enabled scope" (which adapters are in scope before skip-paid)
  const scopedAdapters = (() => {
    if (opts.adapters && opts.adapters.length > 0) {
      const nameSet = new Set(opts.adapters);
      return ALL_ADAPTERS.filter((a) => nameSet.has(a.name));
    }
    const moduleSet = new Set<string>(opts.modules);
    return ALL_ADAPTERS.filter((a) => a.module && moduleSet.has(a.module));
  })();
  const skippedAdapters = scopedAdapters.filter((a) => !runSet.has(a.name));

  // Pre-flight cost check (worst-case — assumes all gates fire)
  const preflightCost = adaptersToRun.reduce((sum, a) => sum + a.estimatedCostInr, 0);
  if (opts.maxCostInr !== undefined && preflightCost > opts.maxCostInr) {
    const offenders = adaptersToRun
      .filter((a) => a.estimatedCostInr > 0)
      .map((a) => `  ${a.name}: ₹${a.estimatedCostInr}`)
      .join('\n');
    process.stderr.write(
      `error: pre-flight cost ₹${preflightCost.toFixed(2)} exceeds --max-cost-inr ₹${opts.maxCostInr}\n` +
      `Paid adapters contributing to cost:\n${offenders}\n` +
      `Use --skip-paid to run validation-cost mode (~₹2/lead) or raise --max-cost-inr.\n`,
    );
    return 1;
  }
  process.stderr.write(`pre-flight estimated cost (worst case): ₹${preflightCost.toFixed(2)}\n`);

  const { results, summary } = await runEnrichment({
    input: opts.input, env, adapters: adaptersToRun, cache, logger, http,
    concurrency: opts.concurrency, timeoutMs: opts.timeoutMs, useCache: opts.useCache,
  });

  // Merge skipped-adapter stubs into results so the dossier always has all slots
  for (const a of skippedAdapters) {
    results[a.name] = makeEmptyResult(a);
  }

  process.stderr.write(`actual cost: ₹${summary.totalCostInr.toFixed(2)}\n`);

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
    modules: buildModulesBlock(scopedAdapters),
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
