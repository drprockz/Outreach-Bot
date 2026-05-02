import { z } from 'zod';

export const RepoSchema = z.object({
  name: z.string(),
  description: z.string().nullable(),
  language: z.string().nullable(),
  stars: z.number().int().nonnegative(),
  pushedAt: z.string().nullable(),
  createdAt: z.string().nullable(),
  url: z.string(),
});

export const ReleaseSchema = z.object({
  repo: z.string(),
  tag: z.string(),
  title: z.string().nullable(),
  url: z.string(),
  date: z.string().nullable(),
});

export const ChangelogEntrySchema = z.object({
  title: z.string(),
  date: z.string().nullable(),
  url: z.string().nullable(),
});

export type Repo = z.infer<typeof RepoSchema>;
export type Release = z.infer<typeof ReleaseSchema>;
export type ChangelogEntry = z.infer<typeof ChangelogEntrySchema>;

export interface GhEvent {
  type: string;
  created_at: string;
  repo?: { name: string };
  payload?: { release?: { tag_name?: string; name?: string; html_url?: string } };
}

export function isWithinDays(iso: string, days: number): boolean {
  const t = Date.parse(iso);
  if (isNaN(t)) return false;
  return (Date.now() - t) / 86400000 <= days;
}

/** Shared GitHub org search — inlined per-adapter to avoid Wave 2 dependency.
 * Decision: each adapter that needs the org calls this independently.
 * GitHub search is cheap and rate-limit-tolerant. The redundancy is acceptable
 * for Phase 1A; the orchestrator's Wave 1 parallelism runs them concurrently.
 * NOTE: prefer `githubOrgFromUrl(ctx.anchors.githubOrgUrl)` first — this is the
 * unverified name-search fallback. */
export async function findGithubOrg(ctx: { input: { name: string }; http: typeof fetch; env: { GITHUB_TOKEN?: string }; signal: AbortSignal }): Promise<string | null> {
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

const GH_ORG_PATH_RE = /^https:\/\/github\.com\/([^/?#]+)\/?$/i;

/** Extract the org slug from a github.com/<org> URL. Returns null for repos, gists, anything else. */
export function githubOrgFromUrl(url: string | null): string | null {
  if (!url) return null;
  const m = GH_ORG_PATH_RE.exec(url);
  return m?.[1] ?? null;
}

/** Verify that a GitHub login is actually an org account (not a user) before trusting an anchor. */
export async function isGithubOrg(
  ctx: { http: typeof fetch; env: { GITHUB_TOKEN?: string }; signal: AbortSignal },
  login: string,
): Promise<boolean> {
  try {
    const res = await ctx.http(`https://api.github.com/users/${encodeURIComponent(login)}`, {
      headers: { authorization: `token ${ctx.env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json' },
      signal: ctx.signal,
    });
    if (!res.ok) return false;
    const j = await res.json() as { type?: string };
    return j.type === 'Organization';
  } catch {
    return false;
  }
}

export async function fetchRepos(ctx: { http: typeof fetch; env: { GITHUB_TOKEN?: string }; signal: AbortSignal }, org: string): Promise<Repo[]> {
  const res = await ctx.http(`https://api.github.com/orgs/${org}/repos?per_page=100&sort=pushed`, {
    headers: { authorization: `token ${ctx.env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json' },
    signal: ctx.signal,
  });
  if (!res.ok) throw new Error(`repos http ${res.status}`);
  const json = await res.json() as Array<{
    name: string; description: string | null; language: string | null;
    stargazers_count: number; pushed_at: string | null; created_at: string | null; html_url: string;
  }>;
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

export async function fetchEvents(ctx: { http: typeof fetch; env: { GITHUB_TOKEN?: string }; signal: AbortSignal }, org: string): Promise<GhEvent[]> {
  const res = await ctx.http(`https://api.github.com/users/${org}/events?per_page=100`, {
    headers: { authorization: `token ${ctx.env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json' },
    signal: ctx.signal,
  });
  if (!res.ok) throw new Error(`events http ${res.status}`);
  return await res.json() as GhEvent[];
}
