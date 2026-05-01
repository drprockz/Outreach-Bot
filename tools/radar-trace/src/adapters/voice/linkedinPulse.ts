import { z } from 'zod';
import type { Adapter, AdapterContext, AdapterResult, Env } from '../../types.js';
import { createSerperClient, type SerperClient } from '../../clients/serper.js';

export const VoiceLinkedinPulsePayloadSchema = z.object({
  articles: z.array(z.object({
    title: z.string(),
    url: z.string().url(),
    snippet: z.string(),
  })),
});

export type VoiceLinkedinPulsePayload = z.infer<typeof VoiceLinkedinPulsePayloadSchema>;

const LINKEDIN_PULSE_RE = /^https:\/\/(www\.)?linkedin\.com\/pulse\//;

export function makeVoiceLinkedinPulseAdapter(
  serperFactory: (env: Env) => SerperClient,
): Adapter<VoiceLinkedinPulsePayload> {
  return {
    name: 'voice.linkedin_pulse',
    module: 'voice',
    version: '0.1.0',
    estimatedCostInr: 0.03,
    requiredEnv: ['SERPER_API_KEY'],
    schema: VoiceLinkedinPulsePayloadSchema,
    async run(ctx: AdapterContext): Promise<AdapterResult<VoiceLinkedinPulsePayload>> {
      const t0 = Date.now();
      try {
        const serper = serperFactory(ctx.env);
        // Use founder name if available, fall back to company name
        const searchSubject = ctx.input.founder ?? ctx.input.name;
        const q = `site:linkedin.com/pulse/ "${searchSubject}"`;
        const { organic, costPaise } = await serper.search({ q, signal: ctx.signal });

        const articles = organic
          .filter((r) => LINKEDIN_PULSE_RE.test(r.link))
          .map((r) => ({
            title: r.title,
            url: r.link,
            snippet: r.snippet,
          }));

        return {
          source: 'voice.linkedin_pulse',
          fetchedAt: new Date().toISOString(),
          status: articles.length > 0 ? 'ok' : 'empty',
          payload: { articles },
          costPaise,
          durationMs: Date.now() - t0,
        };
      } catch (err) {
        return {
          source: 'voice.linkedin_pulse',
          fetchedAt: new Date().toISOString(),
          status: 'error',
          payload: null,
          errors: [`linkedin_pulse: ${(err as Error).message}`],
          costPaise: 0,
          durationMs: Date.now() - t0,
        };
      }
    },
  };
}

export const voiceLinkedinPulseAdapter = makeVoiceLinkedinPulseAdapter(
  (env: Env) => createSerperClient({ apiKey: env.SERPER_API_KEY ?? '' }),
);
