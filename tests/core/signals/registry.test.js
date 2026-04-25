import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('registry.getEnabledAdapters', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.SIGNALS_ENABLED;
    delete process.env.SIGNALS_ADAPTERS_ENABLED;
  });

  it('returns empty array when SIGNALS_ENABLED=false', async () => {
    process.env.SIGNALS_ENABLED = 'false';
    const { getEnabledAdapters } = await import('../../../src/core/signals/registry.js');
    expect(getEnabledAdapters()).toEqual([]);
  });

  it('returns empty array when SIGNALS_ENABLED is unset', async () => {
    const { getEnabledAdapters } = await import('../../../src/core/signals/registry.js');
    expect(getEnabledAdapters()).toEqual([]);
  });

  it('returns only adapters listed in SIGNALS_ADAPTERS_ENABLED', async () => {
    process.env.SIGNALS_ENABLED = 'true';
    process.env.SIGNALS_ADAPTERS_ENABLED = 'google_news,company_blog';
    const { getEnabledAdapters } = await import('../../../src/core/signals/registry.js');
    const names = getEnabledAdapters().map(a => a.name);
    expect(names).toEqual(['google_news', 'company_blog']);
  });

  it('ignores unknown adapter names', async () => {
    process.env.SIGNALS_ENABLED = 'true';
    process.env.SIGNALS_ADAPTERS_ENABLED = 'google_news,nonexistent';
    const { getEnabledAdapters } = await import('../../../src/core/signals/registry.js');
    expect(getEnabledAdapters().map(a => a.name)).toEqual(['google_news']);
  });

  it('trims whitespace around adapter names', async () => {
    process.env.SIGNALS_ENABLED = 'true';
    process.env.SIGNALS_ADAPTERS_ENABLED = ' google_news , company_blog ';
    const { getEnabledAdapters } = await import('../../../src/core/signals/registry.js');
    expect(getEnabledAdapters().map(a => a.name)).toEqual(['google_news', 'company_blog']);
  });
});
