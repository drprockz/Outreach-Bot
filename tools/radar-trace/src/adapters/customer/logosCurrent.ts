import { z } from 'zod';
import * as cheerio from 'cheerio';
import type { Adapter, AdapterContext, AdapterResult } from '../../types.js';
import { toHttpsUrl } from '../../lib/domainUtils.js';

export const CustomerLogosCurrentPayloadSchema = z.object({
  customersPageUrl: z.string().nullable(),
  currentLogos: z.array(z.string()),
});

export type CustomerLogosCurrentPayload = z.infer<typeof CustomerLogosCurrentPayloadSchema>;

export async function findCustomersPage(ctx: AdapterContext): Promise<{ url: string; html: string } | null> {
  const candidates = ['/customers', '/clients', '/case-studies', '/our-customers'];
  for (const path of candidates) {
    const url = toHttpsUrl(ctx.input.domain, path);
    try {
      const res = await ctx.http(url, { signal: ctx.signal });
      if (res.ok) return { url, html: await res.text() };
    } catch { /* try next */ }
  }
  return null;
}

export function extractLogos(html: string): string[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  $('img').each((_, el) => {
    const alt = ($(el).attr('alt') ?? '').trim();
    const src = $(el).attr('src') ?? '';
    if (alt && alt.length > 1 && alt.length < 80) {
      seen.add(alt);
    } else if (src) {
      // derive from filename: /logos/acme.svg → "acme"
      const name = src.split('/').pop()?.replace(/\.(svg|png|jpe?g|webp)$/i, '');
      if (name && name.length > 1 && name.length < 60) seen.add(name);
    }
  });
  return [...seen];
}

export const customerLogosCurrentAdapter: Adapter<CustomerLogosCurrentPayload> = {
  name: 'customer.logos_current',
  module: 'customer',
  version: '0.1.0',
  estimatedCostInr: 0,
  requiredEnv: [],
  schema: CustomerLogosCurrentPayloadSchema,
  async run(ctx: AdapterContext): Promise<AdapterResult<CustomerLogosCurrentPayload>> {
    const t0 = Date.now();
    try {
      const customersPage = await findCustomersPage(ctx);
      if (!customersPage) {
        return {
          source: 'customer.logos_current',
          fetchedAt: new Date().toISOString(),
          status: 'empty',
          payload: { customersPageUrl: null, currentLogos: [] },
          costPaise: 0,
          durationMs: Date.now() - t0,
        };
      }
      const currentLogos = extractLogos(customersPage.html);
      return {
        source: 'customer.logos_current',
        fetchedAt: new Date().toISOString(),
        status: 'ok',
        payload: { customersPageUrl: customersPage.url, currentLogos },
        costPaise: 0,
        durationMs: Date.now() - t0,
      };
    } catch (err) {
      return {
        source: 'customer.logos_current',
        fetchedAt: new Date().toISOString(),
        status: 'error',
        payload: null,
        errors: [`logos_current: ${(err as Error).message}`],
        costPaise: 0,
        durationMs: Date.now() - t0,
      };
    }
  },
};
