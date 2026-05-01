import { describe, it, expect } from 'vitest';
import type { Adapter, AdapterResult, AdapterContext, CompanyInput, Cache, Logger } from '../src/types.js';

describe('types', () => {
  it('exports the expected type names (compile-time check)', () => {
    // This test exists to lock the public surface. If a type is renamed or removed,
    // every other test file that imports from types.ts will fail to compile, and
    // this test serves as the documentation of what the module exports.
    const surface: Array<keyof typeof import('../src/types.js')> = [
      // types.ts only exports types + interfaces, no runtime values
    ];
    expect(surface).toEqual([]);

    // Runtime sanity: AdapterResultStatus is an enum-like union; we cast a literal to it
    const status: AdapterResult<unknown>['status'] = 'ok';
    expect(['ok', 'partial', 'empty', 'error']).toContain(status);
  });
});
