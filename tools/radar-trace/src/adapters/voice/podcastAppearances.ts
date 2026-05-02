import { z } from 'zod';
import type { Adapter, AdapterContext, AdapterResult, Env } from '../../types.js';
import {
  createVerifierClient,
  DEFAULT_MATCH_THRESHOLD,
  type VerifierClient,
} from '../../lib/ai/verifier.js';

export const VoicePodcastAppearancesPayloadSchema = z.object({
  episodes: z.array(z.object({
    podcastName: z.string(),
    episodeTitle: z.string(),
    publishedAt: z.string(),
    listenNotesUrl: z.string().url(),
    audioUrl: z.string().url().nullable(),
    descriptionExcerpt: z.string(),
  })),
  totalFound: z.number().int(),
});

export type VoicePodcastAppearancesPayload = z.infer<typeof VoicePodcastAppearancesPayloadSchema>;

type ListenNotesEpisode = {
  id: string;
  title_original: string;
  description_original?: string;
  pub_date_ms?: number;
  audio?: string | null;
  listennotes_url: string;
  podcast?: { title_original?: string };
};

type ListenNotesResponse = {
  count?: number;
  total?: number;
  results?: ListenNotesEpisode[];
};

export interface ListenNotesHttp {
  (url: string, init?: RequestInit): Promise<Response>;
}

export interface MakePodcastAppearancesAdapterOptions {
  httpFactory?: (env: Env) => ListenNotesHttp;
}

export function makeVoicePodcastAppearancesAdapter(
  httpFactory?: (env: Env) => ListenNotesHttp,
  verifierFactory: (env: Env) => VerifierClient = (env) => createVerifierClient(env),
): Adapter<VoicePodcastAppearancesPayload> {
  return {
    name: 'voice.podcast_appearances',
    module: 'voice',
    version: '0.2.0',
    estimatedCostInr: 0.5,
    requiredEnv: ['LISTEN_NOTES_KEY'],
    schema: VoicePodcastAppearancesPayloadSchema,
    async run(ctx: AdapterContext): Promise<AdapterResult<VoicePodcastAppearancesPayload>> {
      const t0 = Date.now();
      try {
        const http = httpFactory ? httpFactory(ctx.env) : ctx.http;
        const searchSubject = ctx.input.founder
          ? `"${ctx.input.founder}" OR "${ctx.input.name}"`
          : `"${ctx.input.name}"`;
        const url = `https://listen-api.listennotes.com/api/v2/search?q=${encodeURIComponent(searchSubject)}&type=episode`;
        const res = await http(url, {
          headers: { 'X-ListenAPI-Key': ctx.env.LISTEN_NOTES_KEY ?? '' },
          signal: ctx.signal,
        });
        if (!res.ok) throw new Error(`listennotes ${res.status}: ${await res.text().catch(() => '')}`);
        const json = await res.json() as ListenNotesResponse;
        const rawResults = json.results ?? [];
        const allEpisodes = rawResults.slice(0, 10).map((ep, i) => ({
          id: String(i),
          podcastName: ep.podcast?.title_original ?? 'Unknown Podcast',
          episodeTitle: ep.title_original,
          publishedAt: ep.pub_date_ms
            ? new Date(ep.pub_date_ms).toISOString()
            : new Date(0).toISOString(),
          listenNotesUrl: ep.listennotes_url,
          audioUrl: ep.audio ?? null,
          descriptionExcerpt: (ep.description_original ?? '').slice(0, 300),
        }));

        // Verification gate. ListenNotes returns text-token matches, so a
        // search for "Simple Inc" produced episodes about the "Intimate
        // Marriage Podcast", an "Innovation Simple Inc." marketing scientist,
        // and a Florida mortgage podcast — none of them about the target.
        let kept = allEpisodes;
        let verifyCostUsd = 0;
        let dropped = 0;
        let method: 'llm' | 'none' = 'none';
        if (allEpisodes.length > 0 && ctx.env.ANTHROPIC_API_KEY) {
          try {
            const verifier = verifierFactory(ctx.env);
            const { verdicts, costUsd } = await verifier.verifyBatch({
              target: {
                name: ctx.input.name,
                domain: ctx.input.domain,
                description: ctx.anchors.companyDescription,
                founder: ctx.input.founder ?? ctx.anchors.founders[0]?.name ?? null,
              },
              candidates: allEpisodes.map((e) => ({
                id: e.id,
                title: e.episodeTitle,
                snippet: e.descriptionExcerpt,
                url: e.listenNotesUrl,
                extra: { podcast: e.podcastName },
              })),
              candidateKind: 'podcast',
              signal: ctx.signal,
            });
            verifyCostUsd = costUsd;
            const verdictById = new Map(verdicts.map((v) => [v.id, v]));
            kept = allEpisodes.filter((e) => {
              const v = verdictById.get(e.id);
              return v ? v.match && v.confidence >= DEFAULT_MATCH_THRESHOLD : false;
            });
            dropped = allEpisodes.length - kept.length;
            method = 'llm';
          } catch (err) {
            ctx.logger.warn('podcast_appearances: verifier failed, returning unverified results', {
              error: (err as Error).message,
            });
          }
        }

        const episodes = kept.map(({ id: _id, ...rest }) => rest);
        const verifyPaise = Math.round(verifyCostUsd * 84 * 100);
        return {
          source: 'voice.podcast_appearances',
          fetchedAt: new Date().toISOString(),
          status: episodes.length > 0 ? 'ok' : 'empty',
          payload: { episodes, totalFound: json.total ?? rawResults.length },
          costPaise: verifyPaise,
          durationMs: Date.now() - t0,
          verification: {
            method,
            confidence: method === 'llm' ? 1 : 0.4,
            reason: method === 'llm'
              ? `verified ${episodes.length}/${allEpisodes.length} candidates`
              : 'unverified (no ANTHROPIC_API_KEY)',
            costUsd: verifyCostUsd,
            droppedCandidates: dropped,
          },
        };
      } catch (err) {
        return {
          source: 'voice.podcast_appearances',
          fetchedAt: new Date().toISOString(),
          status: 'error',
          payload: null,
          errors: [`podcast_appearances: ${(err as Error).message}`],
          costPaise: 0,
          durationMs: Date.now() - t0,
        };
      }
    },
  };
}

export const voicePodcastAppearancesAdapter = makeVoicePodcastAppearancesAdapter();
