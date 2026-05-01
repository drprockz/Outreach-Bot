import { describe, it, expect } from 'vitest';
import { mapContext } from '../../src/synthesis/contextMapper.js';
import type { AdapterResult, CompanyInput } from '../../src/types.js';
import type { HiringPayload } from '../../src/adapters/hiring.js';
import type { ProductPayload } from '../../src/adapters/product.js';
import type { CustomerPayload } from '../../src/adapters/customer.js';
import type { OperationalPayload } from '../../src/adapters/operational.js';

const company: CompanyInput = { name: 'Acme Corp', domain: 'acme.com', location: 'Mumbai, India' };

function ok<T>(payload: T): AdapterResult<T> {
  return { source: '', fetchedAt: '', status: 'ok', payload, costPaise: 0, durationMs: 0 };
}
function empty(name: string): AdapterResult<null> {
  return { source: name, fetchedAt: '', status: 'empty', payload: null, costPaise: 0, durationMs: 0 };
}

describe('mapContext', () => {
  it('builds lead from CompanyInput', () => {
    const ctx = mapContext(company, {
      hiring: empty('hiring'), product: empty('product'),
      customer: empty('customer'), operational: empty('operational'),
    });
    expect(ctx.lead.business_name).toBe('Acme Corp');
    expect(ctx.lead.website_url).toBe('acme.com');
    expect(ctx.lead.manual_hook_note).toBeNull();
  });

  it('default persona role is "founder" when operational is empty', () => {
    const ctx = mapContext(company, {
      hiring: empty('hiring'), product: empty('product'),
      customer: empty('customer'), operational: empty('operational'),
    });
    expect(ctx.persona.role).toBe('founder');
  });

  it('infers persona role from techStack when operational has Stripe + Segment + dashboard subdomain', () => {
    const op: OperationalPayload = {
      techStack: [{ name: 'Stripe', category: 'payments', confidence: 1 }, { name: 'Segment', category: 'cdp', confidence: 1 }],
      emailProvider: 'Google',
      knownSaaSVerifications: [],
      subdomains: ['app.acme.com', 'dashboard.acme.com'],
      notableSubdomains: ['app.acme.com', 'dashboard.acme.com'],
    };
    const ctx = mapContext(company, {
      hiring: empty('hiring'), product: empty('product'),
      customer: empty('customer'), operational: ok(op) as unknown as AdapterResult<unknown>,
    });
    expect(ctx.persona.role).toBe('B2B SaaS founder');
  });

  it('flattens hiring payload into signals (senior + new function)', () => {
    const h: HiringPayload = {
      totalActiveJobs: 2, jobsLast30Days: 2, jobsLast90Days: 2,
      byFunction: { eng: 1, sales: 1 },
      bySeniority: { senior: 1, mid: 1 },
      byLocation: { Mumbai: 2 },
      newRoleTypes: ['sales'],
      rawJobs: [
        { source: 'adzuna', title: 'Senior Backend Engineer', location: 'Mumbai', date: new Date(Date.now() - 5 * 86400000).toISOString().slice(0,10), url: null, function: 'eng', seniority: 'senior' },
        { source: 'adzuna', title: 'Account Executive', location: 'Mumbai', date: new Date(Date.now() - 10 * 86400000).toISOString().slice(0,10), url: null, function: 'sales', seniority: 'mid' },
      ],
    };
    const ctx = mapContext(company, {
      hiring: ok(h) as unknown as AdapterResult<unknown>,
      product: empty('product'), customer: empty('customer'), operational: empty('operational'),
    });
    const types = ctx.signals.map((s) => s.signalType);
    expect(types).toContain('hiring_senior');
    expect(types).toContain('hiring_new_function');
  });

  it('flattens product payload into signals (new repo, release, changelog)', () => {
    const p: ProductPayload = {
      githubOrg: 'acme',
      publicRepos: [{ name: 'demo-app', description: null, language: 'TS', stars: 5, pushedAt: null, createdAt: '2026-04-25T00:00:00Z', url: 'https://github.com/acme/demo-app' }],
      recentNewRepos: [{ name: 'demo-app', description: null, language: 'TS', stars: 5, pushedAt: null, createdAt: '2026-04-25T00:00:00Z', url: 'https://github.com/acme/demo-app' }],
      commitVelocity30d: 12,
      languageDistribution: { TS: 1 },
      recentReleases: [{ repo: 'acme/core', tag: 'v2.1.0', title: 'April', url: 'https://github.com/acme/core/releases/tag/v2.1.0', date: '2026-04-28T00:00:00Z' }],
      changelogEntries: [{ title: 'Shipped: New widget', date: '2026-04-29', url: '/changelog/widget' }],
    };
    const ctx = mapContext(company, {
      hiring: empty('hiring'),
      product: ok(p) as unknown as AdapterResult<unknown>,
      customer: empty('customer'), operational: empty('operational'),
    });
    const types = ctx.signals.map((s) => s.signalType);
    expect(types).toContain('product_repo_new');
    expect(types).toContain('product_release');
    expect(types).toContain('product_changelog');
  });

  it('flattens customer payload into signals (added logo, pricing change, hero change)', () => {
    const c: CustomerPayload = {
      customersPageUrl: 'https://acme.com/customers',
      currentLogos: ['Acme', 'Foo Corp'],
      snapshotsAnalyzed: [],
      addedLogosLast90d: ['Foo Corp'],
      removedLogosLast90d: [],
      pricingChanges: [{ detectedAt: '2026-04-15T00:00:00Z', previousSnapshotUrl: 'a', currentSnapshotUrl: 'b', changeSummary: 'Starter $29 → $39' }],
      heroChanges: [{ detectedAt: '2026-04-10T00:00:00Z', previousH1: 'Old', currentH1: 'New', previousFirstParagraph: null, currentFirstParagraph: null }],
    };
    const ctx = mapContext(company, {
      hiring: empty('hiring'), product: empty('product'),
      customer: ok(c) as unknown as AdapterResult<unknown>,
      operational: empty('operational'),
    });
    const types = ctx.signals.map((s) => s.signalType);
    expect(types).toContain('customer_added');
    expect(types).toContain('pricing_change');
    expect(types).toContain('positioning_change');
  });

  it('flattens operational payload into signals (tech_present, subdomain_notable)', () => {
    const op: OperationalPayload = {
      techStack: [{ name: 'Sentry', category: 'monitoring', confidence: 1 }],
      emailProvider: 'Google',
      knownSaaSVerifications: [],
      subdomains: ['app.acme.com'],
      notableSubdomains: ['app.acme.com'],
    };
    const ctx = mapContext(company, {
      hiring: empty('hiring'), product: empty('product'),
      customer: empty('customer'),
      operational: ok(op) as unknown as AdapterResult<unknown>,
    });
    const types = ctx.signals.map((s) => s.signalType);
    expect(types).toContain('tech_present');
    expect(types).toContain('subdomain_notable');
  });

  it('signals are sorted by confidence descending', () => {
    const c: CustomerPayload = {
      customersPageUrl: 'x', currentLogos: [], snapshotsAnalyzed: [],
      addedLogosLast90d: ['Foo'],   // confidence 0.9
      removedLogosLast90d: [],
      pricingChanges: [], heroChanges: [],
    };
    const op: OperationalPayload = {
      techStack: [{ name: 'Sentry', category: 'monitoring', confidence: 1 }],   // → confidence 0.6 (tech_present)
      emailProvider: null, knownSaaSVerifications: [], subdomains: [], notableSubdomains: [],
    };
    const ctx = mapContext(company, {
      hiring: empty('hiring'), product: empty('product'),
      customer: ok(c) as unknown as AdapterResult<unknown>,
      operational: ok(op) as unknown as AdapterResult<unknown>,
    });
    const confs = ctx.signals.map((s) => s.confidence!);
    for (let i = 1; i < confs.length; i++) {
      expect(confs[i - 1]).toBeGreaterThanOrEqual(confs[i]!);
    }
  });
});
