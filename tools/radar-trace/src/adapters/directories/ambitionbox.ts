/**
 * directories.ambitionbox — AmbitionBox Indian employer review scraper.
 *
 * Scrapes https://www.ambitionbox.com/overview/{slug}-overview for company
 * rating, review count, basic info, and category-level ratings.
 *
 * Slug discovery:
 *   1. Try name.toLowerCase().replace(/\s+/g, '-')
 *   2. If 404, append '-1' suffix (AmbitionBox uses numeric suffixes for duplicates)
 *   3. If still 404 → status:'empty'
 *
 * AmbitionBox may require JS rendering for full data. The HTML scrape below
 * targets server-rendered meta content and visible class selectors; missing
 * fields are returned as null rather than failing the adapter.
 *
 * Cache: 3 days (review counts move slowly).
 */
import { z } from 'zod';
import * as cheerio from 'cheerio';
import type { Adapter, AdapterContext, AdapterResult } from '../../types.js';

export const AmbitionBoxPayloadSchema = z.object({
  ambitionboxUrl: z.string().url().nullable(),
  rating: z.number().nullable(),
  reviewCount: z.number().nullable(),
  industry: z.string().nullable(),
  employeeCount: z.string().nullable(),
  headquarters: z.string().nullable(),
  yearFounded: z.number().nullable(),
  ceoName: z.string().nullable(),
  ratings: z.object({
    salaryAndBenefits: z.number().nullable(),
    workLifeBalance: z.number().nullable(),
    cultureAndValues: z.number().nullable(),
    careerGrowth: z.number().nullable(),
  }),
});

export type AmbitionBoxPayload = z.infer<typeof AmbitionBoxPayloadSchema>;

function makeSlug(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

function parseFloat2(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = parseFloat(raw.trim());
  return isNaN(n) ? null : n;
}

function parseInt2(raw: string | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^0-9]/g, '');
  const n = parseInt(cleaned, 10);
  return isNaN(n) ? null : n;
}

export function parseAmbitionBoxPage(html: string, url: string): AmbitionBoxPayload {
  const $ = cheerio.load(html);

  // Overall rating
  const rating = parseFloat2($('.companyOverview__overallRating').first().text());

  // Review count — "1,248 Reviews"
  const reviewCountRaw = $('.companyOverview__reviewsCount').first().text();
  const reviewCount = parseInt2(reviewCountRaw);

  // Detail items — label/value pairs
  let industry: string | null = null;
  let employeeCount: string | null = null;
  let headquarters: string | null = null;
  let yearFounded: number | null = null;
  let ceoName: string | null = null;

  $('.companyOverview__detailsItem').each((_, el) => {
    const label = $(el).find('.companyOverview__detailsLabel').text().trim().toLowerCase();
    const value = $(el).find('.companyOverview__detailsValue').text().trim();
    if (!value) return;
    if (/industry/.test(label)) industry = value;
    else if (/employees?/.test(label)) employeeCount = value;
    else if (/headquarters?|location/.test(label)) headquarters = value;
    else if (/founded/.test(label)) yearFounded = parseInt2(value);
    else if (/ceo/.test(label)) ceoName = value;
  });

  // Category ratings
  let salaryAndBenefits: number | null = null;
  let workLifeBalance: number | null = null;
  let cultureAndValues: number | null = null;
  let careerGrowth: number | null = null;

  $('.ratingDetails__item').each((_, el) => {
    const label = $(el).find('.ratingDetails__label').text().trim().toLowerCase();
    const val = parseFloat2($(el).find('.ratingDetails__rating').text().trim());
    if (/salary/.test(label)) salaryAndBenefits = val;
    else if (/work.?life/.test(label)) workLifeBalance = val;
    else if (/culture/.test(label)) cultureAndValues = val;
    else if (/career/.test(label)) careerGrowth = val;
  });

  return {
    ambitionboxUrl: url,
    rating,
    reviewCount,
    industry,
    employeeCount,
    headquarters,
    yearFounded,
    ceoName,
    ratings: { salaryAndBenefits, workLifeBalance, cultureAndValues, careerGrowth },
  };
}

async function tryFetch(
  http: typeof fetch,
  url: string,
  signal: AbortSignal,
): Promise<{ html: string; resolvedUrl: string } | null> {
  const res = await http(url, {
    signal,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; radar-trace/1.0)' },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { html: await res.text(), resolvedUrl: url };
}

export const ambitionboxAdapter: Adapter<AmbitionBoxPayload> = {
  name: 'directories.ambitionbox',
  module: 'directories',
  version: '0.1.0',
  estimatedCostInr: 0,
  requiredEnv: [],
  cacheTtlMs: 3 * 86_400_000,
  schema: AmbitionBoxPayloadSchema,

  async run(ctx: AdapterContext): Promise<AdapterResult<AmbitionBoxPayload>> {
    const t0 = Date.now();
    const slug = makeSlug(ctx.input.name);

    try {
      const primary = `https://www.ambitionbox.com/overview/${slug}-overview`;
      const fallback = `https://www.ambitionbox.com/overview/${slug}-1-overview`;

      let fetched = await tryFetch(ctx.http, primary, ctx.signal);
      if (!fetched) {
        fetched = await tryFetch(ctx.http, fallback, ctx.signal);
      }

      if (!fetched) {
        return {
          source: 'directories.ambitionbox',
          fetchedAt: new Date().toISOString(),
          status: 'empty',
          payload: null,
          costPaise: 0,
          durationMs: Date.now() - t0,
        };
      }

      const payload = parseAmbitionBoxPage(fetched.html, fetched.resolvedUrl);
      const hasData = payload.rating !== null || payload.reviewCount !== null || payload.industry;

      return {
        source: 'directories.ambitionbox',
        fetchedAt: new Date().toISOString(),
        status: hasData ? 'ok' : 'empty',
        payload,
        costPaise: 0,
        durationMs: Date.now() - t0,
      };
    } catch (err) {
      return {
        source: 'directories.ambitionbox',
        fetchedAt: new Date().toISOString(),
        status: 'error',
        payload: null,
        errors: [`ambitionbox: ${(err as Error).message}`],
        costPaise: 0,
        durationMs: Date.now() - t0,
      };
    }
  },
};
