import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { productGithubReleasesAdapter } from '../../../src/adapters/product/githubReleases.js';
import type { AdapterContext } from '../../../src/types.js';
import { EMPTY_ANCHORS } from '../../../src/types.js';

// Pin date so isWithinDays (recentNewRepos) assertions stay valid
beforeAll(() => { vi.useFakeTimers({ now: new Date('2026-05-01T12:00:00Z') }); });
afterAll(() => { vi.useRealTimers(); });

const orgsFixture = JSON.parse(readFileSync(join(__dirname, '../../fixtures/product/github-orgs.json'), 'utf8'));
const reposFixture = JSON.parse(readFileSync(join(__dirname, '../../fixtures/product/github-repos.json'), 'utf8'));

function ctxWith(http: typeof fetch): AdapterContext {
  const noop = () => {};
  return {
    input: { name: 'Acme', domain: 'acme.com' },
    http,
    cache: { read: async () => null, write: async () => {}, clear: async () => {} },
    logger: { debug: noop, info: noop, warn: noop, error: noop, child: () => ctxWith(http).logger },
    env: { GITHUB_TOKEN: 'fake' },
    signal: new AbortController().signal,
      anchors: EMPTY_ANCHORS,
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

describe('productGithubReleasesAdapter', () => {
  it('exposes new contract fields', () => {
    expect(productGithubReleasesAdapter.name).toBe('product.github_releases');
    expect(productGithubReleasesAdapter.module).toBe('product');
    expect(productGithubReleasesAdapter.requiredEnv).toEqual(['GITHUB_TOKEN']);
    expect(productGithubReleasesAdapter.estimatedCostInr).toBe(0);
    expect(productGithubReleasesAdapter.gate).toBeUndefined();
  });

  it('returns ok with repos + language distribution', async () => {
    const http = fakeFetch({
      '/search/users': () => new Response(JSON.stringify(orgsFixture), { status: 200 }),
      '/orgs/acme/repos': () => new Response(JSON.stringify(reposFixture), { status: 200 }),
    });
    const result = await productGithubReleasesAdapter.run(ctxWith(http));
    expect(result.status).toBe('ok');
    expect(result.payload!.publicRepos.length).toBe(2);
    expect(result.payload!.recentNewRepos.find((r) => r.name === 'demo-app')).toBeTruthy();
    expect(result.payload!.languageDistribution.TypeScript).toBe(1);
  });

  it('returns empty when no org found', async () => {
    const http = fakeFetch({
      '/search/users': () => new Response(JSON.stringify({ items: [] }), { status: 200 }),
    });
    const result = await productGithubReleasesAdapter.run(ctxWith(http));
    expect(result.status).toBe('empty');
    expect(result.payload!.publicRepos).toEqual([]);
    expect(result.payload!.languageDistribution).toEqual({});
  });

  it('returns error on API failure', async () => {
    const http = fakeFetch({
      '/search/users': () => new Response('boom', { status: 500 }),
    });
    const result = await productGithubReleasesAdapter.run(ctxWith(http));
    expect(result.status).toBe('error');
    expect(result.errors?.[0]).toContain('github_releases');
  });
});
