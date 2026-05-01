/**
 * product.github_events — commit velocity + recent releases.
 *
 * Decision: we inline `findGithubOrg` here rather than gating on `product.github_org`'s
 * Wave 1 result. Making this a Wave 2 adapter would add orchestration complexity;
 * the duplicate GitHub search call is cheap and rate-limit-tolerant (150 rpm authenticated).
 * The orchestrator's Wave 1 parallelism runs github_org and github_events concurrently.
 */
import { z } from 'zod';
import type { Adapter, AdapterContext, AdapterResult } from '../../types.js';
import { ReleaseSchema, findGithubOrg, fetchEvents, isWithinDays } from './types.js';

export const ProductGithubEventsPayloadSchema = z.object({
  commitVelocity30d: z.number().int().nonnegative(),
  recentReleases: z.array(ReleaseSchema),
});

export type ProductGithubEventsPayload = z.infer<typeof ProductGithubEventsPayloadSchema>;

export const productGithubEventsAdapter: Adapter<ProductGithubEventsPayload> = {
  name: 'product.github_events',
  module: 'product',
  version: '0.1.0',
  estimatedCostInr: 0,
  estimatedCostPaise: 0,
  requiredEnv: ['GITHUB_TOKEN'],
  schema: ProductGithubEventsPayloadSchema,
  async run(ctx: AdapterContext): Promise<AdapterResult<ProductGithubEventsPayload>> {
    const t0 = Date.now();
    try {
      const org = await findGithubOrg(ctx);
      if (!org) {
        return {
          source: 'product.github_events',
          fetchedAt: new Date().toISOString(),
          status: 'empty',
          payload: { commitVelocity30d: 0, recentReleases: [] },
          costPaise: 0,
          durationMs: Date.now() - t0,
        };
      }
      const events = await fetchEvents(ctx, org);
      const commitVelocity30d = events.filter(
        (e) => e.type === 'PushEvent' && isWithinDays(e.created_at, 30),
      ).length;
      const recentReleases = events
        .filter((e) => e.type === 'ReleaseEvent' && isWithinDays(e.created_at, 14))
        .map((e) => ({
          repo: e.repo?.name ?? '',
          tag: e.payload?.release?.tag_name ?? '',
          title: e.payload?.release?.name ?? null,
          url: e.payload?.release?.html_url ?? '',
          date: e.created_at,
        }));
      return {
        source: 'product.github_events',
        fetchedAt: new Date().toISOString(),
        status: 'ok',
        payload: { commitVelocity30d, recentReleases },
        costPaise: 0,
        durationMs: Date.now() - t0,
      };
    } catch (err) {
      return {
        source: 'product.github_events',
        fetchedAt: new Date().toISOString(),
        status: 'error',
        payload: null,
        errors: [`github_events: ${(err as Error).message}`],
        costPaise: 0,
        durationMs: Date.now() - t0,
      };
    }
  },
};
