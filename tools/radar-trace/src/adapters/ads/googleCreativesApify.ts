/**
 * ads.google_creatives_apify — Active Google Ads creatives via Apify.
 *
 * Actor: `silva95gustavo/google-ads-scraper`
 * (Chosen for Google Ads Transparency Center scraping support.
 * Input: { domain, region: 'anywhere' }. Cost: ~$0.001/result — estimate;
 * Google Ads Transparency has variable result density per domain.)
 *
 * NO URL discovery step: the Google Ads Transparency Center is searchable by
 * domain, so we run the actor directly with `ctx.input.domain`.
 *
 * Note: Google Ads Transparency does NOT expose age/gender targeting data
 * (unlike Meta Ad Library), so targeting is limited to countries.
 *
 * Cost: Apify only (N results × $0.001 × ₹84).
 * estimatedCostInr is set at ₹50 (conservative at ~60 ads/run).
 *
 * Uses the factory pattern so tests can inject a fake ApifyClient.
 */
import { z } from 'zod';
import type { Adapter, AdapterContext, AdapterResult, Env } from '../../types.js';
import { createApifyClient, type ApifyClient } from '../../clients/apify.js';

export const AdsGoogleCreativesApifyPayloadSchema = z.object({
  totalActiveAds: z.number(),
  creatives: z.array(
    z.object({
      adId: z.string(),
      advertiser: z.string(),
      adType: z.enum(['text', 'image', 'video']),
      adText: z.string().nullable(),
      landingUrl: z.string().nullable(),
      targetCountries: z.array(z.string()),
      firstShown: z.string().nullable(),
      lastShown: z.string().nullable(),
    }),
  ),
});

export type AdsGoogleCreativesApifyPayload = z.infer<typeof AdsGoogleCreativesApifyPayloadSchema>;

// Raw shape from silva95gustavo/google-ads-scraper
interface RawGoogleAd {
  advertiser_id?: string;
  advertiser_name?: string;
  creative_id?: string;
  ad_type?: string;
  ad_title?: string | null;
  ad_description?: string | null;
  destination_url?: string | null;
  region_codes?: string[];
  first_shown_date?: string | null;
  last_shown_date?: string | null;
  is_active?: boolean;
}

function normalizeAdType(raw: string | undefined): 'text' | 'image' | 'video' {
  const t = (raw ?? '').toUpperCase();
  if (t === 'IMAGE') return 'image';
  if (t === 'VIDEO') return 'video';
  return 'text';
}

function buildAdText(row: RawGoogleAd): string | null {
  const parts = [row.ad_title, row.ad_description].filter(Boolean);
  return parts.length > 0 ? parts.join(' — ') : null;
}

function mapAd(row: RawGoogleAd) {
  return {
    adId: row.creative_id ?? row.advertiser_id ?? '',
    advertiser: row.advertiser_name ?? '',
    adType: normalizeAdType(row.ad_type),
    adText: buildAdText(row),
    landingUrl: row.destination_url ?? null,
    targetCountries: row.region_codes ?? [],
    firstShown: row.first_shown_date ?? null,
    lastShown: row.last_shown_date ?? null,
  };
}

export function makeAdsGoogleCreativesApifyAdapter(deps: {
  apify: (env: Env) => ApifyClient;
}): Adapter<AdsGoogleCreativesApifyPayload> {
  const USD_INR_DEFAULT = 84;

  return {
    name: 'ads.google_creatives_apify',
    module: 'ads',
    version: '0.1.0',
    estimatedCostInr: 50,
    requiredEnv: ['APIFY_TOKEN'],
    cacheTtlMs: 24 * 60 * 60 * 1000,
    schema: AdsGoogleCreativesApifyPayloadSchema,

    async run(ctx: AdapterContext): Promise<AdapterResult<AdsGoogleCreativesApifyPayload>> {
      const t0 = Date.now();
      let totalCostPaise = 0;

      try {
        const apify = deps.apify(ctx.env);

        const { items, costUsd } = await apify.runActor<RawGoogleAd>({
          actor: 'silva95gustavo/google-ads-scraper',
          input: { domain: ctx.input.domain, region: 'anywhere' },
          costPerResultUsd: 0.001,
          maxResults: 100,
          signal: ctx.signal,
        });

        const usdToInr = parseFloat(ctx.env.USD_INR_RATE ?? String(USD_INR_DEFAULT));
        totalCostPaise = Math.round(costUsd * usdToInr * 100);

        if (!items.length) {
          return {
            source: 'ads.google_creatives_apify',
            fetchedAt: new Date().toISOString(),
            status: 'empty',
            payload: null,
            costPaise: totalCostPaise,
            durationMs: Date.now() - t0,
            costMeta: { apifyResults: 0, costUsd },
          };
        }

        const creatives = items.map(mapAd);

        return {
          source: 'ads.google_creatives_apify',
          fetchedAt: new Date().toISOString(),
          status: 'ok',
          payload: {
            totalActiveAds: creatives.length,
            creatives,
          },
          costPaise: totalCostPaise,
          durationMs: Date.now() - t0,
          costMeta: {
            apifyResults: items.length,
            costUsd,
          },
        };
      } catch (err) {
        return {
          source: 'ads.google_creatives_apify',
          fetchedAt: new Date().toISOString(),
          status: 'error',
          payload: null,
          errors: [`google_creatives_apify: ${(err as Error).message}`],
          costPaise: totalCostPaise,
          durationMs: Date.now() - t0,
        };
      }
    },
  };
}

export const adsGoogleCreativesApifyAdapter = makeAdsGoogleCreativesApifyAdapter({
  apify: (env: Env) => createApifyClient({ token: env.APIFY_TOKEN ?? '' }),
});
