import type { z } from 'zod';

export interface Logger {
  debug: (msg: string, obj?: Record<string, unknown>) => void;
  info: (msg: string, obj?: Record<string, unknown>) => void;
  warn: (msg: string, obj?: Record<string, unknown>) => void;
  error: (msg: string, obj?: Record<string, unknown>) => void;
  child: (bindings: Record<string, unknown>) => Logger;
}

export interface Cache {
  /** Returns cached AdapterResult if a fresh entry exists for today, else null. Accepts optional TTL override. */
  read<T>(key: CacheKey, ttlMs?: number): Promise<AdapterResult<T> | null>;
  /** Writes the AdapterResult under the key. Idempotent (overwrites). */
  write<T>(key: CacheKey, value: AdapterResult<T>): Promise<void>;
  /** Deletes every cache file. Used by --clear-cache. */
  clear(): Promise<void>;
}

export interface CacheKey {
  adapterName: string;
  adapterVersion: string;
  inputHash: string;       // sha256 of normalized Company input, truncated to 12 chars
  date: string;            // YYYYMMDD
}

/** Company input — primary identifier for enrichment. */
export interface Company {
  name: string;
  domain: string;
  location?: string;
  founder?: string;
  founderLinkedinUrl?: string;
}

/** Runtime context handed to every adapter's run() — all I/O dependencies are here. */
export interface AdapterContext {
  input: Company;
  http: typeof fetch;       // wrapped fetch w/ timeout + retry; injectable for tests
  cache: Cache;
  logger: Logger;
  env: Env;
  signal: AbortSignal;      // from orchestrator's per-adapter timeout
  /**
   * Canonical anchors discovered from the company's own website (Wave 0).
   * Populated by the orchestrator before any adapter runs. Adapters that can be
   * grounded by a domain-owned URL should prefer the anchor over a name search.
   * Always present (never undefined) — uses EMPTY_ANCHORS when discovery yields nothing.
   */
  anchors: CanonicalAnchors;
}

/**
 * Founder identified on the company's site (about/team/contact pages).
 * `linkedinUrl` is only set if the founder's LinkedIn profile was self-linked
 * from the website — never inferred from a name search. Avoids the "founder
 * named John Smith → first John Smith on LinkedIn" disambiguation failure.
 */
export interface AnchorFounder {
  name: string;
  title: string | null;
  linkedinUrl: string | null;
}

/**
 * Canonical entity anchors. Each URL was either present in the website HTML
 * (regex-extracted from <a href>) or confirmed by an LLM read of the homepage
 * + about/team pages. The provenance is tracked in `discoveredVia` for
 * observability — `gemini` means LLM, `regex` means deterministic extraction
 * only, `mixed` means both contributed, `none` means we couldn't ground at all.
 */
export interface CanonicalAnchors {
  linkedinCompanyUrl: string | null;
  twitterUrl: string | null;
  youtubeChannelUrl: string | null;
  githubOrgUrl: string | null;
  crunchbaseUrl: string | null;
  instagramUrl: string | null;
  facebookUrl: string | null;
  founders: AnchorFounder[];
  companyDescription: string | null;
  primaryProductOrService: string | null;
  industryOneLiner: string | null;
  /** Pages successfully fetched during discovery — debugging aid. */
  pagesFetched: string[];
  /** How each field was sourced. */
  discoveredVia: 'gemini' | 'regex' | 'mixed' | 'none';
  /** Discovery cost in paise (Gemini call, ₹0 on free tier). */
  costPaise: number;
  /** Errors encountered during discovery — non-fatal. */
  errors: string[];
}

export const EMPTY_ANCHORS: CanonicalAnchors = {
  linkedinCompanyUrl: null,
  twitterUrl: null,
  youtubeChannelUrl: null,
  githubOrgUrl: null,
  crunchbaseUrl: null,
  instagramUrl: null,
  facebookUrl: null,
  founders: [],
  companyDescription: null,
  primaryProductOrService: null,
  industryOneLiner: null,
  pagesFetched: [],
  discoveredVia: 'none',
  costPaise: 0,
  errors: [],
};

/** Every keyed env var the prototype recognizes. Adapters declare which ones they require. */
export interface Env {
  ADZUNA_APP_ID?: string;
  ADZUNA_APP_KEY?: string;
  GITHUB_TOKEN?: string;
  ANTHROPIC_API_KEY?: string;
  SERPER_API_KEY?: string;
  BRAVE_API_KEY?: string;
  LISTEN_NOTES_KEY?: string;
  ANTHROPIC_DISABLED?: string;  // honored by reused Stage 10 code
  PAGESPEED_API_KEY?: string;
  APIFY_TOKEN?: string;
  USD_INR_RATE?: string;
  GEMINI_API_KEY?: string;
}

export type AdapterStatus = 'ok' | 'partial' | 'empty' | 'error';

export interface AdapterResult<T> {
  source: string;
  fetchedAt: string;        // ISO timestamp
  status: AdapterStatus;
  payload: T | null;
  errors?: string[];
  costPaise: number;        // visibility only; no enforcement
  durationMs: number;
  /** Optional extra cost detail — used by Apify adapters for USD reconciliation. */
  costMeta?: {
    apifyResults?: number;
    costUsd?: number;
  };
  /** How this result was grounded to the target entity. Absent on adapters that don't need disambiguation (whois, dns, crtsh, etc.). */
  verification?: AdapterVerification;
}

/**
 * Provenance of a name-disambiguated result.
 * - `anchor` — the result came from a domain-owned URL (highest confidence).
 * - `llm`    — the result came from a name search and an LLM verified the match.
 * - `none`   — the result is anchor-or-input-derived and didn't need verification
 *              (e.g. an explicit `--linkedin <url>` shortcut).
 */
export interface AdapterVerification {
  method: 'anchor' | 'llm' | 'none';
  /** 0..1. 1.0 for `anchor`. LLM scores are clamped into this range. */
  confidence: number;
  /** Free-text reason from the LLM, or anchor source description. */
  reason?: string;
  /** USD cost incurred during verification (LLM only). */
  costUsd?: number;
  /** How many name-search candidates were rejected by the verifier. */
  droppedCandidates?: number;
}

export interface Adapter<TPayload> {
  readonly name: string;
  readonly version: string;
  /** Logical module this adapter belongs to. */
  readonly module: ModuleName;
  /** Estimated INR cost per run. */
  readonly estimatedCostInr: number;
  readonly requiredEnv: readonly (keyof Env)[];
  readonly schema: z.ZodType<TPayload>;
  run(ctx: AdapterContext): Promise<AdapterResult<TPayload>>;

  /** Optional per-adapter TTL override; default 24h. */
  readonly cacheTtlMs?: number;

  /** Optional per-adapter timeout override in ms; default is the CLI --timeout (30 000). */
  readonly timeoutMs?: number;

  /**
   * Optional gate. If returns false, adapter is skipped (status:'empty', cost:0).
   * Receives Wave 1 partial dossier. Throws caught and treated as `false`.
   */
  gate?(partial: PartialDossier): boolean;
}

/** Logical groupings — adapters declare which one they belong to. */
export type ModuleName =
  | 'hiring' | 'product' | 'customer' | 'voice' | 'operational'
  | 'positioning' | 'social' | 'ads' | 'directories';

/**
 * Read-only snapshot of Wave 1 results for use by Wave 2 gate predicates.
 * Every Wave 1 adapter is present, including ones with status:'error' (payload null)
 * or status:'empty'. Gate predicates MUST defensively handle null payloads.
 */
export type PartialDossier = Readonly<Record<string, AdapterResult<unknown>>>;
