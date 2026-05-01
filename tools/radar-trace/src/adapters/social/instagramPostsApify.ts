/**
 * social.instagram_posts_apify — Company Instagram post activity via Apify.
 *
 * Actor: `apify/instagram-scraper`
 * (Chosen for comprehensive Instagram data including captions, likes, comments,
 * media type, and post URLs. Input: { usernames: ['username'], resultsLimit: 30 }.
 * Cost: ~$0.005/result.)
 *
 * Two-step flow:
 *   1. Serper search `site:instagram.com "{name}"` → first Instagram profile URL
 *      matching the pattern: profile URL (not a specific post).
 *   2. ApifyClient: run actor with extracted username → structured posts.
 *
 * If Serper finds no matching profile URL → status:'empty'.
 * If Apify throws → status:'error'.
 *
 * Cost: Serper (~₹0.03) + Apify (N results × $0.005 × ₹84).
 * estimatedCostInr is set at ₹100 to cover 30-post runs.
 *
 * Uses the factory pattern so tests can inject fake Serper + Apify clients.
 */
import { z } from 'zod';
import type { Adapter, AdapterContext, AdapterResult, Env } from '../../types.js';
import { createSerperClient, type SerperClient } from '../../clients/serper.js';
import { createApifyClient, type ApifyClient } from '../../clients/apify.js';

export const InstagramPostsApifyPayloadSchema = z.object({
  instagramUrl: z.string().url().nullable(),
  posts: z.array(
    z.object({
      caption: z.string(),
      postedAt: z.string().nullable(),
      likes: z.number().nullable(),
      comments: z.number().nullable(),
      mediaType: z.enum(['image', 'video', 'carousel']),
      mediaUrl: z.string().nullable(),
      postUrl: z.string().nullable(),
    }),
  ),
  totalFetched: z.number(),
});

export type InstagramPostsApifyPayload = z.infer<typeof InstagramPostsApifyPayloadSchema>;

// Matches profile-level Instagram URLs (not individual posts /p/)
const INSTAGRAM_PROFILE_RE = /^https:\/\/(www\.)?instagram\.com\/[^/?#]+\/?$/;

// Raw shape from apify/instagram-scraper
interface RawInstagramPost {
  caption?: string;
  timestamp?: string;
  likesCount?: number;
  commentsCount?: number;
  type?: string;
  displayUrl?: string;
  url?: string;
}

function mapPost(row: RawInstagramPost) {
  let mediaType: 'image' | 'video' | 'carousel' = 'image';
  const t = (row.type ?? '').toLowerCase();
  if (t === 'video' || t === 'reel') {
    mediaType = 'video';
  } else if (t === 'sidecar' || t === 'carousel') {
    mediaType = 'carousel';
  }

  return {
    caption: row.caption ?? '',
    postedAt: row.timestamp ?? null,
    likes: row.likesCount ?? null,
    comments: row.commentsCount ?? null,
    mediaType,
    mediaUrl: row.displayUrl ?? null,
    postUrl: row.url ?? null,
  };
}

export function makeInstagramPostsApifyAdapter(deps: {
  serper: (env: Env) => SerperClient;
  apify: (env: Env) => ApifyClient;
}): Adapter<InstagramPostsApifyPayload> {
  const USD_INR_DEFAULT = 84;

  return {
    name: 'social.instagram_posts_apify',
    module: 'social',
    version: '0.1.0',
    estimatedCostInr: 100,
    requiredEnv: ['APIFY_TOKEN', 'SERPER_API_KEY'],
    cacheTtlMs: 6 * 60 * 60 * 1000,
    schema: InstagramPostsApifyPayloadSchema,

    async run(ctx: AdapterContext): Promise<AdapterResult<InstagramPostsApifyPayload>> {
      const t0 = Date.now();
      let totalCostPaise = 0;

      try {
        const serper = deps.serper(ctx.env);
        const apify = deps.apify(ctx.env);

        // Step 1: Discover Instagram profile URL via Serper
        const q = `site:instagram.com "${ctx.input.name}"`;
        const { organic, costPaise: serperCost } = await serper.search({ q, signal: ctx.signal });
        totalCostPaise += serperCost;

        const instagramUrl =
          organic.map((r) => r.link).find((link) => INSTAGRAM_PROFILE_RE.test(link)) ?? null;

        if (!instagramUrl) {
          return {
            source: 'social.instagram_posts_apify',
            fetchedAt: new Date().toISOString(),
            status: 'empty',
            payload: null,
            costPaise: totalCostPaise,
            durationMs: Date.now() - t0,
          };
        }

        // Extract username from URL (e.g. https://instagram.com/acmecorp → 'acmecorp')
        const username = instagramUrl.replace(/\/$/, '').split('/').pop() ?? '';

        // Step 2: Run Apify actor to get posts
        const { items, costUsd } = await apify.runActor<RawInstagramPost>({
          actor: 'apify/instagram-scraper',
          input: { usernames: [username], resultsLimit: 30 },
          costPerResultUsd: 0.005,
          maxResults: 30,
          signal: ctx.signal,
        });

        const usdToInr = parseFloat(ctx.env.USD_INR_RATE ?? String(USD_INR_DEFAULT));
        const apifyCostPaise = Math.round(costUsd * usdToInr * 100);
        totalCostPaise += apifyCostPaise;

        const posts = items.map(mapPost);

        return {
          source: 'social.instagram_posts_apify',
          fetchedAt: new Date().toISOString(),
          status: posts.length > 0 ? 'ok' : 'empty',
          payload: {
            instagramUrl,
            posts,
            totalFetched: posts.length,
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
          source: 'social.instagram_posts_apify',
          fetchedAt: new Date().toISOString(),
          status: 'error',
          payload: null,
          errors: [`instagram_posts_apify: ${(err as Error).message}`],
          costPaise: totalCostPaise,
          durationMs: Date.now() - t0,
        };
      }
    },
  };
}

export const instagramPostsApifyAdapter = makeInstagramPostsApifyAdapter({
  serper: (env: Env) => createSerperClient({ apiKey: env.SERPER_API_KEY ?? '' }),
  apify: (env: Env) => createApifyClient({ token: env.APIFY_TOKEN ?? '' }),
});
