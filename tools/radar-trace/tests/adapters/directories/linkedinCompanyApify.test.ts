import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeLinkedinCompanyApifyAdapter } from '../../../src/adapters/directories/linkedinCompanyApify.js';
import type { AdapterContext } from '../../../src/types.js';
import type { SerperClient } from '../../../src/clients/serper.js';
import type { ApifyClient } from '../../../src/clients/apify.js';

const linkedinFixture = JSON.parse(
  readFileSync(join(__dirname, '../../fixtures/apify/linkedin-company.json'), 'utf8'),
) as unknown[];

function makeCtx(overrides: Partial<AdapterContext> = {}): AdapterContext {
  const noop = () => {};
  return {
    input: { name: 'Acme Corp', domain: 'acme.com' },
    http: (() => {}) as unknown as typeof fetch,
    cache: { read: async () => null, write: async () => {}, clear: async () => {} },
    logger: { debug: noop, info: noop, warn: noop, error: noop, child: () => makeCtx().logger },
    env: { SERPER_API_KEY: 'fake-key', APIFY_TOKEN: 'fake-token' },
    signal: new AbortController().signal,
    ...overrides,
  };
}

function makeSerperSpy(
  organic: Array<{ title: string; link: string; snippet: string }>,
): SerperClient {
  return {
    search: vi.fn(async () => ({ organic, costPaise: 3 })),
    newsSearch: vi.fn(async () => ({ news: [], costPaise: 3 })),
  };
}

function makeApifySpy(items: unknown[]): ApifyClient {
  return {
    runActor: vi.fn(async () => ({
      items,
      costUsd: items.length * 0.005,
      truncated: false,
    })),
  };
}

describe('linkedinCompanyApifyAdapter', () => {
  it('contract surface', () => {
    const adapter = makeLinkedinCompanyApifyAdapter({
      serper: () => makeSerperSpy([]),
      apify: () => makeApifySpy([]),
    });
    expect(adapter.name).toBe('directories.linkedin_company_apify');
    expect(adapter.module).toBe('directories');
    expect(adapter.version).toBe('0.1.0');
    expect(adapter.estimatedCostInr).toBe(50);
    expect(adapter.requiredEnv).toContain('SERPER_API_KEY');
    expect(adapter.requiredEnv).toContain('APIFY_TOKEN');
    expect(adapter.cacheTtlMs).toBe(7 * 86_400_000);
  });

  it('discovers URL via Serper, runs Apify, returns ok with company data', async () => {
    const organic = [
      { title: 'Acme Corp | LinkedIn', link: 'https://www.linkedin.com/company/acme-corp/', snippet: '' },
    ];
    const adapter = makeLinkedinCompanyApifyAdapter({
      serper: () => makeSerperSpy(organic),
      apify: () => makeApifySpy(linkedinFixture),
    });

    const result = await adapter.run(makeCtx());
    expect(result.status).toBe('ok');
    expect(result.payload!.linkedinCompanyUrl).toBe('https://www.linkedin.com/company/acme-corp/');
    expect(result.payload!.name).toBe('Acme Corp');
    expect(result.payload!.industry).toBe('Software Development');
    expect(result.payload!.specialties).toContain('SaaS');
    expect(result.payload!.followerCount).toBe(8432);
    expect(result.payload!.founded).toBe(2018);
  });

  it('returns empty when Serper finds no LinkedIn company URL', async () => {
    const organic = [
      { title: 'Acme Corp on LinkedIn', link: 'https://linkedin.com/in/someuser', snippet: '' },
      { title: 'Acme website', link: 'https://acme.com', snippet: '' },
    ];
    const adapter = makeLinkedinCompanyApifyAdapter({
      serper: () => makeSerperSpy(organic),
      apify: () => makeApifySpy(linkedinFixture),
    });

    const result = await adapter.run(makeCtx());
    expect(result.status).toBe('empty');
    expect(result.payload).toBeNull();
  });

  it('returns error when Apify throws', async () => {
    const organic = [
      { title: 'Acme Corp | LinkedIn', link: 'https://www.linkedin.com/company/acme-corp/', snippet: '' },
    ];
    const failingApify: ApifyClient = {
      runActor: vi.fn(async () => { throw new Error('Apify rate limit'); }),
    };
    const adapter = makeLinkedinCompanyApifyAdapter({
      serper: () => makeSerperSpy(organic),
      apify: () => failingApify,
    });

    const result = await adapter.run(makeCtx());
    expect(result.status).toBe('error');
    expect(result.errors?.[0]).toMatch(/apify rate limit/i);
  });

  it('reports costMeta.costUsd from Apify run', async () => {
    const organic = [
      { title: 'Acme Corp | LinkedIn', link: 'https://www.linkedin.com/company/acme-corp/', snippet: '' },
    ];
    const adapter = makeLinkedinCompanyApifyAdapter({
      serper: () => makeSerperSpy(organic),
      apify: () => makeApifySpy(linkedinFixture),
    });

    const result = await adapter.run(makeCtx());
    expect(result.status).toBe('ok');
    expect(result.costMeta?.costUsd).toBeCloseTo(1 * 0.005);
    expect(result.costMeta?.apifyResults).toBe(1);
    // Total costPaise = Serper (3) + Apify (1 result × 0.005 × 84 × 100 = 42)
    expect(result.costPaise).toBe(3 + Math.round(0.005 * 84 * 100));
  });
});
