import { describe, it, expect } from 'vitest';
import {
  AdapterResultSchema,
  EnrichedDossierSchema,
  SignalSummarySchema,
  CompanyInputSchema,
} from '../src/schemas.js';

describe('CompanyInputSchema', () => {
  it('parses a minimal valid input', () => {
    const r = CompanyInputSchema.safeParse({ name: 'Acme', domain: 'acme.com' });
    expect(r.success).toBe(true);
  });

  it('rejects empty name', () => {
    const r = CompanyInputSchema.safeParse({ name: '', domain: 'acme.com' });
    expect(r.success).toBe(false);
  });

  it('rejects missing domain', () => {
    const r = CompanyInputSchema.safeParse({ name: 'Acme' });
    expect(r.success).toBe(false);
  });

  it('accepts optional location and founder', () => {
    const r = CompanyInputSchema.safeParse({
      name: 'Acme', domain: 'acme.com', location: 'Mumbai, India', founder: 'Jane',
    });
    expect(r.success).toBe(true);
  });
});

describe('AdapterResultSchema', () => {
  it('parses an ok result', () => {
    const r = AdapterResultSchema.safeParse({
      source: 'hiring',
      fetchedAt: '2026-05-01T00:00:00.000Z',
      status: 'ok',
      payload: { anything: 'goes' },
      costPaise: 0,
      durationMs: 100,
    });
    expect(r.success).toBe(true);
  });

  it('parses an error result with errors[]', () => {
    const r = AdapterResultSchema.safeParse({
      source: 'hiring',
      fetchedAt: '2026-05-01T00:00:00.000Z',
      status: 'error',
      payload: null,
      errors: ['ETIMEDOUT'],
      costPaise: 0,
      durationMs: 30000,
    });
    expect(r.success).toBe(true);
  });

  it('rejects an unknown status', () => {
    const r = AdapterResultSchema.safeParse({
      source: 'hiring',
      fetchedAt: '2026-05-01T00:00:00.000Z',
      status: 'banana',
      payload: null,
      costPaise: 0,
      durationMs: 0,
    });
    expect(r.success).toBe(false);
  });
});

describe('SignalSummarySchema', () => {
  it('parses with required fields and optional _debug', () => {
    const r = SignalSummarySchema.safeParse({
      topSignals: ['[customer_added] Added logo: Acme'],
      suggestedHooks: ['hook one', 'hook two', 'hook three'],
      totalCostUsd: 0.012,
    });
    expect(r.success).toBe(true);
  });

  it('accepts a _debug block when present', () => {
    const r = SignalSummarySchema.safeParse({
      topSignals: [],
      suggestedHooks: [],
      totalCostUsd: 0,
      _debug: {
        synthesizedContext: { lead: { business_name: 'X', website_url: 'x.com', manual_hook_note: null }, persona: { role: 'founder' }, signals: [] },
        stage10: { path: 'src/core/pipeline/regenerateHook.js', gitSha: 'abc' },
      },
    });
    expect(r.success).toBe(true);
  });
});

describe('EnrichedDossierSchema', () => {
  it('parses a full dossier with all 6 modules and a signalSummary', () => {
    const dossier = {
      company: { name: 'Acme', domain: 'acme.com' },
      enrichedAt: '2026-05-01T00:00:00.000Z',
      totalCostPaise: 0,
      totalDurationMs: 1000,
      modules: {
        hiring:      { source: 'hiring',      fetchedAt: 'x', status: 'empty', payload: null, costPaise: 0, durationMs: 0 },
        product:     { source: 'product',     fetchedAt: 'x', status: 'empty', payload: null, costPaise: 0, durationMs: 0 },
        customer:    { source: 'customer',    fetchedAt: 'x', status: 'empty', payload: null, costPaise: 0, durationMs: 0 },
        voice:       { source: 'voice',       fetchedAt: 'x', status: 'empty', payload: null, costPaise: 0, durationMs: 0 },
        operational: { source: 'operational', fetchedAt: 'x', status: 'empty', payload: null, costPaise: 0, durationMs: 0 },
        positioning: { source: 'positioning', fetchedAt: 'x', status: 'empty', payload: null, costPaise: 0, durationMs: 0 },
      },
      signalSummary: {
        topSignals: [],
        suggestedHooks: [],
        totalCostUsd: 0,
      },
    };
    const r = EnrichedDossierSchema.safeParse(dossier);
    expect(r.success).toBe(true);
  });

  it('rejects a dossier missing the modules block', () => {
    const r = EnrichedDossierSchema.safeParse({
      company: { name: 'Acme', domain: 'acme.com' },
      enrichedAt: '2026-05-01T00:00:00.000Z',
      totalCostPaise: 0,
      totalDurationMs: 0,
      signalSummary: { topSignals: [], suggestedHooks: [], totalCostUsd: 0 },
    });
    expect(r.success).toBe(false);
  });

  it('rejects a dossier missing one of the six modules', () => {
    const r = EnrichedDossierSchema.safeParse({
      company: { name: 'Acme', domain: 'acme.com' },
      enrichedAt: '2026-05-01T00:00:00.000Z',
      totalCostPaise: 0,
      totalDurationMs: 0,
      modules: {
        hiring:      { source: 'hiring',      fetchedAt: 'x', status: 'empty', payload: null, costPaise: 0, durationMs: 0 },
        product:     { source: 'product',     fetchedAt: 'x', status: 'empty', payload: null, costPaise: 0, durationMs: 0 },
        customer:    { source: 'customer',    fetchedAt: 'x', status: 'empty', payload: null, costPaise: 0, durationMs: 0 },
        voice:       { source: 'voice',       fetchedAt: 'x', status: 'empty', payload: null, costPaise: 0, durationMs: 0 },
        operational: { source: 'operational', fetchedAt: 'x', status: 'empty', payload: null, costPaise: 0, durationMs: 0 },
      },
      signalSummary: { topSignals: [], suggestedHooks: [], totalCostUsd: 0 },
    });
    expect(r.success).toBe(false);
  });
});
