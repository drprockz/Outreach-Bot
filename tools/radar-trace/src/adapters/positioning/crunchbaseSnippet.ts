import { z } from 'zod';
import type { Adapter, AdapterContext, AdapterResult, Env } from '../../types.js';
import { createSerperClient, type SerperClient } from '../../clients/serper.js';

export const PositioningCrunchbaseSnippetPayloadSchema = z.object({
  crunchbaseUrl: z.string().url().nullable(),
  snippet: z.string().nullable(),
  fundingHint: z.string().nullable(),
});

export type PositioningCrunchbaseSnippetPayload = z.infer<typeof PositioningCrunchbaseSnippetPayloadSchema>;

const CRUNCHBASE_RE = /^https:\/\/(www\.)?crunchbase\.com\//;
const FUNDING_HINT_RE = /raised \$[\d.,]+[mMbBkK]?|series [a-e]|seed round|\$[\d.,]+[mMbBkK] (round|funding|raised)|angel round/i;

export function makePositioningCrunchbaseSnippetAdapter(
  serperFactory: (env: Env) => SerperClient,
): Adapter<PositioningCrunchbaseSnippetPayload> {
  return {
    name: 'positioning.crunchbase_snippet',
    module: 'positioning',
    version: '0.2.0',
    estimatedCostInr: 0.03,
    requiredEnv: ['SERPER_API_KEY'],
    schema: PositioningCrunchbaseSnippetPayloadSchema,
    async run(ctx: AdapterContext): Promise<AdapterResult<PositioningCrunchbaseSnippetPayload>> {
      const t0 = Date.now();
      try {
        // Anchor-first: if the company website links to its Crunchbase page,
        // skip the Serper search — without this gate, "Simple Inc" returned
        // "Pure and Simple, Inc." (estate sale planning) as the top hit.
        if (ctx.anchors.crunchbaseUrl) {
          return {
            source: 'positioning.crunchbase_snippet',
            fetchedAt: new Date().toISOString(),
            status: 'ok',
            payload: {
              crunchbaseUrl: ctx.anchors.crunchbaseUrl,
              // Snippet/funding hint are populated only via the Serper SERP
              // path. Anchor mode prefers correctness over richness — use
              // the dedicated Crunchbase API/scraper to enrich if needed.
              snippet: null,
              fundingHint: null,
            },
            costPaise: 0,
            durationMs: Date.now() - t0,
            verification: { method: 'anchor', confidence: 1, reason: 'crunchbaseUrl from company website' },
          };
        }

        const serper = serperFactory(ctx.env);
        const q = `site:crunchbase.com "${ctx.input.name}"`;
        const { organic, costPaise } = await serper.search({ q, signal: ctx.signal });

        const crunchbaseHit = organic.find((r) => CRUNCHBASE_RE.test(r.link));
        if (!crunchbaseHit) {
          return {
            source: 'positioning.crunchbase_snippet',
            fetchedAt: new Date().toISOString(),
            status: 'empty',
            payload: { crunchbaseUrl: null, snippet: null, fundingHint: null },
            costPaise,
            durationMs: Date.now() - t0,
            verification: { method: 'none', confidence: 0, reason: 'no candidates' },
          };
        }

        const snippet = crunchbaseHit.snippet?.slice(0, 300) ?? null;
        const fundingMatch = snippet ? FUNDING_HINT_RE.exec(snippet) : null;
        const fundingHint = fundingMatch ? fundingMatch[0] : null;

        return {
          source: 'positioning.crunchbase_snippet',
          fetchedAt: new Date().toISOString(),
          status: 'ok',
          payload: {
            crunchbaseUrl: crunchbaseHit.link,
            snippet,
            fundingHint,
          },
          costPaise,
          durationMs: Date.now() - t0,
          // Without an anchor we can't disambiguate by domain. Mark unverified
          // so downstream consumers know not to trust this without a manual check.
          verification: { method: 'none', confidence: 0.4, reason: 'serper name search (unverified)' },
        };
      } catch (err) {
        return {
          source: 'positioning.crunchbase_snippet',
          fetchedAt: new Date().toISOString(),
          status: 'error',
          payload: null,
          errors: [`crunchbase_snippet: ${(err as Error).message}`],
          costPaise: 0,
          durationMs: Date.now() - t0,
        };
      }
    },
  };
}

export const positioningCrunchbaseSnippetAdapter = makePositioningCrunchbaseSnippetAdapter(
  (env: Env) => createSerperClient({ apiKey: env.SERPER_API_KEY ?? '' }),
);
