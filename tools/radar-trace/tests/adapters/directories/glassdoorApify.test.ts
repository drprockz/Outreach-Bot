import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeGlassdoorApifyAdapter } from '../../../src/adapters/directories/glassdoorApify.js';
import type { AdapterContext, PartialDossier, AdapterResult } from '../../../src/types.js';
import { EMPTY_ANCHORS } from '../../../src/types.js';
import type { ApifyClient } from '../../../src/clients/apify.js';

const glassdoorFixture = JSON.parse(
  readFileSync(join(__dirname, '../../fixtures/apify/glassdoor.json'), 'utf8'),
) as unknown[];

function makeCtx(): AdapterContext {
  const noop = () => {};
  return {
    input: { name: 'Acme Corp', domain: 'acme.com' },
    http: (() => {}) as unknown as typeof fetch,
    cache: { read: async () => null, write: async () => {}, clear: async () => {} },
    logger: { debug: noop, info: noop, warn: noop, error: noop, child: () => makeCtx().logger },
    env: { APIFY_TOKEN: 'fake-token' },
    signal: new AbortController().signal,
      anchors: EMPTY_ANCHORS,
  };
}

function makeApifySpy(items: unknown[]): ApifyClient {
  return {
    runActor: vi.fn(async () => ({
      items,
      costUsd: items.length * 0.005,
      truncated: false,
    })) as ApifyClient['runActor'],
  };
}

function makeZaubaResult(country: string): AdapterResult<unknown> {
  return {
    source: 'directories.zaubacorp',
    fetchedAt: new Date().toISOString(),
    status: 'ok',
    payload: { country, cin: null, directors: [], toflerUrl: null, registeredOn: null, registrar: null, status: 'Active', paidUpCapitalInr: null, authorizedCapitalInr: null, registeredAddress: null },
    costPaise: 0,
    durationMs: 10,
  };
}

describe('glassdoorApifyAdapter', () => {
  it('contract surface — has gate, correct name/module/version', () => {
    const adapter = makeGlassdoorApifyAdapter({ apify: () => makeApifySpy([]) });
    expect(adapter.name).toBe('directories.glassdoor_apify');
    expect(adapter.module).toBe('directories');
    expect(adapter.version).toBe('0.1.0');
    expect(adapter.estimatedCostInr).toBe(100);
    expect(adapter.requiredEnv).toContain('APIFY_TOKEN');
    expect(adapter.cacheTtlMs).toBe(7 * 86_400_000);
    expect(typeof adapter.gate).toBe('function');
  });

  it('gate returns false for Indian companies (zaubacorp.payload.country === India)', () => {
    const adapter = makeGlassdoorApifyAdapter({ apify: () => makeApifySpy([]) });

    const indiaPartial: PartialDossier = {
      'directories.zaubacorp': makeZaubaResult('India'),
    };
    expect(adapter.gate!(indiaPartial)).toBe(false);

    // Missing zaubacorp → also false (no confirmation)
    expect(adapter.gate!({})).toBe(false);

    // Errored zaubacorp → false
    const errorPartial: PartialDossier = {
      'directories.zaubacorp': {
        source: 'directories.zaubacorp',
        fetchedAt: '',
        status: 'error',
        payload: null,
        costPaise: 0,
        durationMs: 0,
      },
    };
    expect(adapter.gate!(errorPartial)).toBe(false);
  });

  it('gate returns true for non-Indian companies', () => {
    const adapter = makeGlassdoorApifyAdapter({ apify: () => makeApifySpy([]) });

    const usPartial: PartialDossier = {
      'directories.zaubacorp': makeZaubaResult('USA'),
    };
    expect(adapter.gate!(usPartial)).toBe(true);

    const ukPartial: PartialDossier = {
      'directories.zaubacorp': makeZaubaResult('UK'),
    };
    expect(adapter.gate!(ukPartial)).toBe(true);
  });

  it('returns ok with structured Glassdoor data from Apify result', async () => {
    const adapter = makeGlassdoorApifyAdapter({ apify: () => makeApifySpy(glassdoorFixture) });
    const result = await adapter.run(makeCtx());

    expect(result.status).toBe('ok');
    expect(result.payload!.rating).toBe(4.1);
    expect(result.payload!.reviewCount).toBe(87);
    expect(result.payload!.ceoRating).toBeCloseTo(0.82);
    expect(result.payload!.recentInterviewSummary).toContain('Positive');
    expect(result.payload!.pros).toHaveLength(3);
    expect(result.payload!.cons).toHaveLength(3);
    expect(result.payload!.glassdoorUrl).toContain('glassdoor.com');
    expect(result.costMeta?.costUsd).toBeCloseTo(0.005);
    expect(result.costMeta?.apifyResults).toBe(1);
  });
});
