import { describe, it, expect } from 'vitest';
import { g2CapterraAdapter, parseG2SearchPage, parseCapterraSearchPage } from '../../../src/adapters/directories/g2Capterra.js';
import type { AdapterContext, PartialDossier, AdapterResult } from '../../../src/types.js';

function makeCtx(httpFn?: typeof fetch): AdapterContext {
  const noop = () => {};
  return {
    input: { name: 'Acme Corp', domain: 'acme.com' },
    http: (httpFn ?? (() => {})) as unknown as typeof fetch,
    cache: { read: async () => null, write: async () => {}, clear: async () => {} },
    logger: { debug: noop, info: noop, warn: noop, error: noop, child: () => makeCtx().logger },
    env: {},
    signal: new AbortController().signal,
  };
}

function makeTechStackResult(categories: string[]): AdapterResult<unknown> {
  return {
    source: 'operational.tech_stack',
    fetchedAt: new Date().toISOString(),
    status: 'ok',
    payload: { techStack: categories.map((c) => ({ name: 'tool', category: c, confidence: 0.9 })) },
    costPaise: 0,
    durationMs: 10,
  };
}

describe('g2CapterraAdapter', () => {
  it('contract surface — has gate, correct name/module/version', () => {
    expect(g2CapterraAdapter.name).toBe('directories.g2_capterra');
    expect(g2CapterraAdapter.module).toBe('directories');
    expect(g2CapterraAdapter.version).toBe('0.1.0');
    expect(g2CapterraAdapter.estimatedCostInr).toBe(0);
    expect(g2CapterraAdapter.requiredEnv).toHaveLength(0);
    expect(typeof g2CapterraAdapter.gate).toBe('function');
    expect(g2CapterraAdapter.cacheTtlMs).toBe(3 * 86_400_000);
  });

  it('gate returns false when tech_stack is missing or errored', () => {
    const emptyPartial: PartialDossier = {};
    expect(g2CapterraAdapter.gate!(emptyPartial)).toBe(false);

    const erroredPartial: PartialDossier = {
      'operational.tech_stack': {
        source: 'operational.tech_stack',
        fetchedAt: '',
        status: 'error',
        payload: null,
        costPaise: 0,
        durationMs: 0,
      },
    };
    expect(g2CapterraAdapter.gate!(erroredPartial)).toBe(false);

    // Only 1 SaaS marker — below threshold
    const oneMarker: PartialDossier = {
      'operational.tech_stack': makeTechStackResult(['payments']),
    };
    expect(g2CapterraAdapter.gate!(oneMarker)).toBe(false);
  });

  it('gate returns true when 2+ SaaS markers present in tech_stack', () => {
    const twoMarkers: PartialDossier = {
      'operational.tech_stack': makeTechStackResult(['payments', 'crm', 'css']),
    };
    expect(g2CapterraAdapter.gate!(twoMarkers)).toBe(true);

    const threeMarkers: PartialDossier = {
      'operational.tech_stack': makeTechStackResult(['auth', 'monitoring', 'cdp']),
    };
    expect(g2CapterraAdapter.gate!(threeMarkers)).toBe(true);
  });

  it('returns ok when G2 search HTML has a product card', async () => {
    const g2Html = `<html><body>
      <div class="product-listing">
        <a href="/products/acme-corp">Acme Corp</a>
        <span class="fw-semibold">4.5</span>
        <span class="reviews-count">312 reviews</span>
        <span class="category">CRM Software</span>
      </div>
    </body></html>`;
    const capterraHtml = `<html><body><p>No results found.</p></body></html>`;

    let callCount = 0;
    const fakeFetch = async (url: string | URL) => {
      callCount++;
      const str = url.toString();
      if (str.includes('g2.com')) return new Response(g2Html, { status: 200 });
      return new Response(capterraHtml, { status: 200 });
    };

    const ctx = makeCtx(fakeFetch as unknown as typeof fetch);
    const result = await g2CapterraAdapter.run(ctx);

    expect(result.status).toBe('ok');
    expect(result.payload!.g2).not.toBeNull();
    expect(result.payload!.g2!.url).toContain('g2.com');
    expect(callCount).toBe(2); // both fetched in parallel
  });
});
