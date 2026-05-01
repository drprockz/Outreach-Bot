import { z } from 'zod';
import type { Adapter, AdapterContext, AdapterResult, Env } from '../../types.js';

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
): Adapter<VoicePodcastAppearancesPayload> {
  return {
    name: 'voice.podcast_appearances',
    module: 'voice',
    version: '0.1.0',
    estimatedCostInr: 0,
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
        const episodes = rawResults.slice(0, 10).map((ep) => ({
          podcastName: ep.podcast?.title_original ?? 'Unknown Podcast',
          episodeTitle: ep.title_original,
          publishedAt: ep.pub_date_ms
            ? new Date(ep.pub_date_ms).toISOString()
            : new Date(0).toISOString(),
          listenNotesUrl: ep.listennotes_url,
          audioUrl: ep.audio ?? null,
          descriptionExcerpt: (ep.description_original ?? '').slice(0, 300),
        }));
        return {
          source: 'voice.podcast_appearances',
          fetchedAt: new Date().toISOString(),
          status: episodes.length > 0 ? 'ok' : 'empty',
          payload: { episodes, totalFound: json.total ?? rawResults.length },
          costPaise: 0,
          durationMs: Date.now() - t0,
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
