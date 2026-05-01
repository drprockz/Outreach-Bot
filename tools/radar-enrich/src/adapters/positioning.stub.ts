import { z } from 'zod';
import type { Adapter, AdapterContext, AdapterResult } from '../types.js';

// Documented intent (when implemented):
// Sources: Serper news (SERPER_API_KEY), Brave Search news (BRAVE_API_KEY),
// Crunchbase via Serper snippets, Meta Ad Library URL (returned, not scraped),
// Google Ads Transparency URL.

export const positioningStub: Adapter<null> = {
  name: 'positioning',
  version: '0.1.0',
  estimatedCostPaise: 0,
  requiredEnv: [],
  schema: z.null(),
  async run(_ctx: AdapterContext): Promise<AdapterResult<null>> {
    return {
      source: 'positioning',
      fetchedAt: new Date().toISOString(),
      status: 'empty',
      payload: null,
      costPaise: 0,
      durationMs: 0,
    };
  },
};
