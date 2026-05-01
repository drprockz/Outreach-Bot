import { describe, it, expect } from 'vitest';
import { voiceStub } from '../../src/adapters/voice.stub.js';
import { positioningStub } from '../../src/adapters/positioning.stub.js';
import type { AdapterContext } from '../../src/types.js';

function fakeCtx(): AdapterContext {
  const noop = () => {};
  return {
    input: { name: 'Acme', domain: 'acme.com' },
    http: globalThis.fetch,
    cache: { read: async () => null, write: async () => {}, clear: async () => {} },
    logger: { debug: noop, info: noop, warn: noop, error: noop, child: () => fakeCtx().logger },
    env: {},
    signal: new AbortController().signal,
  };
}

describe('voice.stub', () => {
  it('exposes the Adapter contract surface', () => {
    expect(voiceStub.name).toBe('voice');
    expect(voiceStub.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(voiceStub.requiredEnv).toEqual([]);
    expect(typeof voiceStub.run).toBe('function');
  });

  it('run() returns status:empty with payload null and zero cost', async () => {
    const result = await voiceStub.run(fakeCtx());
    expect(result.source).toBe('voice');
    expect(result.status).toBe('empty');
    expect(result.payload).toBeNull();
    expect(result.costPaise).toBe(0);
    expect(typeof result.durationMs).toBe('number');
    expect(result.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('positioning.stub', () => {
  it('exposes the Adapter contract surface', () => {
    expect(positioningStub.name).toBe('positioning');
    expect(positioningStub.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(positioningStub.requiredEnv).toEqual([]);
    expect(typeof positioningStub.run).toBe('function');
  });

  it('run() returns status:empty', async () => {
    const result = await positioningStub.run(fakeCtx());
    expect(result.source).toBe('positioning');
    expect(result.status).toBe('empty');
    expect(result.payload).toBeNull();
  });
});
