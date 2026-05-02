import { z } from 'zod';
import type { Adapter, AdapterContext, AdapterResult, Env } from '../../types.js';
import { createSerperClient, type SerperClient } from '../../clients/serper.js';
import {
  createVerifierClient,
  DEFAULT_MATCH_THRESHOLD,
  type VerifierClient,
} from '../../lib/ai/verifier.js';

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
  verifierFactory: (env: Env) => VerifierClient = (env) => createVerifierClient(env),
): Adapter<VoiceFounderGithubUrlPayload> {
  return {
    name: 'voice.founder_github_url',
    module: 'voice',
    version: '0.2.0',
    estimatedCostInr: 0.5,
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
          verification: { method: 'none', confidence: 0, reason: 'no founder provided' },
        };
      }

      try {
        const serper = serperFactory(ctx.env);
        const q = `site:github.com "${ctx.input.founder}" "${ctx.input.name}"`;
        const { organic, costPaise } = await serper.search({ q, signal: ctx.signal });

        const profileHits = organic.filter((r) => GITHUB_PROFILE_RE.test(r.link)).slice(0, 5);
        const candidates = organic.slice(0, 5).map((r) => ({
          title: r.title,
          link: r.link,
          snippet: r.snippet,
        }));

        // Verify each profile candidate. We pick the highest-confidence match
        // above threshold rather than the first regex hit — GitHub usernames
        // are too short to disambiguate by token alone (e.g. searching for
        // "John" returns thousands of unrelated /john pages).
        let chosenUrl: string | null = profileHits[0]?.link ?? null;
        let verifyCostUsd = 0;
        let dropped = 0;
        let method: 'llm' | 'none' = 'none';
        let confidence = chosenUrl ? 0.4 : 0;
        let reason = chosenUrl ? 'serper name search (unverified)' : 'no candidates';

        if (profileHits.length > 0 && ctx.env.ANTHROPIC_API_KEY) {
          try {
            const verifier = verifierFactory(ctx.env);
            const { verdicts, costUsd } = await verifier.verifyBatch({
              target: {
                name: ctx.input.name,
                domain: ctx.input.domain,
                description: ctx.anchors.companyDescription,
                founder: ctx.input.founder,
              },
              candidates: profileHits.map((r, i) => ({
                id: String(i),
                title: r.title,
                snippet: r.snippet,
                url: r.link,
              })),
              candidateKind: 'profile',
              signal: ctx.signal,
            });
            verifyCostUsd = costUsd;
            const above = verdicts
              .filter((v) => v.match && v.confidence >= DEFAULT_MATCH_THRESHOLD)
              .sort((a, b) => b.confidence - a.confidence);
            dropped = profileHits.length - above.length;
            method = 'llm';
            if (above.length > 0) {
              const idx = parseInt(above[0]!.id, 10);
              chosenUrl = profileHits[idx]?.link ?? null;
              confidence = above[0]!.confidence;
              reason = above[0]!.reason;
            } else {
              chosenUrl = null;
              confidence = 0;
              reason = 'all candidates rejected by verifier';
            }
          } catch (err) {
            ctx.logger.warn('founder_github_url: verifier failed, returning unverified result', {
              error: (err as Error).message,
            });
          }
        }

        const verifyPaise = Math.round(verifyCostUsd * 84 * 100);
        return {
          source: 'voice.founder_github_url',
          fetchedAt: new Date().toISOString(),
          status: 'ok',
          payload: { url: chosenUrl, candidates },
          costPaise: costPaise + verifyPaise,
          durationMs: Date.now() - t0,
          verification: {
            method,
            confidence,
            reason,
            costUsd: verifyCostUsd,
            droppedCandidates: dropped,
          },
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
