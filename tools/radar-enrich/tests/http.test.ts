import { describe, it, expect, vi } from 'vitest';
import { createHttp } from '../src/http.js';

function mockResponse(status: number, body = 'ok'): Response {
  return new Response(body, { status });
}

describe('createHttp', () => {
  it('passes the request through and returns the response on 2xx', async () => {
    const underlying = vi.fn(async (..._args: unknown[]) => mockResponse(200, 'hello'));
    const http = createHttp({ underlying: underlying as unknown as typeof fetch, timeoutMs: 5000 });
    const res = await http('https://example.com');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('hello');
    expect(underlying).toHaveBeenCalledTimes(1);
  });

  it('attaches a User-Agent header', async () => {
    const seen: Headers[] = [];
    const underlying = vi.fn(async (_url: unknown, init?: RequestInit) => {
      seen.push(new Headers(init?.headers));
      return mockResponse(200);
    });
    const http = createHttp({ underlying: underlying as unknown as typeof fetch, timeoutMs: 5000 });
    await http('https://example.com');
    expect(seen[0]!.get('user-agent')).toMatch(/radar-enrich/i);
  });

  it('retries once on a 5xx response', async () => {
    const underlying = vi.fn(async () => mockResponse(503));
    const http = createHttp({ underlying: underlying as unknown as typeof fetch, timeoutMs: 5000 });
    const res = await http('https://example.com');
    expect(res.status).toBe(503);
    expect(underlying).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry on a 4xx response', async () => {
    const underlying = vi.fn(async () => mockResponse(404));
    const http = createHttp({ underlying: underlying as unknown as typeof fetch, timeoutMs: 5000 });
    const res = await http('https://example.com');
    expect(res.status).toBe(404);
    expect(underlying).toHaveBeenCalledTimes(1);
  });

  it('aborts when the timeout fires', async () => {
    const underlying = vi.fn(async (_url: unknown, init?: RequestInit) => {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    });
    const http = createHttp({ underlying: underlying as unknown as typeof fetch, timeoutMs: 50 });
    await expect(http('https://example.com')).rejects.toThrow(/abort/i);
  });

  it('honors an externally-provided AbortSignal alongside the timeout', async () => {
    const externalCtrl = new AbortController();
    const underlying = vi.fn(async (_url: unknown, init?: RequestInit) => {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    });
    const http = createHttp({ underlying: underlying as unknown as typeof fetch, timeoutMs: 5000 });
    const promise = http('https://example.com', { signal: externalCtrl.signal });
    externalCtrl.abort();
    await expect(promise).rejects.toThrow(/abort/i);
  });
});
