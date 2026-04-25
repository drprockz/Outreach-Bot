import { describe, it, expect, vi } from 'vitest';
import { _test_collectSignals } from '../../../src/core/signals/index.js';

function fakeAdapter(name, signals, opts = {}) {
  return {
    name,
    timeoutMs: opts.timeoutMs || 1000,
    fetch: vi.fn(async () => {
      if (opts.throw) throw new Error(opts.throw);
      if (opts.delayMs) await new Promise(r => setTimeout(r, opts.delayMs));
      return { source: name, signals, error: null, durationMs: 0 };
    }),
  };
}

describe('orchestrator._test_collectSignals', () => {
  it('returns signals from all adapters sorted by confidence desc', async () => {
    const adapters = [
      fakeAdapter('a', [{ signalType: 'x', headline: 'h1', url: 'u1', payload: {}, confidence: 0.5, signalDate: null }]),
      fakeAdapter('b', [{ signalType: 'y', headline: 'h2', url: 'u2', payload: {}, confidence: 0.9, signalDate: null }]),
    ];
    const result = await _test_collectSignals({ id: 1 }, adapters, { persistFn: async () => {} });
    expect(result.map(s => s.confidence)).toEqual([0.9, 0.5]);
  });

  it('continues when one adapter throws', async () => {
    const adapters = [
      fakeAdapter('ok',   [{ signalType: 'x', headline: 'h', url: 'u', payload: {}, confidence: 0.8, signalDate: null }]),
      fakeAdapter('boom', [], { throw: 'kaboom' }),
    ];
    const result = await _test_collectSignals({ id: 1 }, adapters, { persistFn: async () => {} });
    expect(result).toHaveLength(1);
    expect(result[0].headline).toBe('h');
  });

  it('times out slow adapters and excludes their signals', async () => {
    const adapters = [
      fakeAdapter('slow', [{ signalType: 'x', headline: 'h', url: 'u', payload: {}, confidence: 0.8, signalDate: null }], { delayMs: 500, timeoutMs: 50 }),
    ];
    const result = await _test_collectSignals({ id: 1 }, adapters, { persistFn: async () => {} });
    expect(result).toEqual([]);
  });

  it('calls persistFn once per adapter with its signals', async () => {
    const persistFn = vi.fn(async () => {});
    const adapters = [
      fakeAdapter('a', [{ signalType: 'x', headline: 'h1', url: 'u1', payload: {}, confidence: 0.5, signalDate: null }]),
      fakeAdapter('b', [{ signalType: 'y', headline: 'h2', url: 'u2', payload: {}, confidence: 0.9, signalDate: null }]),
    ];
    await _test_collectSignals({ id: 42 }, adapters, { persistFn });
    expect(persistFn).toHaveBeenCalledTimes(2);
    expect(persistFn).toHaveBeenCalledWith(42, 'a', expect.any(Array));
    expect(persistFn).toHaveBeenCalledWith(42, 'b', expect.any(Array));
  });

  it('returns empty array when given no adapters', async () => {
    const result = await _test_collectSignals({ id: 1 }, [], { persistFn: async () => {} });
    expect(result).toEqual([]);
  });
});
