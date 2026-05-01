import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { operationalRobotsTxtAdapter } from '../../../src/adapters/operational/robotsTxt.js';
import type { AdapterContext } from '../../../src/types.js';

const robotsTxtFixture = readFileSync(join(__dirname, '../../fixtures/operational/robots.txt'), 'utf8');

function ctxWith(http: typeof fetch): AdapterContext {
  const noop = () => {};
  return {
    input: { name: 'Acme', domain: 'acme.com' },
    http,
    cache: { read: async () => null, write: async () => {}, clear: async () => {} },
    logger: { debug: noop, info: noop, warn: noop, error: noop, child: () => ctxWith(http).logger },
    env: {},
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

describe('operationalRobotsTxtAdapter', () => {
  it('contract surface', () => {
    expect(operationalRobotsTxtAdapter.name).toBe('operational.robots_txt');
    expect(operationalRobotsTxtAdapter.module).toBe('operational');
    expect(operationalRobotsTxtAdapter.requiredEnv).toEqual([]);
    expect(operationalRobotsTxtAdapter.estimatedCostInr).toBe(0);
    expect(operationalRobotsTxtAdapter.gate).toBeUndefined();
  });

  it('parses robots.txt fixture and extracts stack hints correctly', async () => {
    const http = fakeFetch({
      '/robots.txt': () => new Response(robotsTxtFixture, { status: 200, headers: { 'content-type': 'text/plain' } }),
    });
    const result = await operationalRobotsTxtAdapter.run(ctxWith(http));
    expect(result.status).toBe('ok');
    const p = result.payload!;
    expect(p.raw).toContain('wp-admin');
    expect(p.userAgents).toContain('*');
    expect(p.userAgents).toContain('Googlebot');
    expect(p.disallows).toContain('/wp-admin/');
    expect(p.disallows).toContain('/admin/');
    expect(p.stackHints).toContain('wordpress');
    expect(p.stackHints).toContain('admin');
    expect(p.hasSitemap).toBe(true);
  });

  it('returns empty on 404', async () => {
    const http = fakeFetch({
      '/robots.txt': () => new Response('not found', { status: 404 }),
    });
    const result = await operationalRobotsTxtAdapter.run(ctxWith(http));
    expect(result.status).toBe('empty');
    expect(result.payload!.disallows).toEqual([]);
    expect(result.payload!.stackHints).toEqual([]);
    expect(result.payload!.hasSitemap).toBe(false);
  });
});
