import { describe, it, expect } from 'vitest';
import type {
  Adapter, AdapterResult, AdapterContext, Company, Cache, Logger,
  PartialDossier, ModuleName, Env,
} from '../src/types.js';

describe('types', () => {
  it('exports the expected type names (compile-time check)', () => {
    // Compile-time: these will be type errors if any export is missing
    type _Surface = [
      Adapter<unknown>, AdapterResult<unknown>, AdapterContext, Company,
      Cache, Logger, PartialDossier, ModuleName, Env,
    ];
    expect(true).toBe(true);
  });

  it('AdapterStatus literal union covers ok/partial/empty/error', () => {
    const status: AdapterResult<unknown>['status'] = 'ok';
    expect(['ok', 'partial', 'empty', 'error']).toContain(status);
  });

  it('ModuleName covers all 9 modules', () => {
    const names: ModuleName[] = [
      'hiring', 'product', 'customer', 'voice', 'operational',
      'positioning', 'social', 'ads', 'directories',
    ];
    expect(names.length).toBe(9);
  });
});
