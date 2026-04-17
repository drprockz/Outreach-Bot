import { describe, it, expect } from 'vitest';
import { sleep } from '../../../src/core/lib/sleep.js';

describe('sleep', () => {
  it('resolves after at least minMs', async () => {
    const start = Date.now();
    await sleep(10, 20);
    expect(Date.now() - start).toBeGreaterThanOrEqual(10);
  });
});
