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
  version: '0.2.0',
  estimatedCostInr: 0,
  requiredEnv: [],
  schema: CrunchbaseUrlPayloadSchema,

  async run(ctx: AdapterContext): Promise<AdapterResult<CrunchbaseUrlPayload>> {
    const t0 = Date.now();

    // Anchor-first: when the company website links to its Crunchbase profile
    // we use that exact URL. Otherwise fall back to the deterministic slug —
    // unverified, since slug collisions are common for short/common names.
    if (ctx.anchors.crunchbaseUrl) {
      return {
        source: 'directories.crunchbase_url',
        fetchedAt: new Date().toISOString(),
        status: 'ok',
        payload: { url: ctx.anchors.crunchbaseUrl },
        costPaise: 0,
        durationMs: Date.now() - t0,
        verification: { method: 'anchor', confidence: 1, reason: 'crunchbaseUrl from company website' },
      };
    }
    const slug = buildCrunchbaseSlug(ctx.input.name);
    const url = `https://www.crunchbase.com/organization/${slug}`;
    return {
      source: 'directories.crunchbase_url',
      fetchedAt: new Date().toISOString(),
      status: 'ok',
      payload: { url },
      costPaise: 0,
      durationMs: Date.now() - t0,
      verification: { method: 'none', confidence: 0.3, reason: 'derived from name slug (unverified)' },
    };
  },
};
