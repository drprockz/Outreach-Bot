import { z } from 'zod';
import type { Adapter, AdapterContext, AdapterResult } from '../types.js';

// Documented intent (when implemented):
// Sources: Listen Notes API (LISTEN_NOTES_KEY), YouTube RSS for known channel IDs,
// Substack/Medium discovery via Serper, LinkedIn /pulse/ articles via Serper.
// Founder name resolution chain via Serper if --founder not provided.

export const voiceStub: Adapter<null> = {
  name: 'voice',
  version: '0.1.0',
  estimatedCostPaise: 0,
  requiredEnv: [],
  schema: z.null(),
  async run(_ctx: AdapterContext): Promise<AdapterResult<null>> {
    return {
      source: 'voice',
      fetchedAt: new Date().toISOString(),
      status: 'empty',
      payload: null,
      costPaise: 0,
      durationMs: 0,
    };
  },
};
