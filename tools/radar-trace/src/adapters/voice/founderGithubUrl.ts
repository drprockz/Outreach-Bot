import { z } from 'zod';
import type { Adapter, AdapterContext, AdapterResult, Env } from '../../types.js';
import { createSerperClient, type SerperClient } from '../../clients/serper.js';

export const VoiceFounderGithubUrlPayloadSchema = z.object({
  url: z.string().url().nullable(),
  candidates: z.array(z.object({
    title: z.string(),
    link: z.string().url(),
    snippet: z.string(),
  })).max(5),
});

export type VoiceFounderGithubUrlPayload = z.infer<typeof VoiceFounderGithubUrlPayloadSchema>;

// Matches github.com/{user} or github.com/{org} — top-level profile/org pages only (not repos)
const GITHUB_PROFILE_RE = /^https:\/\/github\.com\/[^/?#]+\/?$/;

export function makeVoiceFounderGithubUrlAdapter(
  serperFactory: (env: Env) => SerperClient,
): Adapter<VoiceFounderGithubUrlPayload> {
  return {
    name: 'voice.founder_github_url',
    module: 'voice',
    version: '0.1.0',
    estimatedCostInr: 0.03,
    requiredEnv: ['SERPER_API_KEY'],
    schema: VoiceFounderGithubUrlPayloadSchema,
    async run(ctx: AdapterContext): Promise<AdapterResult<VoiceFounderGithubUrlPayload>> {
      const t0 = Date.now();

      if (!ctx.input.founder) {
        return {
          source: 'voice.founder_github_url',
          fetchedAt: new Date().toISOString(),
          status: 'empty',
          payload: { url: null, candidates: [] },
          costPaise: 0,
          durationMs: Date.now() - t0,
        };
      }

      try {
        const serper = serperFactory(ctx.env);
        const q = `site:github.com "${ctx.input.founder}" "${ctx.input.name}"`;
        const { organic, costPaise } = await serper.search({ q, signal: ctx.signal });

        const candidates = organic.slice(0, 5).map((r) => ({
          title: r.title,
          link: r.link,
          snippet: r.snippet,
        }));

        const match = organic.find((r) => GITHUB_PROFILE_RE.test(r.link));
        return {
          source: 'voice.founder_github_url',
          fetchedAt: new Date().toISOString(),
          status: 'ok',
          payload: { url: match?.link ?? null, candidates },
          costPaise,
          durationMs: Date.now() - t0,
        };
      } catch (err) {
        return {
          source: 'voice.founder_github_url',
          fetchedAt: new Date().toISOString(),
          status: 'error',
          payload: null,
          errors: [`founder_github_url: ${(err as Error).message}`],
          costPaise: 0,
          durationMs: Date.now() - t0,
        };
      }
    },
  };
}

export const voiceFounderGithubUrlAdapter = makeVoiceFounderGithubUrlAdapter(
  (env: Env) => createSerperClient({ apiKey: env.SERPER_API_KEY ?? '' }),
);
