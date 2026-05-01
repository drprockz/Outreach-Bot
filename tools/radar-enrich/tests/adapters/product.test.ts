import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { productAdapter } from '../../src/adapters/product.js';
import type { AdapterContext } from '../../src/types.js';

// Pin Date.now() so date-cohort assertions (recentNewRepos, commitVelocity30d,
// recentReleases via isWithinDays) stay valid regardless of when the test runs.
beforeAll(async () => {
  vi.useFakeTimers({ now: new Date('2026-05-01T12:00:00Z') });
});
afterAll(async () => {
  vi.useRealTimers();
});

const orgsFixture     = JSON.parse(readFileSync(join(__dirname, '../fixtures/product/github-orgs.json'), 'utf8'));
const reposFixture    = JSON.parse(readFileSync(join(__dirname, '../fixtures/product/github-repos.json'), 'utf8'));
const eventsFixture   = JSON.parse(readFileSync(join(__dirname, '../fixtures/product/github-events.json'), 'utf8'));
const changelogFixture = readFileSync(join(__dirname, '../fixtures/product/changelog.html'), 'utf8');

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

describe('productAdapter', () => {
  it('exposes the Adapter contract surface', () => {
    expect(productAdapter.name).toBe('product');
    expect(productAdapter.requiredEnv).toEqual(['GITHUB_TOKEN']);
  });

  it('returns ok with repos + events + changelog when everything succeeds', async () => {
    const http = fakeFetch({
      '/search/users': () => new Response(JSON.stringify(orgsFixture), { status: 200 }),
      '/orgs/acme/repos': () => new Response(JSON.stringify(reposFixture), { status: 200 }),
      '/users/acme/events': () => new Response(JSON.stringify(eventsFixture), { status: 200 }),
      '/changelog': () => new Response(changelogFixture, { status: 200, headers: { 'content-type': 'text/html' } }),
    });
    const result = await productAdapter.run(ctxWith(http));
    expect(result.status).toBe('ok');
    const p = result.payload!;
    expect(p.githubOrg).toBe('acme');
    expect(p.publicRepos.length).toBe(2);
    expect(p.recentNewRepos.find((r) => r.name === 'demo-app')).toBeTruthy();
    expect(p.commitVelocity30d).toBeGreaterThan(0);
    expect(p.languageDistribution.TypeScript).toBe(1);
    expect(p.recentReleases.length).toBeGreaterThanOrEqual(1);
    expect(p.changelogEntries.length).toBeGreaterThanOrEqual(1);
  });

  it('returns partial when no GitHub org found but changelog works', async () => {
    const http = fakeFetch({
      '/search/users': () => new Response(JSON.stringify({ items: [] }), { status: 200 }),
      '/changelog': () => new Response(changelogFixture, { status: 200 }),
    });
    const result = await productAdapter.run(ctxWith(http));
    expect(['partial', 'ok']).toContain(result.status);
    expect(result.payload?.githubOrg).toBeNull();
    expect(result.payload?.changelogEntries.length).toBeGreaterThan(0);
  });

  it('returns error when neither GitHub nor changelog yields anything', async () => {
    const http = fakeFetch({
      '/search/users': () => new Response('boom', { status: 500 }),
      '/changelog': () => new Response('not found', { status: 404 }),
      '/blog': () => new Response('not found', { status: 404 }),
      '/release-notes': () => new Response('not found', { status: 404 }),
      '/whats-new': () => new Response('not found', { status: 404 }),
    });
    const result = await productAdapter.run(ctxWith(http));
    expect(result.status).toBe('error');
  });
});
