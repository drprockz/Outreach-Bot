import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSerperClient } from '../../src/clients/serper.js';

const peopleFixture = JSON.parse(readFileSync(join(__dirname, '../fixtures/serper/people-search.json'), 'utf8'));
const newsFixture = JSON.parse(readFileSync(join(__dirname, '../fixtures/serper/news-search.json'), 'utf8'));

describe('SerperClient', () => {
  it('search() POSTs to /search with API key header and parses results', async () => {
    let seenInit: RequestInit | undefined;
    const fakeFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      seenInit = init;
      return new Response(JSON.stringify(peopleFixture), { status: 200 });
    }) as unknown as typeof fetch;
    const client = createSerperClient({ apiKey: 'fake-key', http: fakeFetch });
    const result = await client.search({ q: 'site:linkedin.com/in/ "Jane Doe"' });
    expect(seenInit?.method).toBe('POST');
    expect(new Headers(seenInit?.headers).get('x-api-key')).toBe('fake-key');
    expect(result.organic.length).toBeGreaterThan(0);
    expect(result.organic[0]!.link).toContain('linkedin.com/in/');
  });

  it('newsSearch() uses /news endpoint and returns news[]', async () => {
    let seenUrl = '';
    const fakeFetch = vi.fn(async (url: string | URL | Request) => {
      seenUrl = typeof url === 'string' ? url : url.toString();
      return new Response(JSON.stringify(newsFixture), { status: 200 });
    }) as unknown as typeof fetch;
    const client = createSerperClient({ apiKey: 'fake-key', http: fakeFetch });
    await client.newsSearch({ q: 'Acme funding' });
    expect(seenUrl).toContain('/news');
  });

  it('throws on non-2xx response', async () => {
    const fakeFetch = vi.fn(async () => new Response('rate limited', { status: 429 })) as unknown as typeof fetch;
    const client = createSerperClient({ apiKey: 'fake-key', http: fakeFetch });
    await expect(client.search({ q: 'x' })).rejects.toThrow(/serper.*429/i);
  });

  it('reports cost per call (~₹0.025 = 250 paise per 100 calls = 2.5 paise per call)', async () => {
    const fakeFetch = vi.fn(async () => new Response(JSON.stringify(peopleFixture), { status: 200 })) as unknown as typeof fetch;
    const client = createSerperClient({ apiKey: 'fake-key', http: fakeFetch });
    const result = await client.search({ q: 'x' });
    expect(result.costPaise).toBe(3); // rounded up; 2.5 paise per call → 3
  });
});
