import { describe, it, expect } from 'vitest';
import {
  AdapterResultSchema,
  SignalSummarySchema,
  CompanySchema,
  RadarTraceDossierSchema,
  ALL_MODULE_NAMES,
} from '../src/schemas.js';

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

  it('parses a result with costMeta', () => {
    const r = AdapterResultSchema.safeParse({
      source: 'x.y',
      fetchedAt: '2026-05-01T00:00:00.000Z',
      status: 'ok',
      payload: null,
      costPaise: 0,
      durationMs: 0,
      costMeta: { apifyResults: 5, costUsd: 0.02 },
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
  it('accepts null (Phase 1A)', () => {
    expect(SignalSummarySchema.safeParse(null).success).toBe(true);
  });

  it('accepts an arbitrary object (Phase 2 forward-compat)', () => {
    expect(SignalSummarySchema.safeParse({ topSignals: [], suggestedHooks: [] }).success).toBe(true);
  });

  it('rejects a non-null primitive', () => {
    expect(SignalSummarySchema.safeParse('string').success).toBe(false);
    expect(SignalSummarySchema.safeParse(42).success).toBe(false);
  });
});

describe('CompanySchema', () => {
  it('parses minimal valid input', () => {
    expect(CompanySchema.safeParse({ name: 'Acme', domain: 'acme.com' }).success).toBe(true);
  });
  it('rejects empty name', () => {
    expect(CompanySchema.safeParse({ name: '', domain: 'acme.com' }).success).toBe(false);
  });
  it('rejects missing domain', () => {
    expect(CompanySchema.safeParse({ name: 'Acme' }).success).toBe(false);
  });
  it('accepts optional location and founder', () => {
    expect(CompanySchema.safeParse({
      name: 'Acme', domain: 'acme.com', location: 'Mumbai, India', founder: 'Jane',
    }).success).toBe(true);
  });
  it('accepts founderLinkedinUrl', () => {
    expect(CompanySchema.safeParse({
      name: 'Acme', domain: 'acme.com', founderLinkedinUrl: 'https://linkedin.com/in/jane',
    }).success).toBe(true);
  });
});

describe('ALL_MODULE_NAMES', () => {
  it('contains all 9 modules', () => {
    expect(ALL_MODULE_NAMES).toEqual([
      'hiring', 'product', 'customer', 'voice', 'operational',
      'positioning', 'social', 'ads', 'directories',
    ]);
  });
});

describe('RadarTraceDossierSchema', () => {
  const minimalAdapter = {
    source: 'x.y', fetchedAt: '2026-05-01T00:00:00.000Z',
    status: 'empty', payload: null, costPaise: 0, durationMs: 0,
  };
  const minimalDossier = {
    radarTraceVersion: '1.0.0',
    company: { name: 'Acme', domain: 'acme.com' },
    tracedAt: '2026-05-01T00:00:00.000Z',
    totalCostInr: 0,
    totalCostBreakdown: {
      serper: 0, brave: 0, listenNotes: 0, pagespeed: 0, apifyUsd: 0, apifyInr: 0,
    },
    totalDurationMs: 0,
    adapters: { 'x.y': minimalAdapter },
    modules: {
      hiring: { adapters: [] }, product: { adapters: [] },
      customer: { adapters: [] }, voice: { adapters: [] },
      operational: { adapters: [] }, positioning: { adapters: [] },
      social: { adapters: [] }, ads: { adapters: [] },
      directories: { adapters: [] },
    },
    signalSummary: null,
  };

  it('parses a minimal dossier', () => {
    expect(RadarTraceDossierSchema.safeParse(minimalDossier).success).toBe(true);
  });

  it('rejects dossier missing radarTraceVersion', () => {
    const { radarTraceVersion: _v, ...rest } = minimalDossier;
    expect(RadarTraceDossierSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects dossier missing one of the nine modules', () => {
    const { modules: _m, ...rest } = minimalDossier;
    const broken = { ...rest, modules: { ...minimalDossier.modules, ads: undefined } };
    expect(RadarTraceDossierSchema.safeParse(broken).success).toBe(false);
  });

  it('signalSummary may be null (Phase 1A) or an object (Phase 2 forward-compat)', () => {
    expect(RadarTraceDossierSchema.safeParse({ ...minimalDossier, signalSummary: null }).success).toBe(true);
    expect(RadarTraceDossierSchema.safeParse({ ...minimalDossier, signalSummary: {} }).success).toBe(true);
  });

  it('adapters entry may include costMeta', () => {
    const withMeta = {
      ...minimalDossier,
      adapters: {
        'x.y': { ...minimalAdapter, costMeta: { apifyResults: 3, costUsd: 0.01 } },
      },
    };
    expect(RadarTraceDossierSchema.safeParse(withMeta).success).toBe(true);
  });
});
