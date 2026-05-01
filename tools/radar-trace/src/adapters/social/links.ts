import { z } from 'zod';
import * as cheerio from 'cheerio';
import type { Adapter, AdapterContext, AdapterResult } from '../../types.js';
import { toHttpsUrl } from '../../lib/domainUtils.js';

export const SocialLinksPayloadSchema = z.object({
  linkedinCompany: z.string().url().nullable(),
  twitter: z.string().url().nullable(),
  instagram: z.string().url().nullable(),
  facebook: z.string().url().nullable(),
  youtube: z.string().url().nullable(),
  otherSocial: z.array(z.string().url()),
});

export type SocialLinksPayload = z.infer<typeof SocialLinksPayloadSchema>;

const OTHER_SOCIAL_HOSTS = [
  'github.com',
  'mastodon.social',
  'bsky.app',
  'threads.net',
  'discord.com',
  'discord.gg',
  'slack.com',
  'medium.com',
  'dev.to',
  'producthunt.com',
  'crunchbase.com',
  'angel.co',
];

function categorizeHref(href: string): {
  category: 'linkedinCompany' | 'twitter' | 'instagram' | 'facebook' | 'youtube' | 'other' | null;
  url: string;
} {
  let parsed: URL;
  try {
    parsed = new URL(href);
  } catch {
    return { category: null, url: href };
  }

  const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
  const path = parsed.pathname;

  if (host === 'linkedin.com') {
    // company page — skip /in/ (founder profile)
    if (path.startsWith('/company/')) return { category: 'linkedinCompany', url: href };
    return { category: null, url: href };
  }
  if (host === 'twitter.com' || host === 'x.com') {
    return { category: 'twitter', url: href };
  }
  if (host === 'instagram.com') {
    return { category: 'instagram', url: href };
  }
  if (host === 'facebook.com') {
    return { category: 'facebook', url: href };
  }
  if (host === 'youtube.com' || host === 'youtu.be') {
    // skip @handle patterns — those belong to voice.youtube_channel
    if (path.startsWith('/@')) return { category: null, url: href };
    return { category: 'youtube', url: href };
  }
  // Other social platforms
  if (OTHER_SOCIAL_HOSTS.some((h) => host === h || host.endsWith('.' + h))) {
    return { category: 'other', url: href };
  }
  return { category: null, url: href };
}

export function extractSocialLinks(html: string): SocialLinksPayload {
  const $ = cheerio.load(html);
  const result: SocialLinksPayload = {
    linkedinCompany: null,
    twitter: null,
    instagram: null,
    facebook: null,
    youtube: null,
    otherSocial: [],
  };
  const otherSeen = new Set<string>();

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    if (!href.startsWith('http')) return;
    const { category, url } = categorizeHref(href);
    if (!category) return;
    if (category === 'other') {
      if (!otherSeen.has(url)) {
        otherSeen.add(url);
        result.otherSocial.push(url);
      }
    } else if (!result[category]) {
      result[category] = url;
    }
  });
  return result;
}

export const socialLinksAdapter: Adapter<SocialLinksPayload> = {
  name: 'social.links',
  module: 'social',
  version: '0.1.0',
  estimatedCostInr: 0,
  requiredEnv: [],
  schema: SocialLinksPayloadSchema,
  async run(ctx: AdapterContext): Promise<AdapterResult<SocialLinksPayload>> {
    const t0 = Date.now();
    try {
      const homepageUrl = toHttpsUrl(ctx.input.domain, '/');
      const res = await ctx.http(homepageUrl, { signal: ctx.signal });
      if (!res.ok) {
        return {
          source: 'social.links',
          fetchedAt: new Date().toISOString(),
          status: 'error',
          payload: null,
          errors: [`social.links: homepage http ${res.status}`],
          costPaise: 0,
          durationMs: Date.now() - t0,
        };
      }
      const html = await res.text();
      const payload = extractSocialLinks(html);
      const hasAny = payload.linkedinCompany || payload.twitter || payload.instagram ||
        payload.facebook || payload.youtube || payload.otherSocial.length > 0;
      return {
        source: 'social.links',
        fetchedAt: new Date().toISOString(),
        status: hasAny ? 'ok' : 'empty',
        payload,
        costPaise: 0,
        durationMs: Date.now() - t0,
      };
    } catch (err) {
      return {
        source: 'social.links',
        fetchedAt: new Date().toISOString(),
        status: 'error',
        payload: null,
        errors: [`social.links: ${(err as Error).message}`],
        costPaise: 0,
        durationMs: Date.now() - t0,
      };
    }
  },
};
