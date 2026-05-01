/**
 * product.github_releases — recent new repos + language distribution.
 *
 * Decision: we inline `findGithubOrg` here rather than gating on `product.github_org`.
 * Same reasoning as github_events: the duplicate search call is cheap and the orchestrator
 * runs all Wave 1 adapters in parallel, so no ordering penalty.
 */
import { z } from 'zod';
import type { Adapter, AdapterContext, AdapterResult } from '../../types.js';
import { RepoSchema, findGithubOrg, fetchRepos, isWithinDays } from './types.js';

export const ProductGithubReleasesPayloadSchema = z.object({
  recentNewRepos: z.array(RepoSchema),
  publicRepos: z.array(RepoSchema),
  languageDistribution: z.record(z.string(), z.number().int().nonnegative()),
});

export type ProductGithubReleasesPayload = z.infer<typeof ProductGithubReleasesPayloadSchema>;

export const productGithubReleasesAdapter: Adapter<ProductGithubReleasesPayload> = {
  name: 'product.github_releases',
  module: 'product',
  version: '0.1.0',
  estimatedCostInr: 0,
  requiredEnv: ['GITHUB_TOKEN'],
  schema: ProductGithubReleasesPayloadSchema,
  async run(ctx: AdapterContext): Promise<AdapterResult<ProductGithubReleasesPayload>> {
    const t0 = Date.now();
    try {
      const org = await findGithubOrg(ctx);
      if (!org) {
        return {
          source: 'product.github_releases',
          fetchedAt: new Date().toISOString(),
          status: 'empty',
          payload: { recentNewRepos: [], publicRepos: [], languageDistribution: {} },
          costPaise: 0,
          durationMs: Date.now() - t0,
        };
      }
      const publicRepos = await fetchRepos(ctx, org);
      const recentNewRepos = publicRepos.filter((r) => r.createdAt && isWithinDays(r.createdAt, 30));
      const languageDistribution: Record<string, number> = {};
      for (const r of publicRepos) {
        if (r.language) languageDistribution[r.language] = (languageDistribution[r.language] ?? 0) + 1;
      }
      return {
        source: 'product.github_releases',
        fetchedAt: new Date().toISOString(),
        status: 'ok',
        payload: { recentNewRepos, publicRepos, languageDistribution },
        costPaise: 0,
        durationMs: Date.now() - t0,
      };
    } catch (err) {
      return {
        source: 'product.github_releases',
        fetchedAt: new Date().toISOString(),
        status: 'error',
        payload: null,
        errors: [`github_releases: ${(err as Error).message}`],
        costPaise: 0,
        durationMs: Date.now() - t0,
      };
    }
  },
};
