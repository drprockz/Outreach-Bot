import { z } from 'zod';
import type { Adapter, AdapterContext, AdapterResult } from '../../types.js';

export const AdsGoogleTransparencyUrlPayloadSchema = z.object({
  url: z.string().url(),
});

export type AdsGoogleTransparencyUrlPayload = z.infer<typeof AdsGoogleTransparencyUrlPayloadSchema>;

export const adsGoogleTransparencyUrlAdapter: Adapter<AdsGoogleTransparencyUrlPayload> = {
  name: 'ads.google_transparency_url',
  module: 'ads',
  version: '0.1.0',
  estimatedCostInr: 0,
  requiredEnv: [],
  schema: AdsGoogleTransparencyUrlPayloadSchema,
  async run(ctx: AdapterContext): Promise<AdapterResult<AdsGoogleTransparencyUrlPayload>> {
    const t0 = Date.now();
    const url = `https://adstransparency.google.com/?domain=${encodeURIComponent(ctx.input.domain)}&region=anywhere`;
    return {
      source: 'ads.google_transparency_url',
      fetchedAt: new Date().toISOString(),
      status: 'ok',
      payload: { url },
      costPaise: 0,
      durationMs: Date.now() - t0,
    };
  },
};
