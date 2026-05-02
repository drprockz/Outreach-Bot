import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeAdsMetaCreativesApifyAdapter } from '../../../src/adapters/ads/metaCreativesApify.js';
import type { AdapterContext } from '../../../src/types.js';
import { EMPTY_ANCHORS } from '../../../src/types.js';
import type { ApifyClient } from '../../../src/clients/apify.js';

const metaCreativesFixture = JSON.parse(
  readFileSync(join(__dirname, '../../fixtures/apify/meta-creatives.json'), 'utf8'),
) as unknown[];

function makeCtx(overrides: Partial<AdapterContext> = {}): AdapterContext {
  const noop = () => {};
  return {
    input: { name: 'Acme Corp', domain: 'acme.com' },
    http: (() => {}) as unknown as typeof fetch,
    cache: { read: async () => null, write: async () => {}, clear: async () => {} },
    logger: { debug: noop, info: noop, warn: noop, error: noop, child: () => makeCtx().logger },
    env: { APIFY_TOKEN: 'fake-token' },
    signal: new AbortController().signal,
      anchors: EMPTY_ANCHORS,    ...overrides,
  };
}

function makeApifySpy(items: unknown[]): ApifyClient {
  return {
    runActor: vi.fn(async () => ({
      items,
      costUsd: items.length * 0.00075,
      truncated: false,
    })) as ApifyClient['runActor'],
  };
}

describe('adsMetaCreativesApifyAdapter', () => {
  it('contract surface', () => {
    const adapter = makeAdsMetaCreativesApifyAdapter({
      apify: () => makeApifySpy([]),
    });
    expect(adapter.name).toBe('ads.meta_creatives_apify');
    expect(adapter.module).toBe('ads');
    expect(adapter.version).toBe('0.1.0');
    expect(adapter.estimatedCostInr).toBe(15);
    expect(adapter.requiredEnv).toContain('APIFY_TOKEN');
    // Does NOT need SERPER_API_KEY
    expect(adapter.requiredEnv).not.toContain('SERPER_API_KEY');
    expect(adapter.cacheTtlMs).toBe(24 * 60 * 60 * 1000);
    expect(adapter.gate).toBeUndefined();
  });

  it('parses fixture, maps creatives, and computes runningDays', async () => {
    const adapter = makeAdsMetaCreativesApifyAdapter({
      apify: () => makeApifySpy(metaCreativesFixture),
    });

    const result = await adapter.run(makeCtx());
    expect(result.status).toBe('ok');
    expect(result.payload!.totalActiveAds).toBe(2);
    expect(result.payload!.creatives).toHaveLength(2);

    const firstAd = result.payload!.creatives[0]!;
    expect(firstAd.adId).toBe('1040382736251948');
    expect(firstAd.pageName).toBe('Acme Corp');
    expect(firstAd.adText).toContain('slow follow-ups');
    expect(firstAd.headline).toBe('Automate Your B2B Outreach');
    expect(firstAd.callToAction).toBe('LEARN_MORE');
    expect(firstAd.landingUrl).toContain('acme.com');
    expect(firstAd.mediaType).toBe('image');

    // Targeting
    expect(firstAd.targeting.countries).toContain('India');
    expect(firstAd.targeting.ageMin).toBe(25);
    expect(firstAd.targeting.ageMax).toBe(55);
    expect(firstAd.targeting.gender).toBe('All');

    // runningDays should be computed (ad started 2024-02-01, today is 2026-05-01)
    expect(firstAd.runningSinceDate).toBe('2024-02-01');
    expect(firstAd.runningDays).toBeGreaterThan(100);

    // Second ad has video
    const secondAd = result.payload!.creatives[1]!;
    expect(secondAd.mediaType).toBe('video');
    expect(secondAd.targeting.countries).toContain('India');
  });

  it('returns empty when no ads found', async () => {
    const adapter = makeAdsMetaCreativesApifyAdapter({
      apify: () => makeApifySpy([]),
    });

    const result = await adapter.run(makeCtx());
    expect(result.status).toBe('empty');
    expect(result.payload).toBeNull();
    expect(result.costMeta?.apifyResults).toBe(0);
  });

  it('reports costMeta.costUsd correctly (costPerResultUsd = 0.00075)', async () => {
    const adapter = makeAdsMetaCreativesApifyAdapter({
      apify: () => makeApifySpy(metaCreativesFixture),
    });

    const result = await adapter.run(makeCtx());
    expect(result.status).toBe('ok');

    const itemCount = metaCreativesFixture.length; // 2
    const expectedCostUsd = itemCount * 0.00075;
    expect(result.costMeta?.costUsd).toBeCloseTo(expectedCostUsd);
    expect(result.costMeta?.apifyResults).toBe(itemCount);

    const expectedCostPaise = Math.round(expectedCostUsd * 84 * 100);
    expect(result.costPaise).toBe(expectedCostPaise);
  });
});
