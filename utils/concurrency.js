// utils/concurrency.js

/**
 * Process an array of items with at most `limit` concurrent async operations.
 * As each slot completes, the next item starts immediately — no staircase effect.
 *
 * If `fn` throws or rejects, Promise.all rejects immediately and partial results
 * are lost. Callers must wrap fn in try/catch, call logError, and return null
 * for failed/skipped items — never let fn throw.
 *
 * @param {any[]} items
 * @param {number} limit - max concurrent in-flight operations
 * @param {(item: any, index: number) => Promise<any>} fn
 * @returns {Promise<any[]>} results in same order as items
 */
export async function withConcurrency(items, limit, fn) {
  if (items.length === 0) return [];
  const results = new Array(items.length);
  let next = 0;
  const workers = Array(Math.min(limit, items.length)).fill(null).map(async () => {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}
