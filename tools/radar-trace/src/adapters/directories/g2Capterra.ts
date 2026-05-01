/**
 * directories.g2_capterra — G2 + Capterra product listing scraper.
 *
 * GATED (Wave 2): only runs when `operational.tech_stack` detects ≥2 B2B SaaS
 * tech markers (payments, cdp, crm, auth, monitoring). This signals the company
 * is likely selling a product-on-the-web, making G2/Capterra listings relevant.
 *
 * Scrapes:
 *   - https://www.g2.com/search?query={name}
 *   - https://www.capterra.com/search/?q={name}
 *
 * Returns first product URL + rating + review count + category for each.
 * If neither finds a match → status:'empty'.
 *
 * Note: G2 and Capterra have bot detection. On production traffic you may see
 * 403s; the adapter gracefully returns partial data (one source may succeed).
 */
import { z } from 'zod';
import * as cheerio from 'cheerio';
import type { Adapter, AdapterContext, AdapterResult, PartialDossier } from '../../types.js';

const ListingSchema = z.object({
  url: z.string().url().nullable(),
  rating: z.number().nullable(),
  reviewCount: z.number().nullable(),
  category: z.string().nullable(),
});

export const G2CapterraPayloadSchema = z.object({
  g2: ListingSchema.nullable(),
  capterra: ListingSchema.nullable(),
});

export type G2CapterraPayload = z.infer<typeof G2CapterraPayloadSchema>;

type Listing = z.infer<typeof ListingSchema>;

function parseFloat2(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = parseFloat(raw.trim().replace(',', '.'));
  return isNaN(n) ? null : n;
}

function parseInt2(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = parseInt(raw.replace(/[^0-9]/g, ''), 10);
  return isNaN(n) ? null : n;
}

export function parseG2SearchPage(html: string): Listing | null {
  const $ = cheerio.load(html);

  // G2 search results: product cards have data attributes or specific class patterns
  // Selectors: '.product-listing' or '[data-track-product-type]' with link, rating
  const card = $(
    '.product-listing, [data-track-product-type], .js-listingProduct, .product-card',
  ).first();

  if (!card.length) return null;

  // URL from first product link
  const rawUrl = card.find('a[href*="/products/"]').first().attr('href')
    || card.find('a[href*="g2.com/products/"]').first().attr('href')
    || card.find('a').first().attr('href');

  if (!rawUrl) return null;
  const url = rawUrl.startsWith('http') ? rawUrl : `https://www.g2.com${rawUrl}`;

  const rating = parseFloat2(
    card.find('[data-testid="rating"], .fw-semibold, .rating-value').first().text(),
  );
  const reviewCount = parseInt2(
    card.find('[data-testid="review-count"], .rating-count, .reviews-count').first().text(),
  );
  const category = card.find('.category, [data-category]').first().text().trim() || null;

  return { url, rating, reviewCount, category };
}

export function parseCapterraSearchPage(html: string): Listing | null {
  const $ = cheerio.load(html);

  // Capterra search results: product cards typically have class 'app-listing' or similar
  const card = $(
    '.app-listing, .search-listing, [data-app-name], .product-card, .listing-item',
  ).first();

  if (!card.length) return null;

  const rawUrl = card.find('a[href*="/software/"]').first().attr('href')
    || card.find('a[href*="capterra.com/software/"]').first().attr('href')
    || card.find('a').first().attr('href');

  if (!rawUrl) return null;
  const url = rawUrl.startsWith('http') ? rawUrl : `https://www.capterra.com${rawUrl}`;

  const rating = parseFloat2(
    card.find('.rating, .star-rating, [data-rating], .avg-rating').first().text(),
  );
  const reviewCount = parseInt2(
    card.find('.review-count, [data-review-count], .reviews').first().text(),
  );
  const category = card.find('.category, [data-category]').first().text().trim() || null;

  return { url, rating, reviewCount, category };
}

const SAAS_MARKERS = ['payments', 'cdp', 'crm', 'auth', 'monitoring'] as const;

export const g2CapterraAdapter: Adapter<G2CapterraPayload> = {
  name: 'directories.g2_capterra',
  module: 'directories',
  version: '0.1.0',
  estimatedCostInr: 0,
  requiredEnv: [],
  cacheTtlMs: 3 * 86_400_000,
  schema: G2CapterraPayloadSchema,

  gate(partial: PartialDossier): boolean {
    const techStack = partial['operational.tech_stack'];
    if (!techStack || techStack.status !== 'ok' || !techStack.payload) return false;
    const payload = techStack.payload as { techStack?: Array<{ category: string }> };
    const categories = new Set((payload.techStack ?? []).map((t) => t.category));
    const matchCount = SAAS_MARKERS.filter((m) => categories.has(m)).length;
    return matchCount >= 2;
  },

  async run(ctx: AdapterContext): Promise<AdapterResult<G2CapterraPayload>> {
    const t0 = Date.now();

    try {
      const name = encodeURIComponent(ctx.input.name);
      const [g2Res, capterraRes] = await Promise.allSettled([
        ctx.http(`https://www.g2.com/search?query=${name}`, { signal: ctx.signal }),
        ctx.http(`https://www.capterra.com/search/?q=${name}`, { signal: ctx.signal }),
      ]);

      let g2: Listing | null = null;
      let capterra: Listing | null = null;

      if (g2Res.status === 'fulfilled' && g2Res.value.ok) {
        const html = await g2Res.value.text();
        g2 = parseG2SearchPage(html);
      }

      if (capterraRes.status === 'fulfilled' && capterraRes.value.ok) {
        const html = await capterraRes.value.text();
        capterra = parseCapterraSearchPage(html);
      }

      const hasAny = g2 !== null || capterra !== null;

      return {
        source: 'directories.g2_capterra',
        fetchedAt: new Date().toISOString(),
        status: hasAny ? 'ok' : 'empty',
        payload: { g2, capterra },
        costPaise: 0,
        durationMs: Date.now() - t0,
      };
    } catch (err) {
      return {
        source: 'directories.g2_capterra',
        fetchedAt: new Date().toISOString(),
        status: 'error',
        payload: null,
        errors: [`g2_capterra: ${(err as Error).message}`],
        costPaise: 0,
        durationMs: Date.now() - t0,
      };
    }
  },
};
