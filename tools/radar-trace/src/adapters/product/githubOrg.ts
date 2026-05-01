import { z } from 'zod';
import type { Adapter, AdapterContext, AdapterResult } from '../../types.js';
import { findGithubOrg } from './types.js';

export const ProductGithubOrgPayloadSchema = z.object({
  org: z.string().nullable(),
});

export type ProductGithubOrgPayload = z.infer<typeof ProductGithubOrgPayloadSchema>;

export const productGithubOrgAdapter: Adapter<ProductGithubOrgPayload> = {
  name: 'product.github_org',
  module: 'product',
  version: '0.1.0',
  estimatedCostInr: 0,
  estimatedCostPaise: 0,
  requiredEnv: ['GITHUB_TOKEN'],
  schema: ProductGithubOrgPayloadSchema,
  async run(ctx: AdapterContext): Promise<AdapterResult<ProductGithubOrgPayload>> {
    const t0 = Date.now();
    try {
      const org = await findGithubOrg(ctx);
      const status = org === null ? 'empty' : 'ok';
      return {
        source: 'product.github_org',
        fetchedAt: new Date().toISOString(),
        status,
        payload: { org },
        costPaise: 0,
        durationMs: Date.now() - t0,
      };
    } catch (err) {
      return {
        source: 'product.github_org',
        fetchedAt: new Date().toISOString(),
        status: 'error',
        payload: null,
        errors: [`github: ${(err as Error).message}`],
        costPaise: 0,
        durationMs: Date.now() - t0,
      };
    }
  },
};
