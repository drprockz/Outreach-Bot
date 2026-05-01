import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { zaubacorpAdapter, parseToflerPage } from '../../../src/adapters/directories/zaubacorp.js';
import type { AdapterContext } from '../../../src/types.js';

const fullHtml = readFileSync(
  join(__dirname, '../../fixtures/directories/zaubacorp-tofler.html'),
  'utf8',
);

function makeCtx(overrides: Partial<AdapterContext> = {}): AdapterContext {
  const noop = () => {};
  return {
    input: { name: 'Acme Technologies', domain: 'acme.com' },
    http: (() => {}) as unknown as typeof fetch,
    cache: { read: async () => null, write: async () => {}, clear: async () => {} },
    logger: { debug: noop, info: noop, warn: noop, error: noop, child: () => makeCtx().logger },
    env: {},
    signal: new AbortController().signal,
    ...overrides,
  };
}

describe('zaubacorpAdapter', () => {
  it('contract surface', () => {
    expect(zaubacorpAdapter.name).toBe('directories.zaubacorp');
    expect(zaubacorpAdapter.module).toBe('directories');
    expect(zaubacorpAdapter.version).toBe('0.1.0');
    expect(zaubacorpAdapter.estimatedCostInr).toBe(0);
    expect(zaubacorpAdapter.requiredEnv).toHaveLength(0);
    expect(zaubacorpAdapter.cacheTtlMs).toBe(7 * 86_400_000);
  });

  it('parses full Tofler fixture with CIN, capital, directors, address', () => {
    const url = 'https://www.tofler.in/acme-technologies/company';
    const payload = parseToflerPage(fullHtml, url);

    expect(payload.cin).toBe('U72900MH2018PTC302145');
    expect(payload.registeredOn).toBe('2018-03-15');
    expect(payload.registrar).toBe('RoC-Mumbai');
    expect(payload.status).toBe('Active');
    expect(payload.authorizedCapitalInr).toBe(1_000_000);
    expect(payload.paidUpCapitalInr).toBe(500_000);
    expect(payload.registeredAddress).toBeTruthy();
    expect(payload.directors).toHaveLength(2);
    expect(payload.directors[0]!.name).toBe('Rahul Sharma');
    expect(payload.directors[0]!.din).toBe('01234567');
    expect(payload.directors[0]!.appointedOn).toBe('2018-03-15');
    expect(payload.country).toBe('India');
    expect(payload.toflerUrl).toBe(url);
  });

  it('returns partial payload when optional fields are missing', () => {
    const minimalHtml = `<html><body>
      <table><tbody>
        <tr><th>CIN</th><td>U12345MH2020PTC999999</td></tr>
        <tr><th>Company Status</th><td>Active</td></tr>
      </tbody></table>
    </body></html>`;
    const payload = parseToflerPage(minimalHtml, 'https://www.tofler.in/x/company');
    expect(payload.cin).toBe('U12345MH2020PTC999999');
    expect(payload.status).toBe('Active');
    expect(payload.directors).toHaveLength(0);
    expect(payload.paidUpCapitalInr).toBeNull();
    expect(payload.authorizedCapitalInr).toBeNull();
    expect(payload.country).toBe('India');
  });

  it('returns status:error on 403 (Cloudflare block)', async () => {
    const fakeFetch = async () => new Response('Forbidden', { status: 403 });
    const ctx = makeCtx({ http: fakeFetch as unknown as typeof fetch });
    const result = await zaubacorpAdapter.run(ctx);
    expect(result.status).toBe('error');
    expect(result.errors?.[0]).toMatch(/403/);
    expect(result.payload).toBeNull();
  });

  it('returns ok status when Tofler page fetched successfully', async () => {
    const fakeFetch = async () => new Response(fullHtml, { status: 200 });
    const ctx = makeCtx({ http: fakeFetch as unknown as typeof fetch });
    const result = await zaubacorpAdapter.run(ctx);
    expect(result.status).toBe('ok');
    expect(result.payload!.cin).toBe('U72900MH2018PTC302145');
    expect(result.payload!.country).toBe('India');
  });
});
