import { z } from 'zod';
import type { Adapter, AdapterContext, AdapterResult } from '../../types.js';
import { toHttpsUrl } from '../../lib/domainUtils.js';
import { detectTechStack } from '../../fingerprints/techstack.js';

const TechSchema = z.object({
  name: z.string(),
  category: z.string(),
  confidence: z.number(),
});

export const OperationalTechStackPayloadSchema = z.object({
  techStack: z.array(TechSchema),
});

export type OperationalTechStackPayload = z.infer<typeof OperationalTechStackPayloadSchema>;

export const operationalTechStackAdapter: Adapter<OperationalTechStackPayload> = {
  name: 'operational.tech_stack',
  module: 'operational',
  version: '0.1.0',
  estimatedCostInr: 0,
  requiredEnv: [],
  schema: OperationalTechStackPayloadSchema,
  async run(ctx: AdapterContext): Promise<AdapterResult<OperationalTechStackPayload>> {
    const t0 = Date.now();
    try {
      const res = await ctx.http(toHttpsUrl(ctx.input.domain, '/'), { signal: ctx.signal });
      if (!res.ok) throw new Error(`http ${res.status}`);
      const html = await res.text();
      const techStack = detectTechStack(html);
      return {
        source: 'operational.tech_stack',
        fetchedAt: new Date().toISOString(),
        status: techStack.length === 0 ? 'empty' : 'ok',
        payload: { techStack },
        costPaise: 0,
        durationMs: Date.now() - t0,
      };
    } catch (err) {
      return {
        source: 'operational.tech_stack',
        fetchedAt: new Date().toISOString(),
        status: 'error',
        payload: null,
        errors: [`tech_stack: ${(err as Error).message}`],
        costPaise: 0,
        durationMs: Date.now() - t0,
      };
    }
  },
};
