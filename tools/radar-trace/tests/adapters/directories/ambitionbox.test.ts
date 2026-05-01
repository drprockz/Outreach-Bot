import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ambitionboxAdapter, parseAmbitionBoxPage } from '../../../src/adapters/directories/ambitionbox.js';
import type { AdapterContext } from '../../../src/types.js';

const fullHtml = readFileSync(
  join(__dirname, '../../fixtures/directories/ambitionbox-acme.html'),
  'utf8',
);

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

describe('ambitionboxAdapter', () => {
  it('contract surface', () => {
    expect(ambitionboxAdapter.name).toBe('directories.ambitionbox');
    expect(ambitionboxAdapter.module).toBe('directories');
    expect(ambitionboxAdapter.version).toBe('0.1.0');
    expect(ambitionboxAdapter.estimatedCostInr).toBe(0);
    expect(ambitionboxAdapter.requiredEnv).toHaveLength(0);
    expect(ambitionboxAdapter.cacheTtlMs).toBe(3 * 86_400_000);
  });

  it('parses full AmbitionBox fixture correctly', () => {
    const url = 'https://www.ambitionbox.com/overview/acme-corp-overview';
    const payload = parseAmbitionBoxPage(fullHtml, url);

    expect(payload.rating).toBe(4.2);
    expect(payload.reviewCount).toBe(1248);
    expect(payload.industry).toBe('Software & Services');
    expect(payload.employeeCount).toBe('501-1000 Employees');
    expect(payload.headquarters).toBe('Bengaluru');
    expect(payload.yearFounded).toBe(2015);
    expect(payload.ceoName).toBe('Rahul Sharma');
    expect(payload.ratings.salaryAndBenefits).toBe(3.8);
    expect(payload.ratings.workLifeBalance).toBe(4.0);
    expect(payload.ratings.cultureAndValues).toBe(4.3);
    expect(payload.ratings.careerGrowth).toBe(3.9);
    expect(payload.ambitionboxUrl).toBe(url);
  });

  it('returns status:empty when both primary and fallback URLs return 404', async () => {
    const fakeFetch = async () => new Response('Not Found', { status: 404 });
    const ctx = makeCtx(fakeFetch as unknown as typeof fetch);
    const result = await ambitionboxAdapter.run(ctx);
    expect(result.status).toBe('empty');
    expect(result.payload).toBeNull();
  });

  it('returns ok when primary URL succeeds', async () => {
    const fakeFetch = async () => new Response(fullHtml, { status: 200 });
    const ctx = makeCtx(fakeFetch as unknown as typeof fetch);
    const result = await ambitionboxAdapter.run(ctx);
    expect(result.status).toBe('ok');
    expect(result.payload!.rating).toBe(4.2);
  });
});
