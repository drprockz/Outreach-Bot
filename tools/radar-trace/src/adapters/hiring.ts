import { z } from 'zod';
import * as cheerio from 'cheerio';
import type { Adapter, AdapterContext, AdapterResult } from '../types.js';
import { classifyFunction, classifySeniority } from '../lib/classify.js';
import { toHttpsUrl } from '../lib/domainUtils.js';

const JobSchema = z.object({
  source: z.enum(['adzuna', 'careers']),
  title: z.string(),
  location: z.string().nullable(),
  date: z.string().nullable(),       // ISO YYYY-MM-DD if known
  url: z.string().nullable(),
  function: z.string(),               // FunctionTag
  seniority: z.string(),              // SeniorityTag
});

export const HiringPayloadSchema = z.object({
  totalActiveJobs: z.number().int().nonnegative(),
  jobsLast30Days: z.number().int().nonnegative(),
  jobsLast90Days: z.number().int().nonnegative(),
  byFunction: z.record(z.string(), z.number().int().nonnegative()),
  bySeniority: z.record(z.string(), z.number().int().nonnegative()),
  byLocation: z.record(z.string(), z.number().int().nonnegative()),
  newRoleTypes: z.array(z.string()),
  rawJobs: z.array(JobSchema),
});

export type HiringPayload = z.infer<typeof HiringPayloadSchema>;
type Job = z.infer<typeof JobSchema>;

export const hiringAdapter: Adapter<HiringPayload> = {
  name: 'hiring',
  version: '0.1.0',
  estimatedCostPaise: 0,
  requiredEnv: ['ADZUNA_APP_ID', 'ADZUNA_APP_KEY'],
  schema: HiringPayloadSchema,
  async run(ctx: AdapterContext): Promise<AdapterResult<HiringPayload>> {
    const t0 = Date.now();
    const errors: string[] = [];
    const adzunaJobs = await fetchAdzuna(ctx).catch((err) => {
      errors.push(`adzuna: ${(err as Error).message}`);
      return [] as Job[];
    });
    const careersJobs = await fetchCareers(ctx).catch((err) => {
      errors.push(`careers: ${(err as Error).message}`);
      return [] as Job[];
    });

    const allJobs = [...adzunaJobs, ...careersJobs];
    if (allJobs.length === 0) {
      return {
        source: 'hiring',
        fetchedAt: new Date().toISOString(),
        status: 'error',
        payload: null,
        errors,
        costPaise: 0,
        durationMs: Date.now() - t0,
      };
    }

    const payload = aggregate(allJobs);
    const status: AdapterResult<HiringPayload>['status'] =
      errors.length > 0 ? 'partial' : 'ok';

    return {
      source: 'hiring',
      fetchedAt: new Date().toISOString(),
      status,
      payload,
      errors: errors.length > 0 ? errors : undefined,
      costPaise: 0,
      durationMs: Date.now() - t0,
    };
  },
};

async function fetchAdzuna(ctx: AdapterContext): Promise<Job[]> {
  const id = ctx.env.ADZUNA_APP_ID!;
  const key = ctx.env.ADZUNA_APP_KEY!;
  const company = encodeURIComponent(ctx.input.name);
  const url = `https://api.adzuna.com/v1/api/jobs/in/search/1?app_id=${id}&app_key=${key}&company=${company}&results_per_page=50`;
  const res = await ctx.http(url, { signal: ctx.signal });
  if (!res.ok) throw new Error(`adzuna http ${res.status}`);
  const json = await res.json() as { results?: Array<{ title: string; location?: { display_name?: string }; created?: string; redirect_url?: string }> };
  return (json.results ?? []).map((r) => ({
    source: 'adzuna' as const,
    title: r.title,
    location: r.location?.display_name ?? null,
    date: r.created ? r.created.slice(0, 10) : null,
    url: r.redirect_url ?? null,
    function: classifyFunction(r.title),
    seniority: classifySeniority(r.title),
  }));
}

async function fetchCareers(ctx: AdapterContext): Promise<Job[]> {
  const url = toHttpsUrl(ctx.input.domain, '/careers');
  const res = await ctx.http(url, { signal: ctx.signal });
  if (!res.ok) throw new Error(`careers http ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);
  const titles: string[] = [];
  $('h1, h2, h3, h4, a').each((_, el) => {
    const text = $(el).text().trim();
    if (text && text.length < 120 && /(engineer|developer|manager|director|designer|sales|marketing|recruit|hr|legal|finance|product|customer|operations)/i.test(text)) {
      titles.push(text);
    }
  });
  return [...new Set(titles)].map((title) => ({
    source: 'careers' as const,
    title,
    location: null,
    date: null,
    url,
    function: classifyFunction(title),
    seniority: classifySeniority(title),
  }));
}

function aggregate(jobs: Job[]): HiringPayload {
  const today = Date.now();
  const day = 86400000;
  const byFunction: Record<string, number> = {};
  const bySeniority: Record<string, number> = {};
  const byLocation: Record<string, number> = {};
  let last30 = 0, last90 = 0;
  for (const j of jobs) {
    byFunction[j.function] = (byFunction[j.function] ?? 0) + 1;
    bySeniority[j.seniority] = (bySeniority[j.seniority] ?? 0) + 1;
    if (j.location) byLocation[j.location] = (byLocation[j.location] ?? 0) + 1;
    if (j.date) {
      const d = Date.parse(j.date);
      if (!isNaN(d)) {
        const ageDays = (today - d) / day;
        if (ageDays <= 30) last30 += 1;
        if (ageDays <= 90) last90 += 1;
      }
    }
  }
  // newRoleTypes = function tags that appear ONLY in jobs from the last 90 days
  const oldFunctions = new Set<string>();
  const newFunctions = new Set<string>();
  for (const j of jobs) {
    const isNew = j.date ? (today - Date.parse(j.date)) / day <= 90 : false;
    (isNew ? newFunctions : oldFunctions).add(j.function);
  }
  const newRoleTypes = [...newFunctions].filter((f) => !oldFunctions.has(f));

  return {
    totalActiveJobs: jobs.length,
    jobsLast30Days: last30,
    jobsLast90Days: last90,
    byFunction,
    bySeniority,
    byLocation,
    newRoleTypes,
    rawJobs: jobs,
  };
}
