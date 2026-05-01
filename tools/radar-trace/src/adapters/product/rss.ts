import { z } from 'zod';
import * as cheerio from 'cheerio';
import type { Adapter, AdapterContext, AdapterResult } from '../../types.js';
import { toHttpsUrl } from '../../lib/domainUtils.js';

const RssItemSchema = z.object({
  title: z.string(),
  link: z.string().nullable(),
  date: z.string().nullable(),
  description: z.string().nullable(),
});

const RssFeedSchema = z.object({
  url: z.string(),
  title: z.string().nullable(),
  items: z.array(RssItemSchema),
});

export const ProductRssPayloadSchema = z.object({
  feeds: z.array(RssFeedSchema),
});

export type ProductRssPayload = z.infer<typeof ProductRssPayloadSchema>;

function parseRssXml(xml: string): Array<{ title: string; link: string | null; date: string | null; description: string | null }> {
  const $ = cheerio.load(xml, { xmlMode: true });
  const items: Array<{ title: string; link: string | null; date: string | null; description: string | null }> = [];
  $('item, entry').each((_, el) => {
    const title = $(el).find('title').first().text().trim();
    const link = $(el).find('link').first().text().trim() || $(el).find('link').first().attr('href') || null;
    const pubDate = $(el).find('pubDate, published, updated').first().text().trim() || null;
    const description = $(el).find('description, summary, content').first().text().trim() || null;
    if (title) {
      items.push({
        title,
        link: link || null,
        date: pubDate ? toIsoIfPossible(pubDate) : null,
        description: description ? description.slice(0, 500) : null,
      });
    }
  });
  return items;
}

function toIsoIfPossible(raw: string): string {
  const d = new Date(raw);
  return isNaN(d.getTime()) ? raw : d.toISOString();
}

function errorResult(msg: string, t0: number): AdapterResult<ProductRssPayload> {
  return {
    source: 'product.rss',
    fetchedAt: new Date().toISOString(),
    status: 'error',
    payload: null,
    errors: [msg],
    costPaise: 0,
    durationMs: Date.now() - t0,
  };
}

export const productRssAdapter: Adapter<ProductRssPayload> = {
  name: 'product.rss',
  module: 'product',
  version: '0.1.0',
  estimatedCostInr: 0,
  requiredEnv: [],
  schema: ProductRssPayloadSchema,
  async run(ctx: AdapterContext): Promise<AdapterResult<ProductRssPayload>> {
    const t0 = Date.now();
    try {
      const homepage = await ctx.http(toHttpsUrl(ctx.input.domain, '/'), { signal: ctx.signal });
      if (!homepage.ok) {
        return errorResult(`homepage fetch failed: ${homepage.status}`, t0);
      }
      const html = await homepage.text();
      const $ = cheerio.load(html);
      const feedLinks: Array<{ url: string; title: string | null }> = [];
      $('link[rel="alternate"]').each((_, el) => {
        const type = $(el).attr('type') ?? '';
        const href = $(el).attr('href');
        const title = $(el).attr('title') ?? null;
        if (!href) return;
        if (type.includes('rss') || type.includes('atom')) {
          const absoluteUrl = href.startsWith('http')
            ? href
            : toHttpsUrl(ctx.input.domain, href.startsWith('/') ? href : `/${href}`);
          feedLinks.push({ url: absoluteUrl, title });
        }
      });
      if (feedLinks.length === 0) {
        return {
          source: 'product.rss',
          fetchedAt: new Date().toISOString(),
          status: 'empty',
          payload: { feeds: [] },
          costPaise: 0,
          durationMs: Date.now() - t0,
        };
      }
      const feeds: ProductRssPayload['feeds'] = [];
      for (const link of feedLinks) {
        try {
          const res = await ctx.http(link.url, { signal: ctx.signal });
          if (!res.ok) continue;
          const xml = await res.text();
          const items = parseRssXml(xml);
          feeds.push({ url: link.url, title: link.title, items: items.slice(0, 20) });
        } catch { /* skip this feed */ }
      }
      return {
        source: 'product.rss',
        fetchedAt: new Date().toISOString(),
        status: feeds.length > 0 ? 'ok' : 'partial',
        payload: { feeds },
        costPaise: 0,
        durationMs: Date.now() - t0,
      };
    } catch (err) {
      return errorResult(`rss: ${(err as Error).message}`, t0);
    }
  },
};
