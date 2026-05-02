import { describe, it, expect } from 'vitest';
import { adsMetaLibraryUrlAdapter } from '../../../src/adapters/ads/metaLibraryUrl.js';
import { adsGoogleTransparencyUrlAdapter } from '../../../src/adapters/ads/googleTransparencyUrl.js';
import type { AdapterContext } from '../../../src/types.js';
import { EMPTY_ANCHORS } from '../../../src/types.js';

function makeCtx(name: string, domain: string): AdapterContext {
  const noop = () => {};
  return {
    input: { name, domain },
    http: (() => {}) as unknown as typeof fetch,
    cache: { read: async () => null, write: async () => {}, clear: async () => {} },
    logger: { debug: noop, info: noop, warn: noop, error: noop, child: () => makeCtx(name, domain).logger },
    env: {},
    signal: new AbortController().signal,
      anchors: EMPTY_ANCHORS,
  };
}

describe('adsMetaLibraryUrlAdapter', () => {
  it('contract surface', () => {
    expect(adsMetaLibraryUrlAdapter.name).toBe('ads.meta_library_url');
    expect(adsMetaLibraryUrlAdapter.module).toBe('ads');
    expect(adsMetaLibraryUrlAdapter.estimatedCostInr).toBe(0);
    expect(adsMetaLibraryUrlAdapter.requiredEnv).toHaveLength(0);
    expect(adsMetaLibraryUrlAdapter.gate).toBeUndefined();
  });

  it('constructs correct Meta Ad Library URL with URL-encoding', async () => {
    const result = await adsMetaLibraryUrlAdapter.run(makeCtx('Acme & Sons', 'acme.com'));
    expect(result.status).toBe('ok');
    expect(result.payload!.url).toContain('facebook.com/ads/library/');
    expect(result.payload!.url).toContain('Acme%20%26%20Sons');
    expect(result.payload!.url).toContain('country=ALL');
    expect(result.payload!.url).toContain('active_status=all');
  });
});

describe('adsGoogleTransparencyUrlAdapter', () => {
  it('contract surface', () => {
    expect(adsGoogleTransparencyUrlAdapter.name).toBe('ads.google_transparency_url');
    expect(adsGoogleTransparencyUrlAdapter.module).toBe('ads');
    expect(adsGoogleTransparencyUrlAdapter.estimatedCostInr).toBe(0);
    expect(adsGoogleTransparencyUrlAdapter.requiredEnv).toHaveLength(0);
    expect(adsGoogleTransparencyUrlAdapter.gate).toBeUndefined();
  });

  it('constructs correct Google Ads Transparency URL with domain', async () => {
    const result = await adsGoogleTransparencyUrlAdapter.run(makeCtx('Acme Corp', 'acme.com'));
    expect(result.status).toBe('ok');
    expect(result.payload!.url).toContain('adstransparency.google.com');
    expect(result.payload!.url).toContain('domain=acme.com');
    expect(result.payload!.url).toContain('region=anywhere');
  });
});
