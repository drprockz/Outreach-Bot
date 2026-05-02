import { z } from 'zod';
import * as cheerio from 'cheerio';
import type { Adapter, AdapterContext, AdapterResult } from '../../types.js';
import { classifyFunction, classifySeniority } from '../../lib/classify.js';
import { toHttpsUrl } from '../../lib/domainUtils.js';
import { JobSchema, type Job } from './types.js';

export const HiringCareersPayloadSchema = z.object({
  jobs: z.array(JobSchema),
  url: z.string(),
});

export type HiringCareersPayload = z.infer<typeof HiringCareersPayloadSchema>;

export const hiringCareersAdapter: Adapter<HiringCareersPayload> = {
  name: 'hiring.careers',
  module: 'hiring',
  version: '0.1.0',
  estimatedCostInr: 0,
  requiredEnv: [],
  schema: HiringCareersPayloadSchema,
  async run(ctx: AdapterContext): Promise<AdapterResult<HiringCareersPayload>> {
    const t0 = Date.now();
    const url = toHttpsUrl(ctx.input.domain, '/careers');
    try {
      const res = await ctx.http(url, { signal: ctx.signal });
      if (!res.ok) throw new Error(`careers http ${res.status}`);
      const html = await res.text();
      const $ = cheerio.load(html);
      const titles: string[] = [];
      $('h1, h2, h3, h4, a').each((_, el) => {
        const text = $(el).text().trim();
        // Reject all-caps single-word nav labels like "PRODUCT", "CUSTOMERS", "CAREERS(current)"
        const isNavItem = !text.includes(' ') && /^[A-Z]{2,}(\([^)]*\))?$/.test(text);
        if (text && text.length < 120 && !isNavItem && /(engineer|developer|manager|director|designer|sales|marketing|recruit|hr|legal|finance|product|customer|operations)/i.test(text)) {
          titles.push(text);
        }
      });
      const jobs: Job[] = [...new Set(titles)].map((title) => ({
        source: 'careers' as const,
        title,
        location: null,
        date: null,
        url,
        function: classifyFunction(title),
        seniority: classifySeniority(title),
      }));
      const status = jobs.length === 0 ? 'empty' : 'ok';
      return {
        source: 'hiring.careers',
        fetchedAt: new Date().toISOString(),
        status,
        payload: { jobs, url },
        costPaise: 0,
        durationMs: Date.now() - t0,
      };
    } catch (err) {
      return {
        source: 'hiring.careers',
        fetchedAt: new Date().toISOString(),
        status: 'error',
        payload: null,
        errors: [`careers: ${(err as Error).message}`],
        costPaise: 0,
        durationMs: Date.now() - t0,
      };
    }
  },
};
