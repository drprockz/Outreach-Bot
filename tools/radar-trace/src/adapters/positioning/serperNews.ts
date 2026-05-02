import { z } from 'zod';
import type { Adapter, AdapterContext, AdapterResult, Env } from '../../types.js';
import { createSerperClient, type SerperClient } from '../../clients/serper.js';
import {
  createVerifierClient,
  DEFAULT_MATCH_THRESHOLD,
  type VerifierClient,
} from '../../lib/ai/verifier.js';

export const PositioningSerperNewsPayloadSchema = z.object({
  results: z.array(z.object({
    title: z.string(),
    url: z.string().url(),
    description: z.string(),
    source: z.string(),
    publishedAt: z.string().nullable(),
  })),
});

export type PositioningSerperNewsPayload = z.infer<typeof PositioningSerperNewsPayloadSchema>;

export function makePositioningSerperNewsAdapter(
  serperFactory: (env: Env) => SerperClient,
  verifierFactory: (env: Env) => VerifierClient = (env) => createVerifierClient(env),
): Adapter<PositioningSerperNewsPayload> {
  return {
    name: 'positioning.serper_news',
    module: 'positioning',
    version: '0.2.0',
    estimatedCostInr: 0.5,
    requiredEnv: ['SERPER_API_KEY'],
    schema: PositioningSerperNewsPayloadSchema,
    async run(ctx: AdapterContext): Promise<AdapterResult<PositioningSerperNewsPayload>> {
      const t0 = Date.now();
      try {
        const serper = serperFactory(ctx.env);
        const q = `"${ctx.input.name}" ${ctx.input.domain}`;
        const { news, costPaise } = await serper.newsSearch({ q, signal: ctx.signal });

        const allResults = news.slice(0, 10).map((r, i) => ({
          id: String(i),
          title: r.title,
          url: r.link,
          description: r.snippet,
          source: r.source ?? new URL(r.link).hostname,
          publishedAt: r.date ?? null,
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
            ctx.logger.warn('serper_news: verifier failed, returning unverified results', {
              error: (err as Error).message,
            });
          }
        }

        const results = kept.map(({ id: _id, ...rest }) => rest);
        const verifyPaise = Math.round(verifyCostUsd * 84 * 100);

        return {
          source: 'positioning.serper_news',
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
          source: 'positioning.serper_news',
          fetchedAt: new Date().toISOString(),
          status: 'error',
          payload: null,
          errors: [`serper_news: ${(err as Error).message}`],
          costPaise: 0,
          durationMs: Date.now() - t0,
        };
      }
    },
  };
}

export const positioningSerperNewsAdapter = makePositioningSerperNewsAdapter(
  (env: Env) => createSerperClient({ apiKey: env.SERPER_API_KEY ?? '' }),
);
