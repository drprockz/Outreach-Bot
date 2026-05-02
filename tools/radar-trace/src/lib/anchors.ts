/**
 * Canonical-anchor discovery (Wave 0).
 *
 * Builds a `CanonicalAnchors` object by reading the company's own website. The
 * anchors are the ground truth that downstream adapters use to disambiguate
 * search results — without them, every adapter that searches by name picks the
 * first hit and ships whatever entity happens to share a token with the target.
 *
 * Flow:
 *  1. Fetch a small set of high-signal pages (homepage + about/team/contact).
 *  2. Run a deterministic regex pass over each page's `<a href>` set, reusing
 *     `extractSocialLinks` so we share a single source of truth for what
 *     counts as a LinkedIn / GitHub / etc. URL.
 *  3. If `GEMINI_API_KEY` is set, hand the stripped page text to Gemini for
 *     LLM-grade extraction (founders, descriptions, missing platform URLs).
 *  4. Merge: regex wins for URLs (they were physically on the page); Gemini
 *     wins for free-text fields (description, founder names, industry blurb).
 *  5. On any failure, return the regex-only anchors with `discoveredVia:
 *     'regex'` (or 'none' if regex also yielded nothing). Never throw — the
 *     trace must keep running in degraded mode.
 */
import * as cheerio from 'cheerio';
import { z } from 'zod';
import { extractSocialLinks } from '../adapters/social/links.js';
import { toHttpsUrl, normalizeDomain } from './domainUtils.js';
import { createGeminiClient, type GeminiClient } from './ai/gemini.js';
import {
  EMPTY_ANCHORS,
  type AnchorFounder,
  type CanonicalAnchors,
  type Env,
} from '../types.js';

const ANCHOR_PATHS = ['/', '/about', '/about-us', '/company', '/team', '/our-team', '/contact'];
const PAGE_FETCH_TIMEOUT_MS = 8000;
const MAX_TEXT_PER_PAGE = 6000;
const MAX_TEXT_TOTAL = 18000;

