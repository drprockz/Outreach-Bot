// findLeads.test.js
import { describe, it, expect } from 'vitest';
import { buildDiscoveryPrompt } from '../../src/engines/findLeads.js';

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
