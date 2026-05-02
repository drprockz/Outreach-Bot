import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { productGithubOrgAdapter } from '../../../src/adapters/product/githubOrg.js';
import type { AdapterContext } from '../../../src/types.js';
import { EMPTY_ANCHORS } from '../../../src/types.js';

const orgsFixture = JSON.parse(readFileSync(join(__dirname, '../../fixtures/product/github-orgs.json'), 'utf8'));

function ctxWith(http: typeof fetch, anchorOverride?: Partial<AdapterContext['anchors']>): AdapterContext {
  const noop = () => {};
  return {
    input: { name: 'Acme', domain: 'acme.com' },
    http,
    cache: { read: async () => null, write: async () => {}, clear: async () => {} },
    logger: { debug: noop, info: noop, warn: noop, error: noop, child: () => ctxWith(http).logger },
    env: { GITHUB_TOKEN: 'fake' },
    signal: new AbortController().signal,
    anchors: { ...EMPTY_ANCHORS, ...(anchorOverride ?? {}) },
  };
}

function fakeFetch(routes: Record<string, () => Response>): typeof fetch {
  return (async (url: string | URL | Request) => {
    const u = typeof url === 'string' ? url : url.toString();
    for (const [match, factory] of Object.entries(routes)) {
      if (u.includes(match)) return factory();
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

describe('productGithubOrgAdapter', () => {
  it('exposes new contract fields', () => {
    expect(productGithubOrgAdapter.name).toBe('product.github_org');
    expect(productGithubOrgAdapter.module).toBe('product');
    expect(productGithubOrgAdapter.requiredEnv).toEqual(['GITHUB_TOKEN']);
    expect(productGithubOrgAdapter.estimatedCostInr).toBe(0);
    expect(productGithubOrgAdapter.gate).toBeUndefined();
  });

  it('returns ok with org login when org found', async () => {
    const http = fakeFetch({
      '/search/users': () => new Response(JSON.stringify(orgsFixture), { status: 200 }),
    });
    const result = await productGithubOrgAdapter.run(ctxWith(http));
    expect(result.status).toBe('ok');
    expect(result.payload!.org).toBe('acme');
  });

  it('returns empty when no org found', async () => {
    const http = fakeFetch({
      '/search/users': () => new Response(JSON.stringify({ items: [] }), { status: 200 }),
    });
    const result = await productGithubOrgAdapter.run(ctxWith(http));
    expect(result.status).toBe('empty');
    expect(result.payload!.org).toBeNull();
  });

  it('returns error on API failure', async () => {
    const http = fakeFetch({
      '/search/users': () => new Response('boom', { status: 500 }),
    });
    const result = await productGithubOrgAdapter.run(ctxWith(http));
    expect(result.status).toBe('error');
    expect(result.errors?.[0]).toContain('github');
  });

  it('uses the GitHub org anchor and SKIPS the name search', async () => {
    // Regression for the original "databento for Simple Inc" failure mode.
    // The mocked search would return some org named "evilcorp"; the adapter
    // must ignore it and use the anchor URL instead.
    const searchSpy = vi.fn(() => new Response(JSON.stringify({
      items: [{ login: 'evilcorp', type: 'Organization' }],
    }), { status: 200 }));
    const http = fakeFetch({ '/search/users': searchSpy });
    const result = await productGithubOrgAdapter.run(
      ctxWith(http, { githubOrgUrl: 'https://github.com/acme' }),
    );
    expect(result.status).toBe('ok');
    expect(result.payload!.org).toBe('acme');
    expect(result.verification?.method).toBe('anchor');
    expect(result.verification?.confidence).toBe(1);
    expect(searchSpy).not.toHaveBeenCalled();
  });

  it('marks name-search results as unverified when no anchor is set', async () => {
    const http = fakeFetch({
      '/search/users': () => new Response(JSON.stringify(orgsFixture), { status: 200 }),
    });
    const result = await productGithubOrgAdapter.run(ctxWith(http));
    expect(result.status).toBe('ok');
    expect(result.verification?.method).toBe('none');
    expect(result.verification?.confidence).toBeLessThan(1);
  });
});