const GITHUB_ORG_RE = /^https:\/\/github\.com\/([^/?#]+)\/?$/;
const CRUNCHBASE_ORG_RE = /^https:\/\/(www\.)?crunchbase\.com\/organization\/[^/?#]+\/?$/;

const GeminiAnchorJsonSchema = z.object({
  linkedinCompanyUrl: z.string().nullable().optional(),
  twitterUrl: z.string().nullable().optional(),
  youtubeChannelUrl: z.string().nullable().optional(),
  githubOrgUrl: z.string().nullable().optional(),
  crunchbaseUrl: z.string().nullable().optional(),
  instagramUrl: z.string().nullable().optional(),
  facebookUrl: z.string().nullable().optional(),
  founders: z
    .array(
      z.object({
        name: z.string(),
        title: z.string().nullable().optional(),
        linkedinUrl: z.string().nullable().optional(),
      }),
    )
    .optional(),
  companyDescription: z.string().nullable().optional(),
  primaryProductOrService: z.string().nullable().optional(),
  industryOneLiner: z.string().nullable().optional(),
});

interface FetchedPage {
  url: string;
  status: number;
  html: string;
}

export interface DiscoverAnchorsOptions {
  domain: string;
  companyName: string;
  env: Env;
  http: typeof fetch;
  signal?: AbortSignal;
  /** Inject for tests. Defaults to a real Gemini REST client. */
  gemini?: GeminiClient;
  /** When false, skip the LLM step entirely and return regex-only anchors. */
  useLlm?: boolean;
}

/** Strip HTML to text — cheerio + heuristic compaction for LLM token budget. */
function htmlToText(html: string, maxLen: number): string {
  const $ = cheerio.load(html);
  $('script, style, noscript, svg').remove();
  let text = $('body').text();
  text = text.replace(/\s+/g, ' ').trim();
  if (text.length > maxLen) text = text.slice(0, maxLen);
  return text;
}

/** Pull regex-grade anchors out of all fetched pages — purely deterministic. */
function regexAnchors(pages: FetchedPage[]): {
  partial: Partial<CanonicalAnchors>;
  found: number;
} {
  const partial: Partial<CanonicalAnchors> = {
    linkedinCompanyUrl: null,
    twitterUrl: null,
    youtubeChannelUrl: null,
    githubOrgUrl: null,
    crunchbaseUrl: null,
    instagramUrl: null,
    facebookUrl: null,
    founders: [],
  };
  let found = 0;
  for (const page of pages) {
    if (!page.html) continue;
    const links = extractSocialLinks(page.html);
    if (links.linkedinCompany && !partial.linkedinCompanyUrl) {
      partial.linkedinCompanyUrl = links.linkedinCompany;
      found++;
    }
    if (links.twitter && !partial.twitterUrl) {
      partial.twitterUrl = links.twitter;
      found++;
    }
    if (links.youtube && !partial.youtubeChannelUrl) {
      partial.youtubeChannelUrl = links.youtube;
      found++;
    }
    if (links.instagram && !partial.instagramUrl) {
      partial.instagramUrl = links.instagram;
      found++;
    }
    if (links.facebook && !partial.facebookUrl) {
      partial.facebookUrl = links.facebook;
      found++;
    }
    for (const otherUrl of links.otherSocial) {
      const ghMatch = GITHUB_ORG_RE.exec(otherUrl);
      if (ghMatch && !partial.githubOrgUrl) {
        partial.githubOrgUrl = otherUrl;
        found++;
      }
      if (CRUNCHBASE_ORG_RE.test(otherUrl) && !partial.crunchbaseUrl) {
        partial.crunchbaseUrl = otherUrl;
        found++;
      }
    }
    // Surface YouTube /@handle links too — extractSocialLinks skips those, but
    // they're the canonical channel URL form on most modern marketing sites.
    if (!partial.youtubeChannelUrl) {
      const $ = cheerio.load(page.html);
      $('a[href]').each((_, el) => {
        const href = $(el).attr('href') ?? '';
        if (/^https?:\/\/(www\.)?youtube\.com\/@[^/?#]+/i.test(href) && !partial.youtubeChannelUrl) {
          partial.youtubeChannelUrl = href.replace(/^http:/, 'https:');
          found++;
        }
      });
    }
  }
  return { partial, found };
}

async function fetchAnchorPages(
  domain: string,
  http: typeof fetch,
  parentSignal: AbortSignal | undefined,
): Promise<{ pages: FetchedPage[]; errors: string[] }> {
  const normalized = normalizeDomain(domain);
  const errors: string[] = [];
  const out: FetchedPage[] = [];

  await Promise.all(
    ANCHOR_PATHS.map(async (path) => {
      const url = toHttpsUrl(normalized, path);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(new Error('anchor fetch timeout')), PAGE_FETCH_TIMEOUT_MS);
      const onAbort = () => ctrl.abort(new Error('parent aborted'));
      parentSignal?.addEventListener('abort', onAbort, { once: true });
      try {
        const res = await http(url, { signal: ctrl.signal });
        if (!res.ok) {
          // 404s are expected for non-existent paths — only record non-404 issues.
          if (res.status !== 404) errors.push(`${path}: http ${res.status}`);
          return;
        }
        const ct = res.headers.get('content-type') ?? '';
        if (!ct.includes('text/html') && !ct.includes('application/xhtml')) {
          // Don't try to parse non-HTML — but homepage redirects sometimes
          // omit the header. Accept the body if it starts with a tag.
          const text = await res.text();
          if (!/^\s*</.test(text)) return;
          out.push({ url, status: res.status, html: text });
          return;
        }
        const html = await res.text();
        out.push({ url, status: res.status, html });
      } catch (err) {
        errors.push(`${path}: ${(err as Error).message}`);
      } finally {
        clearTimeout(timer);
        parentSignal?.removeEventListener('abort', onAbort);
      }
    }),
  );

  return { pages: out, errors };
}

function buildLlmPrompt(opts: {
  companyName: string;
  domain: string;
  regexCandidates: Partial<CanonicalAnchors>;
  pages: FetchedPage[];
}): string {
  const concatenated: string[] = [];
  let budgetLeft = MAX_TEXT_TOTAL;
  for (const p of opts.pages) {
    if (budgetLeft <= 0) break;
    const text = htmlToText(p.html, Math.min(MAX_TEXT_PER_PAGE, budgetLeft));
    if (!text) continue;
    concatenated.push(`### ${p.url}\n${text}`);
    budgetLeft -= text.length;
  }

  const candidatesBlock = JSON.stringify(opts.regexCandidates, null, 2);

  return [
    `You are extracting canonical entity anchors for the target company below.`,
    `TARGET:`,
    `  name:   ${opts.companyName}`,
    `  domain: ${opts.domain}`,
    ``,
    `REGEX-DERIVED CANDIDATES (already verified to be on the website):`,
    candidatesBlock,
    ``,
    `WEBSITE TEXT:`,
    concatenated.join('\n\n'),
    ``,
    `TASK: return a single JSON object with the schema below. Only include URLs ` +
      `you saw in the website text or that match the regex-derived candidates. ` +
      `Do NOT invent URLs. For founders, only include linkedinUrl if a profile ` +
      `link is present in the text — otherwise leave it null.`,
    ``,
    `SCHEMA:`,
    `{`,
    `  "linkedinCompanyUrl":     string|null,`,
    `  "twitterUrl":             string|null,`,
    `  "youtubeChannelUrl":      string|null,`,
    `  "githubOrgUrl":           string|null,`,
    `  "crunchbaseUrl":          string|null,`,
    `  "instagramUrl":           string|null,`,
    `  "facebookUrl":            string|null,`,
    `  "founders": [{ "name": string, "title": string|null, "linkedinUrl": string|null }],`,
    `  "companyDescription":     string|null,`,
    `  "primaryProductOrService": string|null,`,
    `  "industryOneLiner":       string|null`,
    `}`,
    ``,
    `Return ONLY the JSON object — no markdown, no commentary.`,
  ].join('\n');
}

function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('```')) {
    return trimmed.replace(/^```(?:json)?\s*\n/, '').replace(/\n?```\s*$/, '');
  }
  return trimmed;
}

function isValidUrl(maybe: string | null | undefined): maybe is string {
  if (!maybe) return false;
  try {
    new URL(maybe);
    return true;
  } catch {
    return false;
  }
}

function mergeAnchors(
  regex: Partial<CanonicalAnchors>,
  llm: z.infer<typeof GeminiAnchorJsonSchema> | null,
): Pick<
  CanonicalAnchors,
  | 'linkedinCompanyUrl' | 'twitterUrl' | 'youtubeChannelUrl' | 'githubOrgUrl'
  | 'crunchbaseUrl' | 'instagramUrl' | 'facebookUrl'
  | 'founders' | 'companyDescription' | 'primaryProductOrService' | 'industryOneLiner'
> {
  const pick = (regexVal: string | null | undefined, llmVal: string | null | undefined): string | null => {
    // Regex wins (it was on the actual page); LLM fills gaps.
    if (isValidUrl(regexVal ?? null)) return regexVal!;
    if (isValidUrl(llmVal ?? null)) return llmVal!;
    return null;
  };

  const founders: AnchorFounder[] = (llm?.founders ?? []).map((f) => ({
    name: f.name,
    title: f.title ?? null,
    linkedinUrl: isValidUrl(f.linkedinUrl ?? null) ? f.linkedinUrl ?? null : null,
  }));

  return {
    linkedinCompanyUrl: pick(regex.linkedinCompanyUrl, llm?.linkedinCompanyUrl ?? null),
    twitterUrl: pick(regex.twitterUrl, llm?.twitterUrl ?? null),
    youtubeChannelUrl: pick(regex.youtubeChannelUrl, llm?.youtubeChannelUrl ?? null),
    githubOrgUrl: pick(regex.githubOrgUrl, llm?.githubOrgUrl ?? null),
    crunchbaseUrl: pick(regex.crunchbaseUrl, llm?.crunchbaseUrl ?? null),
    instagramUrl: pick(regex.instagramUrl, llm?.instagramUrl ?? null),
    facebookUrl: pick(regex.facebookUrl, llm?.facebookUrl ?? null),
    founders,
    companyDescription: llm?.companyDescription ?? null,
    primaryProductOrService: llm?.primaryProductOrService ?? null,
    industryOneLiner: llm?.industryOneLiner ?? null,
  };
}

export async function discoverAnchors(opts: DiscoverAnchorsOptions): Promise<CanonicalAnchors> {
  const errors: string[] = [];

  const { pages, errors: fetchErrors } = await fetchAnchorPages(opts.domain, opts.http, opts.signal);
  errors.push(...fetchErrors);

  if (pages.length === 0) {
    return {
      ...EMPTY_ANCHORS,
      pagesFetched: [],
      errors: errors.length ? errors : ['no anchor pages fetched'],
      discoveredVia: 'none',
    };
  }

  const { partial: regexPartial, found: regexFound } = regexAnchors(pages);
  const useLlm = opts.useLlm !== false && !!opts.env.GEMINI_API_KEY;

  let llmJson: z.infer<typeof GeminiAnchorJsonSchema> | null = null;
  let costUsd = 0;
  let llmContributed = false;

  if (useLlm) {
    const gemini = opts.gemini ?? createGeminiClient(opts.env, opts.http);
    try {
      const prompt = buildLlmPrompt({
        companyName: opts.companyName,
        domain: opts.domain,
        regexCandidates: regexPartial,
        pages,
      });
      const result = await gemini.call({
        prompt,
        responseMimeType: 'application/json',
        signal: opts.signal,
      });
      costUsd = result.costUsd;
      const stripped = stripJsonFences(result.text);
      let parsed: unknown;
      try {
        parsed = JSON.parse(stripped);
      } catch {
        errors.push(`gemini: invalid JSON (got: ${stripped.slice(0, 80)})`);
        parsed = null;
      }
      if (parsed) {
        const safe = GeminiAnchorJsonSchema.safeParse(parsed);
        if (safe.success) {
          llmJson = safe.data;
          llmContributed = true;
        } else {
          errors.push(`gemini: schema mismatch — ${safe.error.message.slice(0, 200)}`);
        }
      }
    } catch (err) {
      errors.push(`gemini: ${(err as Error).message}`);
    }
  }

  const merged = mergeAnchors(regexPartial, llmJson);

  let discoveredVia: CanonicalAnchors['discoveredVia'];
  if (regexFound > 0 && llmContributed) discoveredVia = 'mixed';
  else if (llmContributed) discoveredVia = 'gemini';
  else if (regexFound > 0) discoveredVia = 'regex';
  else discoveredVia = 'none';

  // Convert costUsd → paise via the standard 84 INR/USD constant. Anchor costs
  // are measured in single-digit paise so a slightly stale FX rate is harmless.
  const costPaise = Math.round(costUsd * 84 * 100);

  return {
    ...merged,
    pagesFetched: pages.map((p) => p.url),
    discoveredVia,
    costPaise,
    errors,
  };
}
