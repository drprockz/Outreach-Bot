import { z } from 'zod';
import * as cheerio from 'cheerio';
import type { Adapter, AdapterContext, AdapterResult, Env } from '../../types.js';
import { createSerperClient, type SerperClient } from '../../clients/serper.js';

export const VoiceYoutubeChannelPayloadSchema = z.object({
  channelUrl: z.string().url().nullable(),
  channelId: z.string().nullable(),
  recentVideos: z.array(z.object({
    title: z.string(),
    url: z.string().url(),
    publishedAt: z.string(),
    description: z.string(),
  })),
});

export type VoiceYoutubeChannelPayload = z.infer<typeof VoiceYoutubeChannelPayloadSchema>;

const YOUTUBE_CHANNEL_ID_RE = /^https:\/\/(www\.)?youtube\.com\/channel\/([^/?#]+)/;
const YOUTUBE_HANDLE_RE = /^https:\/\/(www\.)?youtube\.com\/@([^/?#]+)/;

function extractChannelIdFromUrl(url: string): string | null {
  const m = YOUTUBE_CHANNEL_ID_RE.exec(url);
  return m?.[2] ?? null;
}

async function extractChannelIdFromHandlePage(
  http: typeof fetch,
  channelUrl: string,
  signal: AbortSignal,
): Promise<string | null> {
  try {
    const res = await http(channelUrl, { signal });
    if (!res.ok) return null;
    const html = await res.text();
    // Try meta tag approach
    const $ = cheerio.load(html);
    const channelId = $('meta[itemprop="channelId"]').attr('content')
      ?? $('meta[property="og:url"]').attr('content')?.match(/channel\/([^/?#]+)/)?.[1]
      ?? null;
    if (channelId) return channelId;
    // Fallback: search page HTML for channel ID pattern
    const match = html.match(/"channelId":"(UC[a-zA-Z0-9_-]{22})"/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

async function fetchChannelRss(
  http: typeof fetch,
  channelId: string,
  signal: AbortSignal,
): Promise<VoiceYoutubeChannelPayload['recentVideos']> {
  const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  const res = await http(feedUrl, { signal });
  if (!res.ok) return [];
  const xml = await res.text();
  const $ = cheerio.load(xml, { xmlMode: true });
  const videos: VoiceYoutubeChannelPayload['recentVideos'] = [];
  $('entry').each((_, el) => {
    const title = $(el).find('title').first().text().trim();
    const videoId = $(el).find('yt\\:videoId, videoId').first().text().trim();
    const published = $(el).find('published').first().text().trim();
    const description = $(el).find('media\\:description, description').first().text().trim();
    if (!title || !videoId) return;
    videos.push({
      title,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      publishedAt: published || new Date(0).toISOString(),
      description: description.slice(0, 300),
    });
  });
  return videos.slice(0, 15);
}

export function makeVoiceYoutubeChannelAdapter(
  serperFactory: (env: Env) => SerperClient,
): Adapter<VoiceYoutubeChannelPayload> {
  return {
    name: 'voice.youtube_channel',
    module: 'voice',
    version: '0.2.0',
    estimatedCostInr: 0.03,
    requiredEnv: ['SERPER_API_KEY'],
    schema: VoiceYoutubeChannelPayloadSchema,
    async run(ctx: AdapterContext): Promise<AdapterResult<VoiceYoutubeChannelPayload>> {
      const t0 = Date.now();
      try {
        // Anchor-first: if the company website links to its YouTube channel,
        // bypass the name search entirely. The original failure mode here was
        // a Japanese home builder ("株式会社シンプル") matching a search for
        // "Simple Inc" because the channel was titled `SIMPLE Inc.`.
        let channelUrl: string | null = null;
        let costPaise = 0;
        let verificationMethod: 'anchor' | 'none' = 'none';
        let verificationConfidence = 0;
        let verificationReason = '';
        if (
          ctx.anchors.youtubeChannelUrl &&
          (YOUTUBE_CHANNEL_ID_RE.test(ctx.anchors.youtubeChannelUrl) ||
            YOUTUBE_HANDLE_RE.test(ctx.anchors.youtubeChannelUrl))
        ) {
          channelUrl = ctx.anchors.youtubeChannelUrl;
          verificationMethod = 'anchor';
          verificationConfidence = 1;
          verificationReason = 'youtubeChannelUrl from company website';
        } else {
          const serper = serperFactory(ctx.env);
          const q = `site:youtube.com "${ctx.input.name}" channel`;
          const { organic, costPaise: serperCost } = await serper.search({ q, signal: ctx.signal });
          costPaise = serperCost;
          const channelHit = organic.find((r) =>
            YOUTUBE_CHANNEL_ID_RE.test(r.link) || YOUTUBE_HANDLE_RE.test(r.link),
          );
          channelUrl = channelHit?.link ?? null;
          if (channelUrl) {
            verificationConfidence = 0.4;
            verificationReason = 'serper name search (unverified)';
          }
        }

        if (!channelUrl) {
          return {
            source: 'voice.youtube_channel',
            fetchedAt: new Date().toISOString(),
            status: 'empty',
            payload: { channelUrl: null, channelId: null, recentVideos: [] },
            costPaise,
            durationMs: Date.now() - t0,
            verification: { method: 'none', confidence: 0, reason: 'no candidates' },
          };
        }

        let channelId = extractChannelIdFromUrl(channelUrl);

        // If @handle URL, need to fetch page to get channel ID
        if (!channelId && YOUTUBE_HANDLE_RE.test(channelUrl)) {
          channelId = await extractChannelIdFromHandlePage(ctx.http, channelUrl, ctx.signal);
        }

        let recentVideos: VoiceYoutubeChannelPayload['recentVideos'] = [];
        if (channelId) {
          recentVideos = await fetchChannelRss(ctx.http, channelId, ctx.signal);
        }

        return {
          source: 'voice.youtube_channel',
          fetchedAt: new Date().toISOString(),
          status: 'ok',
          payload: { channelUrl, channelId, recentVideos },
          costPaise,
          durationMs: Date.now() - t0,
          verification: {
            method: verificationMethod,
            confidence: verificationConfidence,
            reason: verificationReason,
          },
        };
      } catch (err) {
        return {
          source: 'voice.youtube_channel',
          fetchedAt: new Date().toISOString(),
          status: 'error',
          payload: null,
          errors: [`youtube_channel: ${(err as Error).message}`],
          costPaise: 0,
          durationMs: Date.now() - t0,
        };
      }
    },
  };
}

export const voiceYoutubeChannelAdapter = makeVoiceYoutubeChannelAdapter(
  (env: Env) => createSerperClient({ apiKey: env.SERPER_API_KEY ?? '' }),
);
