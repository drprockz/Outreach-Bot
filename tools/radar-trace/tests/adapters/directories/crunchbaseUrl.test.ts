import { describe, it, expect } from 'vitest';
import { crunchbaseUrlAdapter, buildCrunchbaseSlug } from '../../../src/adapters/directories/crunchbaseUrl.js';
import type { AdapterContext } from '../../../src/types.js';

function makeCtx(name: string): AdapterContext {
  const noop = () => {};
  return {
    input: { name, domain: 'acme.com' },
    http: (() => {}) as unknown as typeof fetch,
    cache: { read: async () => null, write: async () => {}, clear: async () => {} },
    logger: { debug: noop, info: noop, warn: noop, error: noop, child: () => makeCtx(name).logger },
    env: {},
    signal: new AbortController().signal,
  };
}

describe('crunchbaseUrlAdapter', () => {
  it('contract surface', () => {
    expect(crunchbaseUrlAdapter.name).toBe('directories.crunchbase_url');
    expect(crunchbaseUrlAdapter.module).toBe('directories');
    expect(crunchbaseUrlAdapter.version).toBe('0.1.0');
    expect(crunchbaseUrlAdapter.estimatedCostInr).toBe(0);
    expect(crunchbaseUrlAdapter.requiredEnv).toHaveLength(0);
    // URL constructor adapters are free, no cacheTtlMs needed
  });

  it('constructs the Crunchbase organization URL from company name', async () => {
    const ctx = makeCtx('Acme Technologies Pvt Ltd');
    const result = await crunchbaseUrlAdapter.run(ctx);
    expect(result.status).toBe('ok');
    expect(result.payload!.url).toBe(
      'https://www.crunchbase.com/organization/acme-technologies-pvt-ltd',
    );
  });

  it('slug normalisation: removes leading/trailing hyphens and collapses special chars', () => {
    expect(buildCrunchbaseSlug('Acme Corp.')).toBe('acme-corp');
    expect(buildCrunchbaseSlug('OpenAI')).toBe('openai');
    expect(buildCrunchbaseSlug('  My  Company  ')).toBe('my-company');
    expect(buildCrunchbaseSlug('Café & Boulangerie')).toBe('caf-boulangerie');
  });
});
