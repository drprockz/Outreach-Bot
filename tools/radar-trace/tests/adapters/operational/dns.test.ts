import { describe, it, expect } from 'vitest';
import { makeOperationalDnsAdapter, operationalDnsAdapter } from '../../../src/adapters/operational/dns.js';
import type { AdapterContext } from '../../../src/types.js';
import { EMPTY_ANCHORS } from '../../../src/types.js';

function ctxWith(http: typeof fetch): AdapterContext {
  const noop = () => {};
  return {
    input: { name: 'Acme', domain: 'acme.com' },
    http,
    cache: { read: async () => null, write: async () => {}, clear: async () => {} },
    logger: { debug: noop, info: noop, warn: noop, error: noop, child: () => ctxWith(http).logger },
    env: {},
    signal: new AbortController().signal,
      anchors: EMPTY_ANCHORS,
  };
}

const fakeDnsOk = {
  resolveMx: async () => [{ exchange: 'aspmx.l.google.com', priority: 1 }],
  resolveTxt: async () => [['v=spf1 include:_spf.google.com'], ['intercom-domain-verification=xyz']],
};

const fakeDnsFail = {
  resolveMx: async () => { throw new Error('ENOTFOUND'); },
  resolveTxt: async () => { throw new Error('ENOTFOUND'); },
};

describe('operationalDnsAdapter', () => {
  it('exposes new contract fields (default export)', () => {
    expect(operationalDnsAdapter.name).toBe('operational.dns');
    expect(operationalDnsAdapter.module).toBe('operational');
    expect(operationalDnsAdapter.requiredEnv).toEqual([]);
    expect(operationalDnsAdapter.estimatedCostInr).toBe(0);
    expect(operationalDnsAdapter.gate).toBeUndefined();
  });

  it('factory export exists', () => {
    expect(typeof makeOperationalDnsAdapter).toBe('function');
  });
});

describe('makeOperationalDnsAdapter', () => {
  it('infers email provider from MX records', async () => {
    const adapter = makeOperationalDnsAdapter(fakeDnsOk);
    const result = await adapter.run(ctxWith(globalThis.fetch));
    expect(result.status).toBe('ok');
    expect(result.payload!.emailProvider).toBe('Google');
    expect(result.payload!.knownSaaSVerifications).toEqual(expect.arrayContaining(['intercom']));
  });

  it('tolerates DNS failure — returns error when both MX and TXT fail', async () => {
    const adapter = makeOperationalDnsAdapter(fakeDnsFail);
    const result = await adapter.run(ctxWith(globalThis.fetch));
    expect(result.status).toBe('error');
    expect(result.payload).toBeNull();
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  it('returns partial when only one of MX/TXT fails', async () => {
    const partialFail = {
      resolveMx: async () => [{ exchange: 'aspmx.l.google.com', priority: 1 }],
      resolveTxt: async (): Promise<string[][]> => { throw new Error('ENOTFOUND'); },
    };
    const adapter = makeOperationalDnsAdapter(partialFail);
    const result = await adapter.run(ctxWith(globalThis.fetch));
    expect(['ok', 'partial']).toContain(result.status);
    expect(result.payload!.emailProvider).toBe('Google');
  });
});
