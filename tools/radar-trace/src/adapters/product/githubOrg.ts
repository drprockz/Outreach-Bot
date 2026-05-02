import { z } from 'zod';
import type { Adapter, AdapterContext, AdapterResult } from '../../types.js';
import { findGithubOrg, githubOrgFromUrl } from './types.js';

export const ProductGithubOrgPayloadSchema = z.object({
  org: z.string().nullable(),
});

export type ProductGithubOrgPayload = z.infer<typeof ProductGithubOrgPayloadSchema>;

export const productGithubOrgAdapter: Adapter<ProductGithubOrgPayload> = {
  name: 'product.github_org',
  module: 'product',
  version: '0.2.0',
  estimatedCostInr: 0,
  requiredEnv: ['GITHUB_TOKEN'],
  schema: ProductGithubOrgPayloadSchema,
  async run(ctx: AdapterContext): Promise<AdapterResult<ProductGithubOrgPayload>> {
    const t0 = Date.now();
    // Anchor-first — use the GitHub org URL self-linked from the company website.
    // This is the authoritative source: name-based GitHub search picks the first
    // org that contains the company name token, which routinely returns an
    // unrelated org for common-name companies (the original "databento for
    // Simple Inc" failure mode).
    const anchored = githubOrgFromUrl(ctx.anchors.githubOrgUrl);
    if (anchored) {
      return {
        source: 'product.github_org',
        fetchedAt: new Date().toISOString(),
        status: 'ok',
        payload: { org: anchored },
        costPaise: 0,
        durationMs: Date.now() - t0,
        verification: {
          method: 'anchor',
          confidence: 1,
          reason: 'githubOrgUrl from company website',
        },
      };
    }
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
        // Name-search fallback — without an anchor we can't disambiguate, so
        // the result is marked low-confidence rather than dropped. Downstream
        // consumers can decide to ignore unverified GitHub orgs.
        verification: {
          method: 'none',
          confidence: org ? 0.4 : 0,
          reason: org ? 'github name search (unverified)' : 'no candidates',
        },
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
