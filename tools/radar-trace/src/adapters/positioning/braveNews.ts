import { z } from 'zod';
import type { Adapter, AdapterContext, AdapterResult, Env } from '../../types.js';
import { createBraveClient, type BraveClient } from '../../clients/brave.js';
import {
  createVerifierClient,
  DEFAULT_MATCH_THRESHOLD,
  type VerifierClient,
} from '../../lib/ai/verifier.js';

export const PositioningBraveNewsPayloadSchema = z.object({
  results: z.array(z.object({
    title: z.string(),
    url: z.string().url(),
    description: z.string(),
    source: z.string(),
    publishedAt: z.string().nullable(),
  })),
});

export type PositioningBraveNewsPayload = z.infer<typeof PositioningBraveNewsPayloadSchema>;

export function makePositioningBraveNewsAdapter(
  braveFactory: (env: Env) => BraveClient,
  verifierFactory: (env: Env) => VerifierClient = (env) => createVerifierClient(env),
): Adapter<PositioningBraveNewsPayload> {
  return {
    name: 'positioning.brave_news',
    module: 'positioning',
    version: '0.2.0',
    estimatedCostInr: 1.0,
    requiredEnv: ['BRAVE_API_KEY'],
    schema: PositioningBraveNewsPayloadSchema,
    async run(ctx: AdapterContext): Promise<AdapterResult<PositioningBraveNewsPayload>> {
      const t0 = Date.now();
      try {
        const brave = braveFactory(ctx.env);
        const q = `"${ctx.input.name}" ${ctx.input.domain}`;
        const { results: braveResults, costPaise } = await brave.newsSearch({
          q,
          count: 10,
          signal: ctx.signal,
        });

        const allResults = braveResults.map((r, i) => ({
          id: String(i),
          title: r.title,
          url: r.url,
          description: r.description,
          source: r.profile?.name ?? new URL(r.url).hostname,
          publishedAt: r.page_age || r.age || null,
        }));

        let kept = allResults;
        let verifyCostUsd = 0;
        let dropped = 0;
        let method: 'llm' | 'none' = 'none';
        if (allResults.length > 0 && ctx.env.ANTHROPIC_API_KEY) {
          try {
            const verifier = verifierFactory(ctx.env);
            const { verdicts, costUsd } = await verifier.verifyBatch({
              target: {
                name: ctx.input.name,
                domain: ctx.input.domain,
                description: ctx.anchors.companyDescription,
                founder: ctx.input.founder ?? ctx.anchors.founders[0]?.name ?? null,
              },
              candidates: allResults.map((r) => ({
                id: r.id,
                title: r.title,
                snippet: r.description,
                url: r.url,
              })),
              candidateKind: 'news',
              signal: ctx.signal,
            });
            verifyCostUsd = costUsd;
            const verdictById = new Map(verdicts.map((v) => [v.id, v]));
            kept = allResults.filter((r) => {
              const v = verdictById.get(r.id);
              return v ? v.match && v.confidence >= DEFAULT_MATCH_THRESHOLD : false;
            });
            dropped = allResults.length - kept.length;
            method = 'llm';
          } catch (err) {
            ctx.logger.warn('brave_news: verifier failed, returning unverified results', {
              error: (err as Error).message,
            });
          }
        }

        const results = kept.map(({ id: _id, ...rest }) => rest);
        const verifyPaise = Math.round(verifyCostUsd * 84 * 100);

        return {
          source: 'positioning.brave_news',
          fetchedAt: new Date().toISOString(),
          status: results.length > 0 ? 'ok' : 'empty',
          payload: { results },
          costPaise: costPaise + verifyPaise,
          durationMs: Date.now() - t0,
          verification: {
            method,
            confidence: method === 'llm' ? 1 : 0.4,
            reason: method === 'llm'
              ? `verified ${results.length}/${allResults.length} candidates`
              : 'unverified (no ANTHROPIC_API_KEY)',
            costUsd: verifyCostUsd,
            droppedCandidates: dropped,
          },
        };
      } catch (err) {
        return {
          source: 'positioning.brave_news',
          fetchedAt: new Date().toISOString(),
          status: 'error',
          payload: null,
          errors: [`brave_news: ${(err as Error).message}`],
          costPaise: 0,
          durationMs: Date.now() - t0,
        };
      }
    },
  };
}

export const positioningBraveNewsAdapter = makePositioningBraveNewsAdapter(
  (env: Env) => createBraveClient({ apiKey: env.BRAVE_API_KEY ?? '' }),
);
