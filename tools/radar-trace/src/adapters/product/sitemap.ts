import { z } from 'zod';
import * as cheerio from 'cheerio';
import type { Adapter, AdapterContext, AdapterResult } from '../../types.js';
import { toHttpsUrl } from '../../lib/domainUtils.js';

export const ProductSitemapPayloadSchema = z.object({
  url: z.string().nullable(),
  totalUrls: z.number().int().nonnegative(),
  urls: z.array(z.string()),
  byPathPrefix: z.record(z.string(), z.number()),
});

export type ProductSitemapPayload = z.infer<typeof ProductSitemapPayloadSchema>;

function parseUrlset(xml: string): string[] {
  const $ = cheerio.load(xml, { xmlMode: true });
  const locs: string[] = [];
  $('url loc, loc').each((_, el) => {
    const loc = $(el).text().trim();
    if (loc) locs.push(loc);
  });
  return locs;
}

function computeByPathPrefix(urls: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const url of urls) {
    try {
      const parsed = new URL(url);
      const parts = parsed.pathname.split('/').filter(Boolean);
      const prefix = parts.length > 0 ? `/${parts[0]}` : '/';
      counts[prefix] = (counts[prefix] ?? 0) + 1;
    } catch { /* skip malformed */ }
  }
  return counts;
}

function errorResult(msg: string, t0: number): AdapterResult<ProductSitemapPayload> {
  return {
    source: 'product.sitemap',
    fetchedAt: new Date().toISOString(),
    status: 'error',
    payload: null,
    errors: [msg],
    costPaise: 0,
    durationMs: Date.now() - t0,
  };
}

export const productSitemapAdapter: Adapter<ProductSitemapPayload> = {
  name: 'product.sitemap',
  module: 'product',
  version: '0.1.0',
  estimatedCostInr: 0,
  requiredEnv: [],
  schema: ProductSitemapPayloadSchema,
  async run(ctx: AdapterContext): Promise<AdapterResult<ProductSitemapPayload>> {
    const t0 = Date.now();
    try {
      const candidates = ['/sitemap.xml', '/sitemap_index.xml'];
      let sitemapUrl: string | null = null;
      let sitemapXml: string | null = null;

      for (const path of candidates) {
        const url = toHttpsUrl(ctx.input.domain, path);
        try {
          const res = await ctx.http(url, { signal: ctx.signal });
          if (res.ok) {
            sitemapXml = await res.text();
            sitemapUrl = url;
            break;
          }
        } catch { /* try next */ }
      }

      if (!sitemapXml || !sitemapUrl) {
        return {
          source: 'product.sitemap',
          fetchedAt: new Date().toISOString(),
          status: 'empty',
          payload: { url: null, totalUrls: 0, urls: [], byPathPrefix: {} },
          costPaise: 0,
          durationMs: Date.now() - t0,
        };
      }

      const allUrls = parseUrlset(sitemapXml);
      const totalUrls = allUrls.length;
      const urls = allUrls.slice(0, 100);
      const byPathPrefix = computeByPathPrefix(allUrls);

      return {
        source: 'product.sitemap',
        fetchedAt: new Date().toISOString(),
        status: totalUrls === 0 ? 'empty' : 'ok',
        payload: { url: sitemapUrl, totalUrls, urls, byPathPrefix },
        costPaise: 0,
        durationMs: Date.now() - t0,
      };
    } catch (err) {
      return errorResult(`sitemap: ${(err as Error).message}`, t0);
    }
  },
};
