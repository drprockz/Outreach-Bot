/**
 * social.facebook_posts_apify — Company Facebook page post activity via Apify.
 *
 * Actor: `apify/facebook-pages-scraper`
 * (Chosen for comprehensive Facebook page data including post text, likes,
 * comments, shares, media type, and post URLs.
 * Input: { startUrls: [{ url: pageUrl }], resultsLimit: 30 }. Cost: ~$0.005/result.)
 *
 * Two-step flow:
 *   1. Serper search `site:facebook.com "{name}"` → first Facebook page URL
 *      matching the profile pattern (not a specific post or photo).
 *   2. ApifyClient: run actor with discovered page URL → structured posts.
 *
 * If Serper finds no matching page URL → status:'empty'.
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

export const FacebookPostsApifyPayloadSchema = z.object({
  facebookUrl: z.string().url().nullable(),
  posts: z.array(
    z.object({
      text: z.string(),
      postedAt: z.string().nullable(),
      likes: z.number().nullable(),
      comments: z.number().nullable(),
      shares: z.number().nullable(),
      mediaType: z.enum(['image', 'video', 'none']),
      mediaUrl: z.string().nullable(),
      postUrl: z.string().nullable(),
    }),
  ),
  totalFetched: z.number(),
});

export type FacebookPostsApifyPayload = z.infer<typeof FacebookPostsApifyPayloadSchema>;

// Matches Facebook page/profile URLs (not posts, photos, or events)
const FACEBOOK_PAGE_RE = /^https:\/\/(www\.)?facebook\.com\/[^/?#]+\/?$/;

// Raw shape from apify/facebook-pages-scraper
interface RawFacebookPost {
  postId?: string;
  text?: string;
  time?: string;
  likes?: number;
  comments?: number;
  shares?: number;
  media?: Array<{ type?: string; url?: string }>;
  postUrl?: string;
}

function detectMedia(
  row: RawFacebookPost,
): { mediaType: 'image' | 'video' | 'none'; mediaUrl: string | null } {
  const media = row.media;
  if (!media || media.length === 0) return { mediaType: 'none', mediaUrl: null };
  const first = media[0];
  if (!first) return { mediaType: 'none', mediaUrl: null };
  if (first.type === 'video') return { mediaType: 'video', mediaUrl: first.url ?? null };
  if (first.type === 'photo') return { mediaType: 'image', mediaUrl: first.url ?? null };
  return { mediaType: 'none', mediaUrl: null };
}

function mapPost(row: RawFacebookPost) {
  const { mediaType, mediaUrl } = detectMedia(row);
  return {
    text: row.text ?? '',
    postedAt: row.time ?? null,
    likes: row.likes ?? null,
    comments: row.comments ?? null,
    shares: row.shares ?? null,
    mediaType,
    mediaUrl,
    postUrl: row.postUrl ?? null,
  };
}

export function makeFacebookPostsApifyAdapter(deps: {
  serper: (env: Env) => SerperClient;
  apify: (env: Env) => ApifyClient;
}): Adapter<FacebookPostsApifyPayload> {
  const USD_INR_DEFAULT = 84;

  return {
    name: 'social.facebook_posts_apify',
    module: 'social',
    version: '0.1.0',
    estimatedCostInr: 100,
    requiredEnv: ['APIFY_TOKEN', 'SERPER_API_KEY'],
    cacheTtlMs: 6 * 60 * 60 * 1000,
    schema: FacebookPostsApifyPayloadSchema,

    async run(ctx: AdapterContext): Promise<AdapterResult<FacebookPostsApifyPayload>> {
      const t0 = Date.now();
      let totalCostPaise = 0;

      try {
        const serper = deps.serper(ctx.env);
        const apify = deps.apify(ctx.env);

        // Step 1: Discover Facebook page URL via Serper
        const q = `site:facebook.com "${ctx.input.name}"`;
        const { organic, costPaise: serperCost } = await serper.search({ q, signal: ctx.signal });
        totalCostPaise += serperCost;

        const facebookUrl =
          organic.map((r) => r.link).find((link) => FACEBOOK_PAGE_RE.test(link)) ?? null;

        if (!facebookUrl) {
          return {
            source: 'social.facebook_posts_apify',
            fetchedAt: new Date().toISOString(),
            status: 'empty',
            payload: null,
            costPaise: totalCostPaise,
            durationMs: Date.now() - t0,
          };
        }

        // Step 2: Run Apify actor to get posts
        const { items, costUsd } = await apify.runActor<RawFacebookPost>({
          actor: 'apify/facebook-pages-scraper',
          input: { startUrls: [{ url: facebookUrl }], resultsLimit: 30 },
          costPerResultUsd: 0.005,
          maxResults: 30,
          signal: ctx.signal,
        });

        const usdToInr = parseFloat(ctx.env.USD_INR_RATE ?? String(USD_INR_DEFAULT));
        const apifyCostPaise = Math.round(costUsd * usdToInr * 100);
        totalCostPaise += apifyCostPaise;

        const posts = items.map(mapPost);

        return {
          source: 'social.facebook_posts_apify',
          fetchedAt: new Date().toISOString(),
          status: posts.length > 0 ? 'ok' : 'empty',
          payload: {
            facebookUrl,
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
          source: 'social.facebook_posts_apify',
          fetchedAt: new Date().toISOString(),
          status: 'error',
          payload: null,
          errors: [`facebook_posts_apify: ${(err as Error).message}`],
          costPaise: totalCostPaise,
          durationMs: Date.now() - t0,
        };
      }
    },
  };
}

export const facebookPostsApifyAdapter = makeFacebookPostsApifyAdapter({
  serper: (env: Env) => createSerperClient({ apiKey: env.SERPER_API_KEY ?? '' }),
  apify: (env: Env) => createApifyClient({ token: env.APIFY_TOKEN ?? '' }),
});
