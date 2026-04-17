// utils/concurrency.test.js
import { describe, it, expect } from 'vitest';
import { withConcurrency } from './concurrency.js';

describe('withConcurrency', () => {
  it('processes all items and returns results in order', async () => {
    const items = [1, 2, 3, 4, 5];
    const results = await withConcurrency(items, 2, async (x) => x * 2);
    expect(results).toEqual([2, 4, 6, 8, 10]);
  });

  it('never exceeds the concurrency limit', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);

    await withConcurrency(items, 5, async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise(r => setTimeout(r, 10));
      inFlight--;
    });

    expect(maxInFlight).toBeLessThanOrEqual(5);
  });

  it('starts next item immediately when a slot frees, not when slowest in chunk finishes', async () => {
    const startTimes = new Array(4);
    // Item durations: [50ms, 10ms, 10ms, 10ms], limit=2
    // Rolling slots: item 1 finishes at t≈10 → item 2 starts at t≈10
    // Chunked Promise.all (wrong): chunk [0,1] finishes at t≈50 → item 2 starts at t≈50
    const durations = [50, 10, 10, 10];

    await withConcurrency(durations, 2, async (duration, idx) => {
      startTimes[idx] = Date.now();
      await new Promise(r => setTimeout(r, duration));
    });

    // Item 2 must start well before the 50ms slow item 0 finishes.
    // If chunked behavior was used, item 2 would start at ~50ms.
    // With correct rolling slots, item 2 starts at ~10ms.
    // Threshold is 40ms (not 25ms) to tolerate OS scheduler jitter under CI load.
    expect(startTimes[2]).toBeLessThan(startTimes[0] + 40);
  });

  it('handles empty array', async () => {
    const results = await withConcurrency([], 5, async (x) => x);
    expect(results).toEqual([]);
  });

  it('handles limit larger than items array', async () => {
    const items = [1, 2];
    const results = await withConcurrency(items, 100, async (x) => x + 1);
    expect(results).toEqual([2, 3]);
  });

  it('propagates thrown errors from workers', async () => {
    const items = [1, 2, 3];
    await expect(
      withConcurrency(items, 2, async (x) => {
        if (x === 2) throw new Error('fail');
        return x;
      })
    ).rejects.toThrow('fail');
  });

  it('passes both item and index to fn', async () => {
    const items = ['a', 'b', 'c'];
    const results = await withConcurrency(items, 2, async (item, idx) => `${idx}:${item}`);
    expect(results).toEqual(['0:a', '1:b', '2:c']);
  });
});
