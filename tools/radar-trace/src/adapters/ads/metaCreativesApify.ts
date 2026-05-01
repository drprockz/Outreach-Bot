/**
 * ads.meta_creatives_apify — Active Facebook/Instagram ad creatives via Apify.
 *
 * Actor: `curious_coder/facebook-ad-library-scraper`
 * (Chosen for comprehensive Meta Ad Library access including ad text, CTA,
 * landing URLs, targeting (age/gender/countries), and run duration.
 * Input: { keyword: companyName, country: 'IN', activeOnly: true, limit: 100 }.
 * Cost: ~$0.00075/result — $0.75 per 1,000 results.)
 *
 * NO URL discovery step: the Meta Ad Library is searchable by keyword (company name),
 * so we run the actor directly without a prior Serper lookup.
 *
 * The adapter computes `runningDays` = ceil((now - runningSinceDate) / 86400000)
 * when `runningSinceDate` is available and `runningDays` is null in the raw data.
 *
 * Cost: Apify only (N results × $0.00075 × ₹84).
 * estimatedCostInr is set at ₹15 (cheap per-result cost).
 *
 * Uses the factory pattern so tests can inject a fake ApifyClient.
 */
import { z } from 'zod';
import type { Adapter, AdapterContext, AdapterResult, Env } from '../../types.js';
import { createApifyClient, type ApifyClient } from '../../clients/apify.js';

export const AdsMetaCreativesApifyPayloadSchema = z.object({
  totalActiveAds: z.number(),
  creatives: z.array(
    z.object({
      adId: z.string(),
      pageName: z.string(),
      adText: z.string().nullable(),
      headline: z.string().nullable(),
      callToAction: z.string().nullable(),
      landingUrl: z.string().nullable(),
      mediaType: z.enum(['image', 'video', 'carousel']),
      mediaUrl: z.string().nullable(),
      targeting: z.object({
        countries: z.array(z.string()),
        ageMin: z.number().nullable(),
        ageMax: z.number().nullable(),
        gender: z.string().nullable(),
      }),
      runningSinceDate: z.string().nullable(),
      runningDays: z.number().nullable(),
    }),
  ),
});

export type AdsMetaCreativesApifyPayload = z.infer<typeof AdsMetaCreativesApifyPayloadSchema>;

// Raw shape from curious_coder/facebook-ad-library-scraper
interface RawMetaAd {
  id?: string;
  page_name?: string;
  ad_creative_body?: string;
  ad_creative_link_title?: string;
  ad_creative_link_description?: string;
  call_to_action_type?: string;
  ad_creative_link_url?: string;
  ad_snapshot_url?: string;
  ad_delivery_start_time?: string;
  ad_delivery_stop_time?: string | null;
  target_ages?: string | null;
  target_gender?: string | null;
  target_locations?: Array<{ name?: string }>;
  images?: string[];
  videos?: string[];
}

function parseTargetAges(
  targetAges: string | null | undefined,
): { ageMin: number | null; ageMax: number | null } {
  if (!targetAges) return { ageMin: null, ageMax: null };
  const match = /(\d+)-(\d+)/.exec(targetAges);
  if (!match) return { ageMin: null, ageMax: null };
  return { ageMin: parseInt(match[1]!, 10), ageMax: parseInt(match[2]!, 10) };
}

function computeRunningDays(startDate: string | undefined | null): number | null {
  if (!startDate) return null;
  const start = Date.parse(startDate);
  if (isNaN(start)) return null;
  return Math.ceil((Date.now() - start) / 86_400_000);
}

function detectMediaType(
  row: RawMetaAd,
): { mediaType: 'image' | 'video' | 'carousel'; mediaUrl: string | null } {
  if (row.videos && row.videos.length > 0) {
    return { mediaType: 'video', mediaUrl: row.videos[0] ?? null };
  }
  if (row.images && row.images.length > 1) {
    return { mediaType: 'carousel', mediaUrl: row.images[0] ?? null };
  }
  if (row.images && row.images.length === 1) {
    return { mediaType: 'image', mediaUrl: row.images[0] ?? null };
  }
  return { mediaType: 'image', mediaUrl: null };
}

function mapAd(row: RawMetaAd) {
  const { mediaType, mediaUrl } = detectMediaType(row);
  const { ageMin, ageMax } = parseTargetAges(row.target_ages);
  const countries = (row.target_locations ?? []).map((l) => l.name ?? '').filter(Boolean);
  const gender = row.target_gender ?? null;

  return {
    adId: row.id ?? '',
    pageName: row.page_name ?? '',
    adText: row.ad_creative_body ?? null,
    headline: row.ad_creative_link_title ?? null,
    callToAction: row.call_to_action_type ?? null,
    landingUrl: row.ad_creative_link_url ?? null,
    mediaType,
    mediaUrl,
    targeting: { countries, ageMin, ageMax, gender },
    runningSinceDate: row.ad_delivery_start_time ?? null,
    runningDays: computeRunningDays(row.ad_delivery_start_time),
  };
}

export function makeAdsMetaCreativesApifyAdapter(deps: {
  apify: (env: Env) => ApifyClient;
}): Adapter<AdsMetaCreativesApifyPayload> {
  const USD_INR_DEFAULT = 84;

  return {
    name: 'ads.meta_creatives_apify',
    module: 'ads',
    version: '0.1.0',
    estimatedCostInr: 15,
    requiredEnv: ['APIFY_TOKEN'],
    cacheTtlMs: 24 * 60 * 60 * 1000,
    schema: AdsMetaCreativesApifyPayloadSchema,

    async run(ctx: AdapterContext): Promise<AdapterResult<AdsMetaCreativesApifyPayload>> {
      const t0 = Date.now();
      let totalCostPaise = 0;

      try {
        const apify = deps.apify(ctx.env);

        const { items, costUsd } = await apify.runActor<RawMetaAd>({
          actor: 'curious_coder/facebook-ad-library-scraper',
          input: {
            keyword: ctx.input.name,
            country: 'IN',
            activeOnly: true,
            limit: 100,
          },
          costPerResultUsd: 0.00075,
          maxResults: 100,
          signal: ctx.signal,
        });

        const usdToInr = parseFloat(ctx.env.USD_INR_RATE ?? String(USD_INR_DEFAULT));
        totalCostPaise = Math.round(costUsd * usdToInr * 100);

        if (!items.length) {
          return {
            source: 'ads.meta_creatives_apify',
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
          source: 'ads.meta_creatives_apify',
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
          source: 'ads.meta_creatives_apify',
          fetchedAt: new Date().toISOString(),
          status: 'error',
          payload: null,
          errors: [`meta_creatives_apify: ${(err as Error).message}`],
          costPaise: totalCostPaise,
          durationMs: Date.now() - t0,
        };
      }
    },
  };
}

export const adsMetaCreativesApifyAdapter = makeAdsMetaCreativesApifyAdapter({
  apify: (env: Env) => createApifyClient({ token: env.APIFY_TOKEN ?? '' }),
});
