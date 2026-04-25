// findLeads.test.js
import { describe, it, expect } from 'vitest';
import { buildDiscoveryPrompt } from '../../src/engines/findLeads.js';
import { buildHookPrompt } from '../../src/core/pipeline/regenerateHook.js';

const niche = { label: 'Restaurants/cafes', query: 'Mumbai restaurant cafe outdated website' };

describe('buildDiscoveryPrompt', () => {
  it('includes city list', async () => {
    const p = await buildDiscoveryPrompt(niche, 0, 30, ['Mumbai', 'Pune'], 'msme');
    expect(p).toContain('Mumbai, Pune');
  });

  it('msme: excludes large companies', async () => {
    const p = await buildDiscoveryPrompt(niche, 0, 30, ['Mumbai'], 'msme');
    expect(p).toContain('1–10 employees');
    expect(p).toContain('EXCLUDE');
  });

  it('sme: targets regional businesses', async () => {
    const p = await buildDiscoveryPrompt(niche, 0, 30, ['Mumbai'], 'sme');
    expect(p).toContain('10–200 employees');
  });

  it('both: targets all MSME/SME', async () => {
    const p = await buildDiscoveryPrompt(niche, 0, 30, ['Mumbai'], 'both');
    expect(p).toContain('up to 200 employees');
  });

  it('includes correct batch number (1-indexed)', async () => {
    const p = await buildDiscoveryPrompt(niche, 2, 30, ['Mumbai'], 'msme');
    expect(p).toContain('Batch 3');
  });

  it('unknown size falls back to msme', async () => {
    const p = await buildDiscoveryPrompt(niche, 0, 30, ['Mumbai'], 'unknown');
    expect(p).toContain('1–10 employees');
  });

  it('includes niche label and query', async () => {
    const p = await buildDiscoveryPrompt(niche, 0, 30, ['Mumbai'], 'msme');
    expect(p).toContain('Restaurants/cafes');
    expect(p).toContain('Mumbai restaurant cafe outdated website');
  });
});

describe('buildHookPrompt', () => {
  const lead = { business_name: 'Test Salon', website_url: 'testsalon.in', manual_hook_note: null };
  const persona = { role: 'full-stack developer', name: 'Darshan', company: 'Simple Inc' };

  it('does not include competitor block when competitorAnalysis is null', () => {
    const p = buildHookPrompt('A', lead, persona, [], null);
    expect(p).not.toContain('Competitor context');
  });

  it('does not include competitor block when competitorAnalysis is undefined', () => {
    const p = buildHookPrompt('A', lead, persona, []);
    expect(p).not.toContain('Competitor context');
  });

  it('includes opportunityHook and top 2 cons when competitorAnalysis is provided', () => {
    const ca = {
      opportunityHook: 'Your rival already lists Tata Motors as a client.',
      cons: ['No SSL certificate', 'Site loads in 8 seconds', 'No case studies'],
    };
    const p = buildHookPrompt('A', lead, persona, [], ca);
    expect(p).toContain('Competitor context');
    expect(p).toContain('Your rival already lists Tata Motors as a client.');
    expect(p).toContain('No SSL certificate');
    expect(p).toContain('Site loads in 8 seconds');
    expect(p).not.toContain('No case studies');
  });

  it('works for variant B as well', () => {
    const ca = { opportunityHook: 'hook text', cons: ['con1'] };
    const p = buildHookPrompt('B', lead, persona, [], ca);
    expect(p).toContain('Competitor context');
    expect(p).toContain('hook text');
  });
});
