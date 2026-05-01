import { z } from 'zod';
import * as cheerio from 'cheerio';
import type { Adapter, AdapterContext, AdapterResult } from '../../types.js';
import { toHttpsUrl } from '../../lib/domainUtils.js';
import { ChangelogEntrySchema, type ChangelogEntry } from './types.js';

export const ProductChangelogPayloadSchema = z.object({
  entries: z.array(ChangelogEntrySchema),
  discoveredAt: z.string().nullable(),
});

export type ProductChangelogPayload = z.infer<typeof ProductChangelogPayloadSchema>;

async function fetchChangelog(ctx: AdapterContext): Promise<ChangelogEntry[]> {
  const candidates = ['/changelog', '/blog', '/release-notes', '/whats-new'];
  for (const path of candidates) {
    try {
      const url = toHttpsUrl(ctx.input.domain, path);
      const res = await ctx.http(url, { signal: ctx.signal });
      if (!res.ok) continue;
      const html = await res.text();
      const $ = cheerio.load(html);
      const entries: ChangelogEntry[] = [];
      $('article, .post, .entry, h2, h3').each((_, el) => {
        const heading = $(el).find('h1, h2, h3').first().text().trim() || $(el).text().trim();
        const time = $(el).find('time').attr('datetime') ?? null;
        const link = $(el).find('a').first().attr('href') ?? null;
        if (heading && heading.length < 200) {
          entries.push({ title: heading, date: time, url: link });
        }
      });
      if (entries.length > 0) return entries.slice(0, 20);
    } catch { /* try next candidate */ }
  }
  return [];
}

export const productChangelogAdapter: Adapter<ProductChangelogPayload> = {
  name: 'product.changelog',
  module: 'product',
  version: '0.1.0',
  estimatedCostInr: 0,
  estimatedCostPaise: 0,
  requiredEnv: [],
  schema: ProductChangelogPayloadSchema,
  async run(ctx: AdapterContext): Promise<AdapterResult<ProductChangelogPayload>> {
    const t0 = Date.now();
    try {
      const entries = await fetchChangelog(ctx);
      const status = entries.length === 0 ? 'empty' : 'ok';
      return {
        source: 'product.changelog',
        fetchedAt: new Date().toISOString(),
        status,
        payload: { entries, discoveredAt: entries.length > 0 ? new Date().toISOString() : null },
        costPaise: 0,
        durationMs: Date.now() - t0,
      };
    } catch (err) {
      return {
        source: 'product.changelog',
        fetchedAt: new Date().toISOString(),
        status: 'error',
        payload: null,
        errors: [`changelog: ${(err as Error).message}`],
        costPaise: 0,
        durationMs: Date.now() - t0,
      };
    }
  },
};
