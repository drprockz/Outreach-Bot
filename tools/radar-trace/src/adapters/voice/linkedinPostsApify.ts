/**
 * voice.linkedin_posts_apify — LinkedIn founder post activity via Apify.
 *
 * Actor: `apimaestro/linkedin-profile-posts`
 * (Chosen for active maintenance and structured output of profile posts.
 * Input: { profileUrl, limit: 50 }. Cost: ~$0.005/result.)
 *
 * Two-step flow:
 *   1. URL discovery: if `ctx.input.founderLinkedinUrl` is set → use it directly
 *      (no Serper call). Otherwise, Serper search `site:linkedin.com/in/ "{founder}"`
 *      and pick the first matching personal profile URL.
 *   2. ApifyClient: run actor with `{ profileUrl, limit: 50 }` → structured posts.
 *
 * If neither direct URL nor Serper result yields a profile URL → status:'empty'.
 * If Apify throws → status:'error'.
 *
 * Cost: Serper (~₹0.03, skipped if founderLinkedinUrl provided) + Apify
 * (N results × $0.005 × ₹84 ≈ ₹0.42 each).
 * estimatedCostInr is set at ₹100 to cover 50-result runs.
 *
 * Uses the factory pattern so tests can inject fake Serper + Apify clients.
 */
import { z } from 'zod';
import type { Adapter, AdapterContext, AdapterResult, Env } from '../../types.js';
import { createSerperClient, type SerperClient } from '../../clients/serper.js';
import { createApifyClient, type ApifyClient } from '../../clients/apify.js';

export const VoiceLinkedinPostsApifyPayloadSchema = z.object({
  founderLinkedinUrl: z.string().url().nullable(),
  posts: z.array(
    z.object({
      text: z.string(),
      postedAt: z.string().nullable(),
      reactionsCount: z.number().nullable(),
      commentsCount: z.number().nullable(),
      sharesCount: z.number().nullable(),
      postUrl: z.string().nullable(),
      mediaType: z.enum(['image', 'video', 'article', 'none']),
      mediaUrl: z.string().nullable(),
    }),
  ),
  totalFetched: z.number(),
});

export type VoiceLinkedinPostsApifyPayload = z.infer<typeof VoiceLinkedinPostsApifyPayloadSchema>;

const LINKEDIN_PROFILE_RE = /^https:\/\/(www\.)?linkedin\.com\/in\/[^/?#]+\/?$/;

// Raw shape from apimaestro/linkedin-profile-posts
interface RawPostRow {
  id?: string;
  text?: string;
  publishedAt?: string;
  totalReactionCount?: number;
  commentsCount?: number;
  repostsCount?: number;
  postUrl?: string;
  images?: string[] | null;
  video?: unknown;
  article?: { title?: string; url?: string } | null;
}

function detectMediaType(
  row: RawPostRow,
): { mediaType: 'image' | 'video' | 'article' | 'none'; mediaUrl: string | null } {
  if (row.video) {
    return { mediaType: 'video', mediaUrl: null };
  }
  if (row.article?.url) {
    return { mediaType: 'article', mediaUrl: row.article.url };
  }
  if (row.images && row.images.length > 0) {
    return { mediaType: 'image', mediaUrl: row.images[0]! };
  }
  return { mediaType: 'none', mediaUrl: null };
}

function mapPost(row: RawPostRow) {
  const rawText = row.text ?? '';
  const { mediaType, mediaUrl } = detectMediaType(row);
  return {
    text: rawText.length > 1500 ? rawText.slice(0, 1500) : rawText,
    postedAt: row.publishedAt ?? null,
    reactionsCount: row.totalReactionCount ?? null,
    commentsCount: row.commentsCount ?? null,
    sharesCount: row.repostsCount ?? null,
    postUrl: row.postUrl ?? null,
    mediaType,
    mediaUrl,
  };
}

export function makeVoiceLinkedinPostsApifyAdapter(deps: {
  serper: (env: Env) => SerperClient;
  apify: (env: Env) => ApifyClient;
}): Adapter<VoiceLinkedinPostsApifyPayload> {
  const USD_INR_DEFAULT = 84;

  return {
    name: 'voice.linkedin_posts_apify',
    module: 'voice',
    version: '0.1.0',
    estimatedCostInr: 100,
    requiredEnv: ['APIFY_TOKEN', 'SERPER_API_KEY'],
    cacheTtlMs: 6 * 60 * 60 * 1000,
    schema: VoiceLinkedinPostsApifyPayloadSchema,

    async run(ctx: AdapterContext): Promise<AdapterResult<VoiceLinkedinPostsApifyPayload>> {
      const t0 = Date.now();
      let totalCostPaise = 0;

      try {
        const apify = deps.apify(ctx.env);

        // Step 1: Discover or use provided LinkedIn profile URL
        let profileUrl: string | null = ctx.input.founderLinkedinUrl ?? null;

        if (!profileUrl) {
          // Need Serper to find the founder's LinkedIn profile URL
          const serper = deps.serper(ctx.env);
          const founder = ctx.input.founder ?? ctx.input.name;
          const q = `site:linkedin.com/in/ "${founder}"`;
          const { organic, costPaise: serperCost } = await serper.search({ q, signal: ctx.signal });
          totalCostPaise += serperCost;

          profileUrl =
            organic.map((r) => r.link).find((link) => LINKEDIN_PROFILE_RE.test(link)) ?? null;
        }

        if (!profileUrl) {
          return {
            source: 'voice.linkedin_posts_apify',
            fetchedAt: new Date().toISOString(),
            status: 'empty',
            payload: null,
            costPaise: totalCostPaise,
            durationMs: Date.now() - t0,
            errors: ['no founder URL'],
          };
        }

        // Step 2: Run Apify actor to get posts
        const { items, costUsd } = await apify.runActor<RawPostRow>({
          actor: 'apimaestro/linkedin-profile-posts',
          input: { profileUrl, limit: 50 },
          costPerResultUsd: 0.005,
          maxResults: 50,
          signal: ctx.signal,
        });

        const usdToInr = parseFloat(ctx.env.USD_INR_RATE ?? String(USD_INR_DEFAULT));
        const apifyCostPaise = Math.round(costUsd * usdToInr * 100);
        totalCostPaise += apifyCostPaise;

        const posts = items.map(mapPost);

        return {
          source: 'voice.linkedin_posts_apify',
          fetchedAt: new Date().toISOString(),
          status: items.length > 0 ? 'ok' : 'empty',
          payload: {
            founderLinkedinUrl: profileUrl,
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
          source: 'voice.linkedin_posts_apify',
          fetchedAt: new Date().toISOString(),
          status: 'error',
          payload: null,
          errors: [`linkedin_posts_apify: ${(err as Error).message}`],
          costPaise: totalCostPaise,
          durationMs: Date.now() - t0,
        };
      }
    },
  };
}

export const voiceLinkedinPostsApifyAdapter = makeVoiceLinkedinPostsApifyAdapter({
  serper: (env: Env) => createSerperClient({ apiKey: env.SERPER_API_KEY ?? '' }),
  apify: (env: Env) => createApifyClient({ token: env.APIFY_TOKEN ?? '' }),
});
