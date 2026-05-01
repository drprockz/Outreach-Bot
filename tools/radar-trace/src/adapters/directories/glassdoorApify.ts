/**
 * directories.glassdoor_apify — Glassdoor company data via Apify.
 *
 * GATED (Wave 2): only runs when `directories.zaubacorp` does NOT report
 * country='India'. For Indian companies, AmbitionBox covers employer reviews
 * better. Glassdoor is more useful for global/US-headquartered targets.
 *
 * Gate: zaubacorp.status === 'ok' AND payload.country !== 'India'.
 * Falls through to false if zaubacorp errored (zaubacorp returns country='India'
 * by convention, so status:'error' means we don't have confirmation — skip).
 *
 * Actor: `bebity/glassdoor-scraper`
 * (Chosen for active maintenance, company search support, and structured output.
 * Input: { companyName, maxReviews: 0 } — we request metadata, not full reviews.
 * Cost: ~$0.005/result.)
 *
 * Output: ratings, review counts, CEO rating, pros/cons (top 3 each),
 * recent interview summary.
 *
 * Uses the factory pattern with DI'd ApifyClient so tests can inject a fake.
 */
import { z } from 'zod';
import type { Adapter, AdapterContext, AdapterResult, Env, PartialDossier } from '../../types.js';
import { createApifyClient, type ApifyClient } from '../../clients/apify.js';

export const GlassdoorApifyPayloadSchema = z.object({
  glassdoorUrl: z.string().url().nullable(),
  rating: z.number().nullable(),
  reviewCount: z.number().nullable(),
  ceoRating: z.number().nullable(),
  recentInterviewSummary: z.string().nullable(),
  pros: z.array(z.string()),
  cons: z.array(z.string()),
});

export type GlassdoorApifyPayload = z.infer<typeof GlassdoorApifyPayloadSchema>;

// Raw shape returned by bebity/glassdoor-scraper
interface RawGlassdoorRow {
  url?: string;
  ratings?: {
    overallRating?: number;
    ceoRating?: number;
  };
  numberOfRatings?: number;
  pros?: string[];
  cons?: string[];
  interviewExperience?: string;
  interviewDifficulty?: string;
}

function mapRow(row: RawGlassdoorRow): GlassdoorApifyPayload {
  const interviewSummary = row.interviewExperience
    ? `${row.interviewExperience}${row.interviewDifficulty ? ` (${row.interviewDifficulty})` : ''}`
    : null;

  return {
    glassdoorUrl: row.url ?? null,
    rating: row.ratings?.overallRating ?? null,
    reviewCount: row.numberOfRatings ?? null,
    ceoRating: row.ratings?.ceoRating ?? null,
    recentInterviewSummary: interviewSummary,
    pros: (row.pros ?? []).slice(0, 3),
    cons: (row.cons ?? []).slice(0, 3),
  };
}

export function makeGlassdoorApifyAdapter(deps: {
  apify: (env: Env) => ApifyClient;
}): Adapter<GlassdoorApifyPayload> {
  const USD_INR_DEFAULT = 84;

  return {
    name: 'directories.glassdoor_apify',
    module: 'directories',
    version: '0.1.0',
    estimatedCostInr: 100,
    requiredEnv: ['APIFY_TOKEN'],
    cacheTtlMs: 7 * 86_400_000,
    schema: GlassdoorApifyPayloadSchema,

    gate(partial: PartialDossier): boolean {
      const zauba = partial['directories.zaubacorp'];
      if (!zauba || zauba.status !== 'ok' || !zauba.payload) return false;
      const payload = zauba.payload as { country?: string };
      // If country is 'India', skip — AmbitionBox covers it; Glassdoor is for global targets.
      return payload.country !== 'India';
    },

    async run(ctx: AdapterContext): Promise<AdapterResult<GlassdoorApifyPayload>> {
      const t0 = Date.now();
      let totalCostPaise = 0;

      try {
        const apify = deps.apify(ctx.env);

        const { items, costUsd } = await apify.runActor<RawGlassdoorRow>({
          actor: 'bebity/glassdoor-scraper',
          input: { companyName: ctx.input.name, maxReviews: 0 },
          costPerResultUsd: 0.005,
          maxResults: 1,
          signal: ctx.signal,
        });

        const usdToInr = parseFloat(ctx.env.USD_INR_RATE ?? String(USD_INR_DEFAULT));
        totalCostPaise = Math.round(costUsd * usdToInr * 100);

        if (!items.length) {
          return {
            source: 'directories.glassdoor_apify',
            fetchedAt: new Date().toISOString(),
            status: 'empty',
            payload: null,
            costPaise: totalCostPaise,
            durationMs: Date.now() - t0,
            costMeta: { apifyResults: 0, costUsd },
          };
        }

        const payload = mapRow(items[0]!);

        return {
          source: 'directories.glassdoor_apify',
          fetchedAt: new Date().toISOString(),
          status: 'ok',
          payload,
          costPaise: totalCostPaise,
          durationMs: Date.now() - t0,
          costMeta: {
            apifyResults: items.length,
            costUsd,
          },
        };
      } catch (err) {
        return {
          source: 'directories.glassdoor_apify',
          fetchedAt: new Date().toISOString(),
          status: 'error',
          payload: null,
          errors: [`glassdoor_apify: ${(err as Error).message}`],
          costPaise: totalCostPaise,
          durationMs: Date.now() - t0,
        };
      }
    },
  };
}

export const glassdoorApifyAdapter = makeGlassdoorApifyAdapter({
  apify: (env: Env) => createApifyClient({ token: env.APIFY_TOKEN ?? '' }),
});
