import { z } from 'zod';
import type { Adapter, AdapterContext, AdapterResult } from '../../types.js';

export const AdsMetaLibraryUrlPayloadSchema = z.object({
  url: z.string().url(),
});

export type AdsMetaLibraryUrlPayload = z.infer<typeof AdsMetaLibraryUrlPayloadSchema>;

export const adsMetaLibraryUrlAdapter: Adapter<AdsMetaLibraryUrlPayload> = {
  name: 'ads.meta_library_url',
  module: 'ads',
  version: '0.1.0',
  estimatedCostInr: 0,
  requiredEnv: [],
  schema: AdsMetaLibraryUrlPayloadSchema,
  async run(ctx: AdapterContext): Promise<AdapterResult<AdsMetaLibraryUrlPayload>> {
    const t0 = Date.now();
    const url = `https://www.facebook.com/ads/library/?active_status=all&search_type=keyword_unordered&q=${encodeURIComponent(ctx.input.name)}&country=ALL`;
    return {
      source: 'ads.meta_library_url',
      fetchedAt: new Date().toISOString(),
      status: 'ok',
      payload: { url },
      costPaise: 0,
      durationMs: Date.now() - t0,
    };
  },
};
