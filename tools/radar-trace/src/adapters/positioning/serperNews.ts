import { z } from 'zod';
import type { Adapter, AdapterContext, AdapterResult, Env } from '../../types.js';
import { createSerperClient, type SerperClient } from '../../clients/serper.js';

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
): Adapter<PositioningSerperNewsPayload> {
  return {
    name: 'positioning.serper_news',
    module: 'positioning',
    version: '0.1.0',
    estimatedCostInr: 0.03,
    requiredEnv: ['SERPER_API_KEY'],
    schema: PositioningSerperNewsPayloadSchema,
    async run(ctx: AdapterContext): Promise<AdapterResult<PositioningSerperNewsPayload>> {
      const t0 = Date.now();
      try {
        const serper = serperFactory(ctx.env);
        const q = `"${ctx.input.name}" ${ctx.input.domain}`;
        const { news, costPaise } = await serper.newsSearch({ q, signal: ctx.signal });

        const results = news.slice(0, 10).map((r) => ({
          title: r.title,
          url: r.link,
          description: r.snippet,
          source: r.source ?? new URL(r.link).hostname,
          publishedAt: r.date ?? null,
        }));

        return {
          source: 'positioning.serper_news',
          fetchedAt: new Date().toISOString(),
          status: results.length > 0 ? 'ok' : 'empty',
          payload: { results },
          costPaise,
          durationMs: Date.now() - t0,
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
