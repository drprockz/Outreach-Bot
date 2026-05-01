/**
 * directories.linkedin_company_apify — LinkedIn company page data via Apify.
 *
 * Actor: `dev_fusion/linkedin-company-scraper`
 * (Chosen over apify/linkedin-company-scraper for lower cost and active maintenance
 * as of May 2026. Input: { linkedinCompanyUrl, limit: 1 }. Cost: ~$0.005/result.)
 *
 * Two-step flow:
 *   1. SerperClient: site:linkedin.com/company/ "{name}" → first matching URL
 *   2. ApifyClient: run actor with that URL → structured company data
 *
 * Both env vars are required. If Serper returns no matching LinkedIn company URL,
 * the adapter returns status:'empty'. If Apify throws, status:'error'.
 *
 * Cost: Serper (~₹0.03) + Apify (1 result × $0.005 × ₹84 ≈ ₹0.42).
 * estimatedCostInr is set conservatively at ₹50 to cover edge-case retry cost.
 *
 * Uses the factory pattern so tests can inject fake Serper + Apify clients.
 */
import { z } from 'zod';
import type { Adapter, AdapterContext, AdapterResult, Env } from '../../types.js';
import { createSerperClient, type SerperClient } from '../../clients/serper.js';
import { createApifyClient, type ApifyClient } from '../../clients/apify.js';

export const LinkedinCompanyApifyPayloadSchema = z.object({
  linkedinCompanyUrl: z.string().url().nullable(),
  name: z.string().nullable(),
  industry: z.string().nullable(),
  description: z.string().nullable(),
  employeeCountVerified: z.string().nullable(),
  headquarters: z.string().nullable(),
  founded: z.number().nullable(),
  specialties: z.array(z.string()),
  followerCount: z.number().nullable(),
});

export type LinkedinCompanyApifyPayload = z.infer<typeof LinkedinCompanyApifyPayloadSchema>;

const LINKEDIN_COMPANY_RE = /^https:\/\/(www\.)?linkedin\.com\/company\/[^/?#]+\/?$/;

// Matches the raw object from dev_fusion/linkedin-company-scraper
interface RawCompanyRow {
  name?: string;
  url?: string;
  industry?: string;
  description?: string;
  staffCount?: number;
  staffCountRange?: string;
  headquarter?: { city?: string; geographicArea?: string; country?: string };
  foundedOn?: { year?: number };
  specialities?: string[];
  followersCount?: number;
}

function mapRow(row: RawCompanyRow, linkedinCompanyUrl: string): LinkedinCompanyApifyPayload {
  const hq = row.headquarter;
  const headquarters = hq
    ? [hq.city, hq.geographicArea, hq.country].filter(Boolean).join(', ') || null
    : null;

  return {
    linkedinCompanyUrl,
    name: row.name ?? null,
    industry: row.industry ?? null,
    description: row.description ?? null,
    employeeCountVerified: row.staffCountRange ?? (row.staffCount ? String(row.staffCount) : null),
    headquarters,
    founded: row.foundedOn?.year ?? null,
    specialties: row.specialities ?? [],
    followerCount: row.followersCount ?? null,
  };
}

export function makeLinkedinCompanyApifyAdapter(deps: {
  serper: (env: Env) => SerperClient;
  apify: (env: Env) => ApifyClient;
}): Adapter<LinkedinCompanyApifyPayload> {
  const USD_INR_DEFAULT = 84;

  return {
    name: 'directories.linkedin_company_apify',
    module: 'directories',
    version: '0.1.0',
    estimatedCostInr: 50,
    requiredEnv: ['SERPER_API_KEY', 'APIFY_TOKEN'],
    cacheTtlMs: 7 * 86_400_000,
    schema: LinkedinCompanyApifyPayloadSchema,

    async run(ctx: AdapterContext): Promise<AdapterResult<LinkedinCompanyApifyPayload>> {
      const t0 = Date.now();
      let totalCostPaise = 0;

      try {
        const serper = deps.serper(ctx.env);
        const apify = deps.apify(ctx.env);

        // Step 1: Discover LinkedIn company URL via Serper
        const q = `site:linkedin.com/company/ "${ctx.input.name}"`;
        const { organic, costPaise: serperCost } = await serper.search({ q, signal: ctx.signal });
        totalCostPaise += serperCost;

        const linkedinUrl = organic
          .map((r) => r.link)
          .find((link) => LINKEDIN_COMPANY_RE.test(link));

        if (!linkedinUrl) {
          return {
            source: 'directories.linkedin_company_apify',
            fetchedAt: new Date().toISOString(),
            status: 'empty',
            payload: null,
            costPaise: totalCostPaise,
            durationMs: Date.now() - t0,
          };
        }

        // Step 2: Run Apify actor with company URL
        const { items, costUsd, truncated } = await apify.runActor<RawCompanyRow>({
          actor: 'dev_fusion/linkedin-company-scraper',
          input: { linkedinCompanyUrl: linkedinUrl, limit: 1 },
          costPerResultUsd: 0.005,
          maxResults: 1,
          signal: ctx.signal,
        });

        const usdToInr = parseFloat(ctx.env.USD_INR_RATE ?? String(USD_INR_DEFAULT));
        const apifyCostPaise = Math.round(costUsd * usdToInr * 100);
        totalCostPaise += apifyCostPaise;

        if (!items.length) {
          return {
            source: 'directories.linkedin_company_apify',
            fetchedAt: new Date().toISOString(),
            status: 'empty',
            payload: null,
            costPaise: totalCostPaise,
            durationMs: Date.now() - t0,
            costMeta: { apifyResults: 0, costUsd },
          };
        }

        const payload = mapRow(items[0]!, linkedinUrl);

        return {
          source: 'directories.linkedin_company_apify',
          fetchedAt: new Date().toISOString(),
          status: 'ok',
          payload,
          costPaise: totalCostPaise,
          durationMs: Date.now() - t0,
          costMeta: {
            apifyResults: items.length,
            costUsd,
          },
          ...(truncated && { errors: ['apify result truncated at maxResults'] }),
        };
      } catch (err) {
        return {
          source: 'directories.linkedin_company_apify',
          fetchedAt: new Date().toISOString(),
          status: 'error',
          payload: null,
          errors: [`linkedin_company_apify: ${(err as Error).message}`],
          costPaise: totalCostPaise,
          durationMs: Date.now() - t0,
        };
      }
    },
  };
}

export const linkedinCompanyApifyAdapter = makeLinkedinCompanyApifyAdapter({
  serper: (env: Env) => createSerperClient({ apiKey: env.SERPER_API_KEY ?? '' }),
  apify: (env: Env) => createApifyClient({ token: env.APIFY_TOKEN ?? '' }),
});
