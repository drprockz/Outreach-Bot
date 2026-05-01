import { describe, it, expect, vi } from 'vitest';
import { generateHooks } from '../../src/synthesis/hookGenerator.js';
import type { SynthesizedContext } from '../../src/synthesis/contextMapper.js';

const fakeContext: SynthesizedContext = {
  lead: { business_name: 'Acme', website_url: 'acme.com', manual_hook_note: null },
  persona: { role: 'B2B SaaS founder' },
  signals: [
    { signalType: 'customer_added', headline: 'Added logo: Foo Corp', confidence: 0.9 },
    { signalType: 'hiring_senior',  headline: 'Opened Senior Backend Engineer in Mumbai (2026-04-25)', confidence: 0.85 },
    { signalType: 'product_release', headline: 'Released v2.1.0: April', confidence: 0.85 },
    { signalType: 'subdomain_notable', headline: 'Subdomain app.acme.com is live', confidence: 0.75 },
    { signalType: 'tech_added', headline: 'Added Sentry to stack', confidence: 0.6 },
    { signalType: 'tech_added', headline: 'Added Stripe to stack', confidence: 0.6 },
  ],
};

describe('generateHooks', () => {
  it('calls regenerateHook 3 times in parallel and returns 3 suggestedHooks', async () => {
    const fakeRegenerate = vi.fn(async () => ({
      hook: `hook-${Math.random().toString(36).slice(2, 6)}`,
      costUsd: 0.004, model: 'claude-sonnet-4', hookVariantId: 'A' as const,
    }));
    const result = await generateHooks(fakeContext, { regenerateHook: fakeRegenerate });
    expect(fakeRegenerate).toHaveBeenCalledTimes(3);
    expect(result.suggestedHooks.length).toBe(3);
    expect(result.suggestedHooks.every((h) => h.startsWith('hook-'))).toBe(true);
  });

  it('topSignals are the top 5 by confidence, formatted as "[type] headline"', async () => {
    const fakeRegenerate = vi.fn(async () => ({ hook: 'h', costUsd: 0, model: 'm', hookVariantId: 'A' as const }));
    const result = await generateHooks(fakeContext, { regenerateHook: fakeRegenerate });
    expect(result.topSignals.length).toBe(5);
    expect(result.topSignals[0]).toBe('[customer_added] Added logo: Foo Corp');
    expect(result.topSignals[1]).toBe('[hiring_senior] Opened Senior Backend Engineer in Mumbai (2026-04-25)');
  });

  it('totalCostUsd sums across the 3 calls', async () => {
    const fakeRegenerate = vi.fn(async () => ({ hook: 'h', costUsd: 0.005, model: 'm', hookVariantId: 'A' as const }));
    const result = await generateHooks(fakeContext, { regenerateHook: fakeRegenerate });
    expect(result.totalCostUsd).toBeCloseTo(0.015, 5);
  });

  it('passes lead, persona, and stripped signals (no confidence) to regenerateHook', async () => {
    const fakeRegenerate = vi.fn(async () => ({ hook: 'h', costUsd: 0, model: 'm', hookVariantId: 'A' as const }));
    await generateHooks(fakeContext, { regenerateHook: fakeRegenerate });
    const callArgs = fakeRegenerate.mock.calls[0];
    expect(callArgs).toBeDefined();
    const [lead, persona, signals] = (callArgs ?? []) as unknown[];
    expect(lead).toEqual(fakeContext.lead);
    expect(persona).toEqual(fakeContext.persona);
    expect((signals as Array<unknown>).length).toBe(fakeContext.signals.length);
    expect(((signals as Array<Record<string, unknown>>)[0] as Record<string, unknown>).confidence).toBeUndefined();
    expect((signals as Array<unknown>)[0]).toEqual({ signalType: 'customer_added', headline: 'Added logo: Foo Corp' });
  });

  it('handles regenerateHook rejection gracefully — surfaces partial set', async () => {
    let i = 0;
    const fakeRegenerate = vi.fn(async () => {
      i += 1;
      if (i === 2) throw new Error('claude rate limit');
      return { hook: `hook-${i}`, costUsd: 0.003, model: 'm', hookVariantId: 'A' as const };
    });
    const result = await generateHooks(fakeContext, { regenerateHook: fakeRegenerate });
    expect(result.suggestedHooks.length).toBe(2);
    expect(result.errors?.[0]).toContain('rate limit');
  });
});
