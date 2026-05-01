import { z } from 'zod';
import type { Adapter, AdapterContext, AdapterResult, Env } from '../../types.js';
import { createBraveClient, type BraveClient } from '../../clients/brave.js';

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
): Adapter<PositioningBraveNewsPayload> {
  return {
    name: 'positioning.brave_news',
    module: 'positioning',
    version: '0.1.0',
    estimatedCostInr: 0.50,
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

        const results = braveResults.map((r) => ({
          title: r.title,
          url: r.url,
          description: r.description,
          source: r.profile?.name ?? new URL(r.url).hostname,
          publishedAt: r.page_age || r.age || null,
        }));

        return {
          source: 'positioning.brave_news',
          fetchedAt: new Date().toISOString(),
          status: results.length > 0 ? 'ok' : 'empty',
          payload: { results },
          costPaise,
          durationMs: Date.now() - t0,
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
