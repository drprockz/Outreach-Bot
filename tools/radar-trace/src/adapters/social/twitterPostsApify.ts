/**
 * social.twitter_posts_apify — Company Twitter/X post activity via Apify.
 *
 * Actor: `apify/twitter-scraper`
 * (Chosen for reliable public tweet scraping without auth credentials.
 * Input: { handles: ['handle'], maxTweets: 30 }. Cost: ~$0.005/result.)
 *
 * Two-step flow:
 *   1. Serper search `site:twitter.com OR site:x.com "{name}"` → first handle URL
 *      matching the pattern: profile URL (not a specific tweet).
 *   2. ApifyClient: run actor with extracted handle → structured tweets.
 *
 * If Serper finds no matching handle URL → status:'empty'.
 * If Apify throws → status:'error'.
 *
 * Cost: Serper (~₹0.03) + Apify (N results × $0.005 × ₹84).
 * estimatedCostInr is set at ₹100 to cover 30-tweet runs.
 *
 * Uses the factory pattern so tests can inject fake Serper + Apify clients.
 */
import { z } from 'zod';
import type { Adapter, AdapterContext, AdapterResult, Env } from '../../types.js';
import { createSerperClient, type SerperClient } from '../../clients/serper.js';
import { createApifyClient, type ApifyClient } from '../../clients/apify.js';

export const TwitterPostsApifyPayloadSchema = z.object({
  twitterUrl: z.string().url().nullable(),
  tweets: z.array(
    z.object({
      text: z.string(),
      postedAt: z.string().nullable(),
      likes: z.number().nullable(),
      retweets: z.number().nullable(),
      quoteCount: z.number().nullable(),
      tweetUrl: z.string().nullable(),
      mediaType: z.enum(['image', 'video', 'none']),
    }),
  ),
  totalFetched: z.number(),
});

export type TwitterPostsApifyPayload = z.infer<typeof TwitterPostsApifyPayloadSchema>;

// Matches profile-level Twitter/X URLs (not individual tweets)
const TWITTER_HANDLE_RE = /^https:\/\/(www\.)?(twitter|x)\.com\/[^/?#]+\/?$/;

// Raw shape from apify/twitter-scraper
interface RawTweetRow {
  id?: string;
  full_text?: string;
  text?: string;
  created_at?: string;
  favorite_count?: number;
  retweet_count?: number;
  quote_count?: number;
  url?: string;
  attachments?: {
    media?: Array<{ type?: string; media_url_https?: string }>;
  } | null;
}

function detectMediaType(row: RawTweetRow): 'image' | 'video' | 'none' {
  const media = row.attachments?.media;
  if (!media || media.length === 0) return 'none';
  const firstMedia = media[0];
  if (!firstMedia) return 'none';
  if (firstMedia.type === 'video' || firstMedia.type === 'animated_gif') return 'video';
  if (firstMedia.type === 'photo') return 'image';
  return 'none';
}

function mapTweet(row: RawTweetRow) {
  return {
    text: row.full_text ?? row.text ?? '',
    postedAt: row.created_at ?? null,
    likes: row.favorite_count ?? null,
    retweets: row.retweet_count ?? null,
    quoteCount: row.quote_count ?? null,
    tweetUrl: row.url ?? null,
    mediaType: detectMediaType(row),
  };
}

export function makeTwitterPostsApifyAdapter(deps: {
  serper: (env: Env) => SerperClient;
  apify: (env: Env) => ApifyClient;
}): Adapter<TwitterPostsApifyPayload> {
  const USD_INR_DEFAULT = 84;

  return {
    name: 'social.twitter_posts_apify',
    module: 'social',
    version: '0.1.0',
    estimatedCostInr: 100,
    requiredEnv: ['APIFY_TOKEN', 'SERPER_API_KEY'],
    cacheTtlMs: 6 * 60 * 60 * 1000,
    schema: TwitterPostsApifyPayloadSchema,

    async run(ctx: AdapterContext): Promise<AdapterResult<TwitterPostsApifyPayload>> {
      const t0 = Date.now();
      let totalCostPaise = 0;

      try {
        const serper = deps.serper(ctx.env);
        const apify = deps.apify(ctx.env);

        // Step 1: Discover Twitter/X profile URL via Serper
        const q = `site:twitter.com OR site:x.com "${ctx.input.name}"`;
        const { organic, costPaise: serperCost } = await serper.search({ q, signal: ctx.signal });
        totalCostPaise += serperCost;

        const twitterUrl =
          organic.map((r) => r.link).find((link) => TWITTER_HANDLE_RE.test(link)) ?? null;

        if (!twitterUrl) {
          return {
            source: 'social.twitter_posts_apify',
            fetchedAt: new Date().toISOString(),
            status: 'empty',
            payload: null,
            costPaise: totalCostPaise,
            durationMs: Date.now() - t0,
          };
        }

        // Extract handle from URL (e.g. https://twitter.com/acmecorp → 'acmecorp')
        const handle = twitterUrl.replace(/\/$/, '').split('/').pop() ?? '';

        // Step 2: Run Apify actor to get tweets
        const { items, costUsd } = await apify.runActor<RawTweetRow>({
          actor: 'apify/twitter-scraper',
          input: { handles: [handle], maxTweets: 30 },
          costPerResultUsd: 0.005,
          maxResults: 30,
          signal: ctx.signal,
        });

        const usdToInr = parseFloat(ctx.env.USD_INR_RATE ?? String(USD_INR_DEFAULT));
        const apifyCostPaise = Math.round(costUsd * usdToInr * 100);
        totalCostPaise += apifyCostPaise;

        const tweets = items.map(mapTweet);

        return {
          source: 'social.twitter_posts_apify',
          fetchedAt: new Date().toISOString(),
          status: tweets.length > 0 ? 'ok' : 'empty',
          payload: {
            twitterUrl,
            tweets,
            totalFetched: tweets.length,
          },
          costPaise: totalCostPaise,
          durationMs: Date.now() - t0,
          costMeta: {
            apifyResults: items.length,
            costUsd,
          },
        };
      } catch (err) {
        return {
          source: 'social.twitter_posts_apify',
          fetchedAt: new Date().toISOString(),
          status: 'error',
          payload: null,
          errors: [`twitter_posts_apify: ${(err as Error).message}`],
          costPaise: totalCostPaise,
          durationMs: Date.now() - t0,
        };
      }
    },
  };
}

export const twitterPostsApifyAdapter = makeTwitterPostsApifyAdapter({
  serper: (env: Env) => createSerperClient({ apiKey: env.SERPER_API_KEY ?? '' }),
  apify: (env: Env) => createApifyClient({ token: env.APIFY_TOKEN ?? '' }),
});
