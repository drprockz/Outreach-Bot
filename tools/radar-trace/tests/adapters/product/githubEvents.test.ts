import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { productGithubEventsAdapter } from '../../../src/adapters/product/githubEvents.js';
import type { AdapterContext } from '../../../src/types.js';
import { EMPTY_ANCHORS } from '../../../src/types.js';

// Pin date so isWithinDays assertions stay valid
beforeAll(() => { vi.useFakeTimers({ now: new Date('2026-05-01T12:00:00Z') }); });
afterAll(() => { vi.useRealTimers(); });

const orgsFixture = JSON.parse(readFileSync(join(__dirname, '../../fixtures/product/github-orgs.json'), 'utf8'));
const eventsFixture = JSON.parse(readFileSync(join(__dirname, '../../fixtures/product/github-events.json'), 'utf8'));

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

describe('productGithubEventsAdapter', () => {
  it('exposes new contract fields', () => {
    expect(productGithubEventsAdapter.name).toBe('product.github_events');
    expect(productGithubEventsAdapter.module).toBe('product');
    expect(productGithubEventsAdapter.requiredEnv).toEqual(['GITHUB_TOKEN']);
    expect(productGithubEventsAdapter.estimatedCostInr).toBe(0);
    expect(productGithubEventsAdapter.gate).toBeUndefined();
  });

  it('returns ok with commitVelocity30d and recentReleases', async () => {
    const http = fakeFetch({
      '/search/users': () => new Response(JSON.stringify(orgsFixture), { status: 200 }),
      '/users/acme/events': () => new Response(JSON.stringify(eventsFixture), { status: 200 }),
    });
    const result = await productGithubEventsAdapter.run(ctxWith(http));
    expect(result.status).toBe('ok');
    expect(result.payload!.commitVelocity30d).toBeGreaterThan(0);
    expect(result.payload!.recentReleases.length).toBeGreaterThanOrEqual(1);
  });

  it('returns empty when no org found', async () => {
    const http = fakeFetch({
      '/search/users': () => new Response(JSON.stringify({ items: [] }), { status: 200 }),
    });
    const result = await productGithubEventsAdapter.run(ctxWith(http));
    expect(result.status).toBe('empty');
    expect(result.payload!.commitVelocity30d).toBe(0);
    expect(result.payload!.recentReleases).toEqual([]);
  });

  it('returns error on API failure', async () => {
    const http = fakeFetch({
      '/search/users': () => new Response('boom', { status: 500 }),
    });
    const result = await productGithubEventsAdapter.run(ctxWith(http));
    expect(result.status).toBe('error');
    expect(result.errors?.[0]).toContain('github_events');
  });
});
