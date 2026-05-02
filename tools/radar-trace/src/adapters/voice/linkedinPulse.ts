import { z } from 'zod';
import type { Adapter, AdapterContext, AdapterResult, Env } from '../../types.js';
import { createSerperClient, type SerperClient } from '../../clients/serper.js';
import {
  createVerifierClient,
  DEFAULT_MATCH_THRESHOLD,
  type VerifierClient,
} from '../../lib/ai/verifier.js';

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
  verifierFactory: (env: Env) => VerifierClient = (env) => createVerifierClient(env),
): Adapter<VoiceLinkedinPulsePayload> {
  return {
    name: 'voice.linkedin_pulse',
    module: 'voice',
    version: '0.2.0',
    estimatedCostInr: 0.5,
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

        const rawArticles = organic
          .filter((r) => LINKEDIN_PULSE_RE.test(r.link))
          .map((r, i) => ({
            id: String(i),
            title: r.title,
            url: r.link,
            snippet: r.snippet,
          }));

        // Verification gate. Without this, "Simple Inc" returns Pulse posts
        // about "Safety Made Simple Inc.", "HR Simple Inc.", etc. We hand each
        // candidate to Haiku with the target description (from anchors) and
        // drop anything below the match threshold. If ANTHROPIC_API_KEY is
        // missing, we skip verification — the trace still ships, marked
        // unverified — rather than failing closed.
        let articles = rawArticles.map(({ id: _id, ...rest }) => rest);
        let verifyCostUsd = 0;
        let dropped = 0;
        let method: 'llm' | 'none' = 'none';
        if (rawArticles.length > 0 && ctx.env.ANTHROPIC_API_KEY) {
          try {
            const verifier = verifierFactory(ctx.env);
            const { verdicts, costUsd } = await verifier.verifyBatch({
              target: {
                name: ctx.input.name,
                domain: ctx.input.domain,
                description: ctx.anchors.companyDescription,
                founder: ctx.input.founder ?? ctx.anchors.founders[0]?.name ?? null,
              },
              candidates: rawArticles.map((a) => ({
                id: a.id,
                title: a.title,
                snippet: a.snippet,
                url: a.url,
              })),
              candidateKind: 'article',
              signal: ctx.signal,
            });
            verifyCostUsd = costUsd;
            const verdictById = new Map(verdicts.map((v) => [v.id, v]));
            const kept = rawArticles.filter((a) => {
              const v = verdictById.get(a.id);
              return v ? v.match && v.confidence >= DEFAULT_MATCH_THRESHOLD : false;
            });
            dropped = rawArticles.length - kept.length;
            articles = kept.map(({ id: _id, ...rest }) => rest);
            method = 'llm';
          } catch (err) {
            ctx.logger.warn('linkedin_pulse: verifier failed, returning unverified results', {
              error: (err as Error).message,
            });
          }
        }

        const verifyPaise = Math.round(verifyCostUsd * 84 * 100);
        return {
          source: 'voice.linkedin_pulse',
          fetchedAt: new Date().toISOString(),
          status: articles.length > 0 ? 'ok' : 'empty',
          payload: { articles },
          costPaise: costPaise + verifyPaise,
          durationMs: Date.now() - t0,
          verification: {
            method,
            confidence: method === 'llm' ? 1 : 0.4,
            reason: method === 'llm'
              ? `verified ${articles.length}/${rawArticles.length} candidates`
              : 'unverified (no ANTHROPIC_API_KEY)',
            costUsd: verifyCostUsd,
            droppedCandidates: dropped,
          },
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
