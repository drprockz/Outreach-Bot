import { z } from 'zod';
import type { Env } from './types.js';

const EnvSchema = z.object({
  ADZUNA_APP_ID: z.string().min(1).optional(),
  ADZUNA_APP_KEY: z.string().min(1).optional(),
  GITHUB_TOKEN: z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  SERPER_API_KEY: z.string().min(1).optional(),
  BRAVE_API_KEY: z.string().min(1).optional(),
  LISTEN_NOTES_KEY: z.string().min(1).optional(),
  ANTHROPIC_DISABLED: z.string().min(1).optional(),
});

export const ENV_REGISTRATION_URLS: Record<keyof Env, string> = {
  ADZUNA_APP_ID: 'https://developer.adzuna.com/',
  ADZUNA_APP_KEY: 'https://developer.adzuna.com/',
  GITHUB_TOKEN: 'https://github.com/settings/tokens',
  ANTHROPIC_API_KEY: 'https://console.anthropic.com/',
  SERPER_API_KEY: 'https://serper.dev/',
  BRAVE_API_KEY: 'https://api.search.brave.com/',
  LISTEN_NOTES_KEY: 'https://www.listennotes.com/api/',
  ANTHROPIC_DISABLED: '(internal flag — not registered)',
};

/**
 * Parse a raw env-shaped object into a strongly-typed Env. Empty strings are
 * treated as unset so a stale `KEY=` line in .env doesn't masquerade as present.
 * Unknown keys are dropped (zod's default `strip` behavior on z.object).
 */
export function loadEnv(raw: NodeJS.ProcessEnv | Record<string, string | undefined>): Env {
  const cleaned: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v !== '' && v !== undefined) cleaned[k] = v;
  }
  return EnvSchema.parse(cleaned);
}

/**
 * Throws a single descriptive error listing every missing required key for the
 * given adapter, with each key's registration URL. Caller catches and surfaces.
 */
export function assertRequiredEnv(env: Env, adapterName: string, required: readonly (keyof Env)[]): void {
  const missing = required.filter((k) => !env[k]);
  if (missing.length === 0) return;
  const lines = missing.map((k) => `  - ${k}  →  ${ENV_REGISTRATION_URLS[k]}`);
  throw new Error(
    `Adapter "${adapterName}" requires env vars that are missing or empty:\n${lines.join('\n')}`,
  );
}
