import { z } from 'zod';
import type { Adapter, AdapterContext, AdapterResult, Env } from '../../types.js';
import { createSerperClient, type SerperClient } from '../../clients/serper.js';

export const VoiceFounderLinkedinUrlPayloadSchema = z.object({
  url: z.string().url().nullable(),
  candidates: z.array(z.object({
    title: z.string(),
    link: z.string().url(),
    snippet: z.string(),
  })).max(5),
});

export type VoiceFounderLinkedinUrlPayload = z.infer<typeof VoiceFounderLinkedinUrlPayloadSchema>;

const LINKEDIN_IN_RE = /^https:\/\/(www\.)?linkedin\.com\/in\//;

export function makeVoiceFounderLinkedinUrlAdapter(
  serperFactory: (env: Env) => SerperClient,
): Adapter<VoiceFounderLinkedinUrlPayload> {
  return {
    name: 'voice.founder_linkedin_url',
    module: 'voice',
    version: '0.1.0',
    estimatedCostInr: 0.03,
    requiredEnv: ['SERPER_API_KEY'],
    schema: VoiceFounderLinkedinUrlPayloadSchema,
    async run(ctx: AdapterContext): Promise<AdapterResult<VoiceFounderLinkedinUrlPayload>> {
      const t0 = Date.now();

      // If already provided, short-circuit — no Serper call
      if (ctx.input.founderLinkedinUrl) {
        return {
          source: 'voice.founder_linkedin_url',
          fetchedAt: new Date().toISOString(),
          status: 'ok',
          payload: { url: ctx.input.founderLinkedinUrl, candidates: [] },
          costPaise: 0,
          durationMs: Date.now() - t0,
        };
      }

      if (!ctx.input.founder) {
        return {
          source: 'voice.founder_linkedin_url',
          fetchedAt: new Date().toISOString(),
          status: 'empty',
          payload: { url: null, candidates: [] },
          costPaise: 0,
          durationMs: Date.now() - t0,
        };
      }

      try {
        const serper = serperFactory(ctx.env);
        const q = `site:linkedin.com/in/ "${ctx.input.founder}" "${ctx.input.name}"`;
        const { organic, costPaise } = await serper.search({ q, signal: ctx.signal });

        const candidates = organic.slice(0, 5).map((r) => ({
          title: r.title,
          link: r.link,
          snippet: r.snippet,
        }));

        const match = organic.find((r) => LINKEDIN_IN_RE.test(r.link));
        return {
          source: 'voice.founder_linkedin_url',
          fetchedAt: new Date().toISOString(),
          status: 'ok',
          payload: { url: match?.link ?? null, candidates },
          costPaise,
          durationMs: Date.now() - t0,
        };
      } catch (err) {
        return {
          source: 'voice.founder_linkedin_url',
          fetchedAt: new Date().toISOString(),
          status: 'error',
          payload: null,
          errors: [`founder_linkedin_url: ${(err as Error).message}`],
          costPaise: 0,
          durationMs: Date.now() - t0,
        };
      }
    },
  };
}

export const voiceFounderLinkedinUrlAdapter = makeVoiceFounderLinkedinUrlAdapter(
  (env: Env) => createSerperClient({ apiKey: env.SERPER_API_KEY ?? '' }),
);
