import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createBraveClient } from '../../src/clients/brave.js';

const newsFixture = JSON.parse(readFileSync(join(__dirname, '../fixtures/brave/news-search.json'), 'utf8'));

describe('BraveClient', () => {
  it('newsSearch() GETs /news/search with subscription token header', async () => {
    let seenHeaders: Record<string, string> = {};
    let seenUrl = '';
    const fakeFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      seenUrl = typeof url === 'string' ? url : url.toString();
      seenHeaders = Object.fromEntries(new Headers(init?.headers).entries());
      return new Response(JSON.stringify(newsFixture), { status: 200 });
    }) as unknown as typeof fetch;
    const client = createBraveClient({ apiKey: 'fake-brave-key', http: fakeFetch });
    const result = await client.newsSearch({ q: '"Acme Corp" acme.com' });
    expect(seenUrl).toContain('api.search.brave.com');
    expect(seenUrl).toContain('/news/search');
    expect(seenHeaders['x-subscription-token']).toBe('fake-brave-key');
    expect(result.costPaise).toBe(50);
  });

  it('parses fixture correctly into results array', async () => {
    const fakeFetch = vi.fn(async () => new Response(JSON.stringify(newsFixture), { status: 200 })) as unknown as typeof fetch;
    const client = createBraveClient({ apiKey: 'fake-brave-key', http: fakeFetch });
    const result = await client.newsSearch({ q: '"Acme Corp" acme.com' });
    expect(result.results.length).toBe(2);
    expect(result.results[0]!.title).toBe('Acme Corp Raises $10M in Series A Funding');
    expect(result.results[0]!.profile?.name).toBe('TechCrunch');
    expect(result.results[1]!.url).toContain('businessinsider.com');
  });

  it('throws on 4xx response', async () => {
    const fakeFetch = vi.fn(async () => new Response('unauthorized', { status: 401 })) as unknown as typeof fetch;
    const client = createBraveClient({ apiKey: 'bad-key', http: fakeFetch });
    await expect(client.newsSearch({ q: 'x' })).rejects.toThrow(/brave.*401/i);
  });
});
