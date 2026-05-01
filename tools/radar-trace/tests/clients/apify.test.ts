import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createApifyClient } from '../../src/clients/apify.js';

const runSyncFixture = JSON.parse(
  readFileSync(join(__dirname, '../fixtures/apify/run-sync-response.json'), 'utf8'),
) as unknown[];

function makeFakeFetch(body: unknown, status = 200) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    new Response(JSON.stringify(body), { status }),
  ) as unknown as typeof fetch;
}

describe('ApifyClient', () => {
  it('factory returns an object with runActor method', () => {
    const client = createApifyClient({ token: 'fake-token' });
    expect(typeof client.runActor).toBe('function');
  });

  it('POSTs to the correct Apify run-sync URL with token in query string', async () => {
    let seenUrl = '';
    let seenInit: RequestInit | undefined;
    const fakeFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      seenUrl = typeof url === 'string' ? url : url.toString();
      seenInit = init;
      return new Response(JSON.stringify([]), { status: 200 });
    }) as unknown as typeof fetch;

    const client = createApifyClient({ token: 'my-secret-token', http: fakeFetch });
    await client.runActor({ actor: 'test/actor', input: {}, costPerResultUsd: 0.005 });

    expect(seenUrl).toContain('https://api.apify.com/v2/acts/test%2Factor/run-sync-get-dataset-items');
    expect(seenUrl).toContain('token=my-secret-token');
    expect(seenInit?.method).toBe('POST');
  });

  it('sends the input JSON as POST body with content-type application/json', async () => {
    let seenBody: string | null = null;
    const fakeFetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      seenBody = init?.body as string;
      return new Response(JSON.stringify([]), { status: 200 });
    }) as unknown as typeof fetch;

    const client = createApifyClient({ token: 'tok', http: fakeFetch });
    const input = { linkedinCompanyUrl: 'https://www.linkedin.com/company/acme/', limit: 1 };
    await client.runActor({ actor: 'some/actor', input, costPerResultUsd: 0.005 });

    expect(JSON.parse(seenBody!)).toEqual(input);
    const headers = new Headers(
      (vi.mocked(fakeFetch).mock.calls[0]![1] as RequestInit | undefined)?.headers,
    );
    expect(headers.get('content-type')).toBe('application/json');
  });

  it('parses dataset items and computes cost as count × rate', async () => {
    const fakeFetch = makeFakeFetch(runSyncFixture); // 2 items
    const client = createApifyClient({ token: 'tok', http: fakeFetch });
    const result = await client.runActor<{ name: string }>({
      actor: 'a/b',
      input: {},
      costPerResultUsd: 0.005,
    });

    expect(result.items).toHaveLength(2);
    expect(result.costUsd).toBeCloseTo(2 * 0.005);
    expect(result.truncated).toBe(false);
  });

  it('truncates items to maxResults and sets truncated: true when actor returns more', async () => {
    const fakeFetch = makeFakeFetch(runSyncFixture); // 2 items
    const client = createApifyClient({ token: 'tok', http: fakeFetch });
    const result = await client.runActor<{ name: string }>({
      actor: 'a/b',
      input: {},
      costPerResultUsd: 0.01,
      maxResults: 1,   // cap at 1 — fixture has 2
    });

    expect(result.items).toHaveLength(1);
    expect(result.truncated).toBe(true);
    // Cost is based on kept items only
    expect(result.costUsd).toBeCloseTo(1 * 0.01);
  });

  it('throws on non-2xx response', async () => {
    const fakeFetch = makeFakeFetch('Unauthorized', 401);
    const client = createApifyClient({ token: 'bad', http: fakeFetch });
    await expect(
      client.runActor({ actor: 'x/y', input: {}, costPerResultUsd: 0.005 }),
    ).rejects.toThrow(/apify.*401/i);
  });
});
