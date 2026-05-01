import { describe, it, expect } from 'vitest';
import { operationalHttpHeadersAdapter } from '../../../src/adapters/operational/httpHeaders.js';
import type { AdapterContext } from '../../../src/types.js';

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

function fakeFetch(handler: (url: string, init?: RequestInit) => Response): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const u = typeof url === 'string' ? url : url.toString();
    return handler(u, init);
  }) as typeof fetch;
}

describe('operationalHttpHeadersAdapter', () => {
  it('contract surface', () => {
    expect(operationalHttpHeadersAdapter.name).toBe('operational.http_headers');
    expect(operationalHttpHeadersAdapter.module).toBe('operational');
    expect(operationalHttpHeadersAdapter.requiredEnv).toEqual([]);
    expect(operationalHttpHeadersAdapter.estimatedCostInr).toBe(0);
    expect(operationalHttpHeadersAdapter.gate).toBeUndefined();
  });

  it('extracts all security headers when present', async () => {
    const http = fakeFetch((_url, init) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'HEAD') {
        const headers = new Headers({
          'server': 'nginx/1.24',
          'x-powered-by': 'Express',
          'content-security-policy': "default-src 'self'",
          'strict-transport-security': 'max-age=31536000',
          'x-frame-options': 'SAMEORIGIN',
          'x-content-type-options': 'nosniff',
          'referrer-policy': 'strict-origin-when-cross-origin',
          'permissions-policy': 'camera=(), microphone=()',
          'cache-control': 'no-cache',
        });
        return new Response(null, { status: 200, headers });
      }
      return new Response('ok', { status: 200 });
    });
    const result = await operationalHttpHeadersAdapter.run(ctxWith(http));
    expect(result.status).toBe('ok');
    const p = result.payload!;
    expect(p.server).toBe('nginx/1.24');
    expect(p.xPoweredBy).toBe('Express');
    expect(p.contentSecurityPolicy).toContain("default-src");
    expect(p.strictTransportSecurity).toBe('max-age=31536000');
    expect(p.xFrameOptions).toBe('SAMEORIGIN');
    expect(p.xContentTypeOptions).toBe('nosniff');
    expect(p.referrerPolicy).toBe('strict-origin-when-cross-origin');
    expect(p.permissionsPolicy).toContain('camera=()');
    expect(p.cacheControl).toBe('no-cache');
  });

  it('returns ok with nulls for missing headers (partial info is still ok)', async () => {
    const http = fakeFetch((_url, init) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'HEAD') {
        const headers = new Headers({
          'server': 'cloudflare',
          'strict-transport-security': 'max-age=604800',
        });
        return new Response(null, { status: 200, headers });
      }
      return new Response('ok', { status: 200 });
    });
    const result = await operationalHttpHeadersAdapter.run(ctxWith(http));
    expect(result.status).toBe('ok');
    const p = result.payload!;
    expect(p.server).toBe('cloudflare');
    expect(p.xPoweredBy).toBeNull();
    expect(p.contentSecurityPolicy).toBeNull();
    expect(p.xFrameOptions).toBeNull();
  });
});
