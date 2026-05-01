import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileCache, hashCompanyInput, todayStamp } from '../src/cache.js';
import type { AdapterResult, CompanyInput } from '../src/types.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'radar-enrich-cache-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const sampleResult: AdapterResult<{ x: number }> = {
  source: 'hiring',
  fetchedAt: '2026-05-01T00:00:00.000Z',
  status: 'ok',
  payload: { x: 42 },
  costPaise: 0,
  durationMs: 100,
};

const sampleKey = {
  adapterName: 'hiring',
  adapterVersion: '1.0.0',
  inputHash: 'abc123def456',
  date: '20260501',
};

describe('createFileCache', () => {
  it('write then read returns the same value', async () => {
    const cache = createFileCache(dir);
    await cache.write(sampleKey, sampleResult);
    const got = await cache.read<{ x: number }>(sampleKey);
    expect(got).toEqual(sampleResult);
  });

  it('read returns null for a missing key', async () => {
    const cache = createFileCache(dir);
    const got = await cache.read<{ x: number }>(sampleKey);
    expect(got).toBeNull();
  });

  it('different versions produce different cache files (cache busts on version bump)', async () => {
    const cache = createFileCache(dir);
    await cache.write(sampleKey, sampleResult);
    const otherKey = { ...sampleKey, adapterVersion: '1.0.1' };
    const got = await cache.read<{ x: number }>(otherKey);
    expect(got).toBeNull();
  });

  it('different dates produce different cache files (TTL via date suffix)', async () => {
    const cache = createFileCache(dir);
    await cache.write(sampleKey, sampleResult);
    const otherKey = { ...sampleKey, date: '20260502' };
    const got = await cache.read<{ x: number }>(otherKey);
    expect(got).toBeNull();
  });

  it('clear() removes every cache file but leaves the directory', async () => {
    const cache = createFileCache(dir);
    await cache.write(sampleKey, sampleResult);
    await cache.write({ ...sampleKey, adapterName: 'product' }, sampleResult);
    await cache.clear();
    expect(await cache.read(sampleKey)).toBeNull();
    expect(existsSync(dir)).toBe(true);
  });

  it('write creates the cache directory if it does not exist', async () => {
    const sub = join(dir, 'nested', 'cache');
    const cache = createFileCache(sub);
    await cache.write(sampleKey, sampleResult);
    expect(existsSync(sub)).toBe(true);
    expect(await cache.read(sampleKey)).toEqual(sampleResult);
  });

  it('stores errored AdapterResults too (so flaky runs do not retry expensive APIs)', async () => {
    const cache = createFileCache(dir);
    const errored: AdapterResult<unknown> = {
      source: 'hiring',
      fetchedAt: '2026-05-01T00:00:00.000Z',
      status: 'error',
      payload: null,
      errors: ['ETIMEDOUT'],
      costPaise: 0,
      durationMs: 30000,
    };
    await cache.write(sampleKey, errored);
    const got = await cache.read(sampleKey);
    expect(got).toEqual(errored);
  });
});

describe('hashCompanyInput', () => {
  const input: CompanyInput = { name: 'Acme Corp', domain: 'acme.com' };

  it('returns a 12-char hex string', () => {
    const h = hashCompanyInput(input);
    expect(h).toMatch(/^[0-9a-f]{12}$/);
  });

  it('is stable for the same input', () => {
    expect(hashCompanyInput(input)).toBe(hashCompanyInput(input));
  });

  it('is insensitive to surrounding whitespace and case in name/domain', () => {
    expect(hashCompanyInput({ name: 'Acme Corp', domain: 'acme.com' }))
      .toBe(hashCompanyInput({ name: '  acme corp  ', domain: 'ACME.COM' }));
  });

  it('changes when location or founder change', () => {
    const a = hashCompanyInput(input);
    const b = hashCompanyInput({ ...input, location: 'Mumbai' });
    const c = hashCompanyInput({ ...input, founder: 'Jane' });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(b).not.toBe(c);
  });
});

describe('todayStamp', () => {
  it('returns YYYYMMDD format', () => {
    const s = todayStamp();
    expect(s).toMatch(/^\d{8}$/);
  });
});
