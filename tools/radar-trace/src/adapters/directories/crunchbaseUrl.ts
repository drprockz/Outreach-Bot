/**
 * directories.crunchbase_url — Crunchbase URL constructor (no fetch).
 *
 * Constructs the Crunchbase organization URL from the company name.
 * No API call — the URL is deterministic from the slug.
 *
 * Note: `positioning.crunchbase_snippet` (Chunk 4) fetches actual data via
 * Serper SERP. This adapter emits just the canonical deep-link for dashboard
 * display and manual verification.
 */
import { z } from 'zod';
import type { Adapter, AdapterContext, AdapterResult } from '../../types.js';

export const CrunchbaseUrlPayloadSchema = z.object({
  url: z.string().url(),
});

export type CrunchbaseUrlPayload = z.infer<typeof CrunchbaseUrlPayloadSchema>;

export function buildCrunchbaseSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export const crunchbaseUrlAdapter: Adapter<CrunchbaseUrlPayload> = {
  name: 'directories.crunchbase_url',
  module: 'directories',
  version: '0.1.0',
  estimatedCostInr: 0,
  requiredEnv: [],
  schema: CrunchbaseUrlPayloadSchema,

  async run(ctx: AdapterContext): Promise<AdapterResult<CrunchbaseUrlPayload>> {
    const t0 = Date.now();
    const slug = buildCrunchbaseSlug(ctx.input.name);
    const url = `https://www.crunchbase.com/organization/${slug}`;

    return {
      source: 'directories.crunchbase_url',
      fetchedAt: new Date().toISOString(),
      status: 'ok',
      payload: { url },
      costPaise: 0,
      durationMs: Date.now() - t0,
    };
  },
};
