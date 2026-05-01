import type { z } from 'zod';

export interface CompanyInput {
  name: string;
  domain: string;
  location?: string;
  founder?: string;
}

export interface Logger {
  debug: (msg: string, obj?: Record<string, unknown>) => void;
  info: (msg: string, obj?: Record<string, unknown>) => void;
  warn: (msg: string, obj?: Record<string, unknown>) => void;
  error: (msg: string, obj?: Record<string, unknown>) => void;
  child: (bindings: Record<string, unknown>) => Logger;
}

export interface Cache {
  /** Returns cached AdapterResult if a fresh entry exists for today, else null. */
  read<T>(key: CacheKey): Promise<AdapterResult<T> | null>;
  /** Writes the AdapterResult under the key. Idempotent (overwrites). */
  write<T>(key: CacheKey, value: AdapterResult<T>): Promise<void>;
  /** Deletes every cache file. Used by --clear-cache. */
  clear(): Promise<void>;
}

export interface CacheKey {
  adapterName: string;
  adapterVersion: string;
  inputHash: string;       // sha256 of normalized CompanyInput, truncated to 12 chars
  date: string;            // YYYYMMDD
}

/** Runtime context handed to every adapter's run() — all I/O dependencies are here. */
export interface AdapterContext {
  input: CompanyInput;
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
}

export interface Adapter<TPayload> {
  readonly name: string;
  readonly version: string;
  readonly estimatedCostPaise: number;
  readonly requiredEnv: readonly (keyof Env)[];
  readonly schema: z.ZodType<TPayload>;
  run(ctx: AdapterContext): Promise<AdapterResult<TPayload>>;
}
