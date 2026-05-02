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
}

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
