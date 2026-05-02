import { z } from 'zod';
import type { Adapter, AdapterContext, AdapterResult } from '../../types.js';
import { classifyFunction, classifySeniority } from '../../lib/classify.js';
import { JobSchema, type Job } from './types.js';

export const HiringAdzunaPayloadSchema = z.object({
  jobs: z.array(JobSchema),
});

export type HiringAdzunaPayload = z.infer<typeof HiringAdzunaPayloadSchema>;

export const hiringAdzunaAdapter: Adapter<HiringAdzunaPayload> = {
  name: 'hiring.adzuna',
  module: 'hiring',
  version: '0.1.0',
  estimatedCostInr: 0,
  requiredEnv: ['ADZUNA_APP_ID', 'ADZUNA_APP_KEY'],
  schema: HiringAdzunaPayloadSchema,
  async run(ctx: AdapterContext): Promise<AdapterResult<HiringAdzunaPayload>> {
    const t0 = Date.now();
    const id = ctx.env.ADZUNA_APP_ID!;
    const key = ctx.env.ADZUNA_APP_KEY!;
    const name = encodeURIComponent(ctx.input.name);
    const base = `https://api.adzuna.com/v1/api/jobs/in/search/1?app_id=${id}&app_key=${key}&results_per_page=50`;
    type AdzunaResult = { title: string; location?: { display_name?: string }; created?: string; redirect_url?: string };
    type AdzunaJson = { results?: AdzunaResult[] };

    async function tryFetch(url: string): Promise<AdzunaJson | null> {
      const res = await ctx.http(url, { signal: ctx.signal });
      // 400 means this parameter form is invalid for this query — not a hard error
      if (res.status === 400) return null;
      if (!res.ok) throw new Error(`adzuna http ${res.status}`);
      return res.json() as Promise<AdzunaJson>;
    }

    try {
      // Primary: company= parameter search
      let json = await tryFetch(`${base}&company=${name}`);
      // Fallback: keyword search when company= is rejected (short/unusual names)
      if (json === null) json = await tryFetch(`${base}&what=${name}`);
      // Both forms rejected → no results, not an error
      if (json === null) {
        return {
          source: 'hiring.adzuna',
          fetchedAt: new Date().toISOString(),
          status: 'empty',
          payload: { jobs: [] },
          costPaise: 0,
          durationMs: Date.now() - t0,
        };
      }
      const jobs: Job[] = (json.results ?? []).map((r) => ({
        source: 'adzuna' as const,
        title: r.title,
        location: r.location?.display_name ?? null,
        date: r.created ? r.created.slice(0, 10) : null,
        url: r.redirect_url ?? null,
        function: classifyFunction(r.title),
        seniority: classifySeniority(r.title),
      }));
      const status = jobs.length === 0 ? 'empty' : 'ok';
      return {
        source: 'hiring.adzuna',
        fetchedAt: new Date().toISOString(),
        status,
        payload: { jobs },
        costPaise: 0,
        durationMs: Date.now() - t0,
      };
    } catch (err) {
      return {
        source: 'hiring.adzuna',
        fetchedAt: new Date().toISOString(),
        status: 'error',
        payload: null,
        errors: [`adzuna: ${(err as Error).message}`],
        costPaise: 0,
        durationMs: Date.now() - t0,
      };
    }
  },
};
