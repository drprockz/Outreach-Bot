import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { productGithubOrgAdapter } from '../../../src/adapters/product/githubOrg.js';
import type { AdapterContext } from '../../../src/types.js';

const orgsFixture = JSON.parse(readFileSync(join(__dirname, '../../fixtures/product/github-orgs.json'), 'utf8'));

function ctxWith(http: typeof fetch): AdapterContext {
  const noop = () => {};
  return {
    input: { name: 'Acme', domain: 'acme.com' },
    http,
    cache: { read: async () => null, write: async () => {}, clear: async () => {} },
    logger: { debug: noop, info: noop, warn: noop, error: noop, child: () => ctxWith(http).logger },
    env: { GITHUB_TOKEN: 'fake' },
    signal: new AbortController().signal,
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
});
