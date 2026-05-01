import { z } from 'zod';
import * as cheerio from 'cheerio';
import type { Adapter, AdapterContext, AdapterResult } from '../types.js';
import { toHttpsUrl } from '../lib/domainUtils.js';

const RepoSchema = z.object({
  name: z.string(),
  description: z.string().nullable(),
  language: z.string().nullable(),
  stars: z.number().int().nonnegative(),
  pushedAt: z.string().nullable(),
  createdAt: z.string().nullable(),
  url: z.string(),
});

const ReleaseSchema = z.object({
  repo: z.string(),
  tag: z.string(),
  title: z.string().nullable(),
  url: z.string(),
  date: z.string().nullable(),
});

const ChangelogEntrySchema = z.object({
  title: z.string(),
  date: z.string().nullable(),
  url: z.string().nullable(),
});

export const ProductPayloadSchema = z.object({
  githubOrg: z.string().nullable(),
  publicRepos: z.array(RepoSchema),
  recentNewRepos: z.array(RepoSchema),
  commitVelocity30d: z.number().int().nonnegative(),
  languageDistribution: z.record(z.string(), z.number().int().nonnegative()),
  recentReleases: z.array(ReleaseSchema),
  changelogEntries: z.array(ChangelogEntrySchema),
});

export type ProductPayload = z.infer<typeof ProductPayloadSchema>;

export const productAdapter: Adapter<ProductPayload> = {
  name: 'product',
  version: '0.1.0',
  estimatedCostPaise: 0,
  requiredEnv: ['GITHUB_TOKEN'],
  schema: ProductPayloadSchema,
  async run(ctx: AdapterContext): Promise<AdapterResult<ProductPayload>> {
    const t0 = Date.now();
    const errors: string[] = [];
    let githubOrg: string | null = null;
    let publicRepos: ProductPayload['publicRepos'] = [];
    let recentReleases: ProductPayload['recentReleases'] = [];
    let commitVelocity30d = 0;

    try {
      githubOrg = await findGithubOrg(ctx);
      if (githubOrg) {
        publicRepos = await fetchRepos(ctx, githubOrg);
        const events = await fetchEvents(ctx, githubOrg);
        commitVelocity30d = events.filter((e) => e.type === 'PushEvent' && isWithinDays(e.created_at, 30)).length;
        recentReleases = events
          .filter((e) => e.type === 'ReleaseEvent' && isWithinDays(e.created_at, 14))
          .map((e) => ({
            repo: e.repo?.name ?? '',
            tag: e.payload?.release?.tag_name ?? '',
            title: e.payload?.release?.name ?? null,
            url: e.payload?.release?.html_url ?? '',
            date: e.created_at,
          }));
      }
    } catch (err) {
      errors.push(`github: ${(err as Error).message}`);
    }

    const changelogEntries = await fetchChangelog(ctx).catch((err) => {
      errors.push(`changelog: ${(err as Error).message}`);
      return [] as ProductPayload['changelogEntries'];
    });

    const haveAnything = githubOrg !== null || changelogEntries.length > 0;
    if (!haveAnything) {
      return {
        source: 'product', fetchedAt: new Date().toISOString(),
        status: 'error', payload: null, errors,
        costPaise: 0, durationMs: Date.now() - t0,
      };
    }

    const recentNewRepos = publicRepos.filter((r) => r.createdAt && isWithinDays(r.createdAt, 30));
    const languageDistribution: Record<string, number> = {};
    for (const r of publicRepos) {
      if (r.language) languageDistribution[r.language] = (languageDistribution[r.language] ?? 0) + 1;
    }

    const status = errors.length > 0 ? 'partial' : 'ok';
    return {
      source: 'product',
      fetchedAt: new Date().toISOString(),
      status,
      payload: { githubOrg, publicRepos, recentNewRepos, commitVelocity30d, languageDistribution, recentReleases, changelogEntries },
      errors: errors.length > 0 ? errors : undefined,
      costPaise: 0,
      durationMs: Date.now() - t0,
    };
  },
};

async function findGithubOrg(ctx: AdapterContext): Promise<string | null> {
  const q = encodeURIComponent(`${ctx.input.name} type:org`);
  const res = await ctx.http(`https://api.github.com/search/users?q=${q}`, {
    headers: { authorization: `token ${ctx.env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json' },
    signal: ctx.signal,
  });
  if (!res.ok) throw new Error(`search http ${res.status}`);
  const json = await res.json() as { items?: Array<{ login: string; type: string }> };
  const org = (json.items ?? []).find((i) => i.type === 'Organization');
  return org?.login ?? null;
}

async function fetchRepos(ctx: AdapterContext, org: string): Promise<ProductPayload['publicRepos']> {
  const res = await ctx.http(`https://api.github.com/orgs/${org}/repos?per_page=100&sort=pushed`, {
    headers: { authorization: `token ${ctx.env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json' },
    signal: ctx.signal,
  });
  if (!res.ok) throw new Error(`repos http ${res.status}`);
  const json = await res.json() as Array<{ name: string; description: string | null; language: string | null; stargazers_count: number; pushed_at: string | null; created_at: string | null; html_url: string }>;
  return json.map((r) => ({
    name: r.name,
    description: r.description,
    language: r.language,
    stars: r.stargazers_count,
    pushedAt: r.pushed_at,
    createdAt: r.created_at,
    url: r.html_url,
  }));
}

interface GhEvent {
  type: string;
  created_at: string;
  repo?: { name: string };
  payload?: { release?: { tag_name?: string; name?: string; html_url?: string } };
}

async function fetchEvents(ctx: AdapterContext, org: string): Promise<GhEvent[]> {
  const res = await ctx.http(`https://api.github.com/users/${org}/events?per_page=100`, {
    headers: { authorization: `token ${ctx.env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json' },
    signal: ctx.signal,
  });
  if (!res.ok) throw new Error(`events http ${res.status}`);
  return await res.json() as GhEvent[];
}

async function fetchChangelog(ctx: AdapterContext): Promise<ProductPayload['changelogEntries']> {
  const candidates = ['/changelog', '/blog', '/release-notes', '/whats-new'];
  for (const path of candidates) {
    try {
      const url = toHttpsUrl(ctx.input.domain, path);
      const res = await ctx.http(url, { signal: ctx.signal });
      if (!res.ok) continue;
      const html = await res.text();
      const $ = cheerio.load(html);
      const entries: ProductPayload['changelogEntries'] = [];
      $('article, .post, .entry, h2, h3').each((_, el) => {
        const heading = $(el).find('h1, h2, h3').first().text().trim() || $(el).text().trim();
        const time = $(el).find('time').attr('datetime') ?? null;
        const link = $(el).find('a').first().attr('href') ?? null;
        if (heading && heading.length < 200) {
          entries.push({ title: heading, date: time, url: link });
        }
      });
      if (entries.length > 0) return entries.slice(0, 20);
    } catch { /* try next candidate */ }
  }
  return [];
}

function isWithinDays(iso: string, days: number): boolean {
  const t = Date.parse(iso);
  if (isNaN(t)) return false;
  return (Date.now() - t) / 86400000 <= days;
}
