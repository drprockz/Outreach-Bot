import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeAdsGoogleCreativesApifyAdapter } from '../../../src/adapters/ads/googleCreativesApify.js';
import type { AdapterContext } from '../../../src/types.js';
import { EMPTY_ANCHORS } from '../../../src/types.js';
import type { ApifyClient } from '../../../src/clients/apify.js';

const googleCreativesFixture = JSON.parse(
  readFileSync(join(__dirname, '../../fixtures/apify/google-creatives.json'), 'utf8'),
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
      costUsd: items.length * 0.001,
      truncated: false,
    })) as ApifyClient['runActor'],
  };
}

describe('adsGoogleCreativesApifyAdapter', () => {
  it('contract surface', () => {
    const adapter = makeAdsGoogleCreativesApifyAdapter({
      apify: () => makeApifySpy([]),
    });
    expect(adapter.name).toBe('ads.google_creatives_apify');
    expect(adapter.module).toBe('ads');
    expect(adapter.version).toBe('0.1.0');
    expect(adapter.estimatedCostInr).toBe(50);
    expect(adapter.requiredEnv).toContain('APIFY_TOKEN');
    // Does NOT need SERPER_API_KEY
    expect(adapter.requiredEnv).not.toContain('SERPER_API_KEY');
    expect(adapter.cacheTtlMs).toBe(24 * 60 * 60 * 1000);
    expect(adapter.gate).toBeUndefined();
  });

  it('parses fixture and maps creatives with all fields', async () => {
    const adapter = makeAdsGoogleCreativesApifyAdapter({
      apify: () => makeApifySpy(googleCreativesFixture),
    });

    const result = await adapter.run(makeCtx());
    expect(result.status).toBe('ok');
    expect(result.payload!.totalActiveAds).toBe(3);
    expect(result.payload!.creatives).toHaveLength(3);

    // First ad — text type
    const firstAd = result.payload!.creatives[0]!;
    expect(firstAd.adId).toBe('CR01234567890123');
    expect(firstAd.advertiser).toBe('Acme Corp');
    expect(firstAd.adType).toBe('text');
    expect(firstAd.adText).toContain('B2B Outreach Automation');
    expect(firstAd.landingUrl).toContain('acme.com');
    expect(firstAd.targetCountries).toContain('IN');
    expect(firstAd.firstShown).toBe('2024-01-10');
    expect(firstAd.lastShown).toBe('2024-04-18');

    // Second ad — image type
    const secondAd = result.payload!.creatives[1]!;
    expect(secondAd.adType).toBe('image');

    // Third ad — video type, null title/description → adText null
    const thirdAd = result.payload!.creatives[2]!;
    expect(thirdAd.adType).toBe('video');
    expect(thirdAd.adText).toBeNull();
    expect(thirdAd.targetCountries).toContain('GB');
  });

  it('returns empty when no creatives found', async () => {
    const adapter = makeAdsGoogleCreativesApifyAdapter({
      apify: () => makeApifySpy([]),
    });

    const result = await adapter.run(makeCtx());
    expect(result.status).toBe('empty');
    expect(result.payload).toBeNull();
    expect(result.costMeta?.apifyResults).toBe(0);
  });

  it('reports costMeta.costUsd correctly (costPerResultUsd = 0.001)', async () => {
    const adapter = makeAdsGoogleCreativesApifyAdapter({
      apify: () => makeApifySpy(googleCreativesFixture),
    });

    const result = await adapter.run(makeCtx());
    expect(result.status).toBe('ok');

    const itemCount = googleCreativesFixture.length; // 3
    const expectedCostUsd = itemCount * 0.001;
    expect(result.costMeta?.costUsd).toBeCloseTo(expectedCostUsd);
    expect(result.costMeta?.apifyResults).toBe(itemCount);

    const expectedCostPaise = Math.round(expectedCostUsd * 84 * 100);
    expect(result.costPaise).toBe(expectedCostPaise);
  });
});
