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
    version: '0.2.0',
    estimatedCostInr: 0.03,
    requiredEnv: ['SERPER_API_KEY'],
    schema: VoiceFounderLinkedinUrlPayloadSchema,
    async run(ctx: AdapterContext): Promise<AdapterResult<VoiceFounderLinkedinUrlPayload>> {
      const t0 = Date.now();

      // 1. Explicit CLI shortcut — operator-provided, treated as gospel.
      if (ctx.input.founderLinkedinUrl) {
        return {
          source: 'voice.founder_linkedin_url',
          fetchedAt: new Date().toISOString(),
          status: 'ok',
          payload: { url: ctx.input.founderLinkedinUrl, candidates: [] },
          costPaise: 0,
          durationMs: Date.now() - t0,
          verification: { method: 'none', confidence: 1, reason: '--linkedin CLI flag' },
        };
      }

      // 2. Anchor — when /about or /team self-links a founder profile, that's
      // the only way to disambiguate among LinkedIn profiles for common names.
      const anchorFounderUrl = ctx.anchors.founders.find(
        (f) => f.linkedinUrl && LINKEDIN_IN_RE.test(f.linkedinUrl),
      )?.linkedinUrl ?? null;
      if (anchorFounderUrl) {
        return {
          source: 'voice.founder_linkedin_url',
          fetchedAt: new Date().toISOString(),
          status: 'ok',
          payload: { url: anchorFounderUrl, candidates: [] },
          costPaise: 0,
          durationMs: Date.now() - t0,
          verification: { method: 'anchor', confidence: 1, reason: 'founder linkedinUrl from company website' },
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
          verification: { method: 'none', confidence: 0, reason: 'no founder provided' },
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
          verification: {
            method: 'none',
            confidence: match ? 0.5 : 0,
            reason: match ? 'serper name+company search (unverified)' : 'no candidates',
          },
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
