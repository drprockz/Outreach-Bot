// Override env BEFORE module imports so the stage helpers see ANTHROPIC enabled.
process.env.ANTHROPIC_DISABLED = 'false';
process.env.ANTHROPIC_API_KEY = 'test-key';

import { describe, it, expect, vi, beforeEach } from 'vitest';

const FIXTURE_LEAD = {
  business_name: 'Acme Bakery',
  website_url: 'https://acmebakery.in',
  city: 'Mumbai',
  contact_name: 'Priya',
  manual_hook_note: null,
};
const PERSONA = { name: 'Darshan', role: 'fullstack dev', company: 'Simple Inc', services: 'web rebuild', tone: 'casual' };
const SIGNALS = [{ signalType: 'hiring', headline: 'hiring frontend dev', url: 'https://x.test' }];

vi.mock('../../src/core/ai/claude.js', () => ({
  callClaude: vi.fn(async (model, prompt) => ({
    text: model === 'sonnet'
      ? `MOCK_HOOK[${prompt.includes('curious-question') ? 'B' : 'A'}]`
      : prompt.includes('email body') ? 'mock body' : 'mock subject',
    costUsd: 0.001,
    model: `mock-${model}`,
  })),
}));

describe('findLeads stage helpers — pre-refactor snapshot', () => {
  let stage10_hook, stage11_body, stage11_subject;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../../src/engines/findLeads.js');
    stage10_hook = mod.stage10_hook;
    stage11_body = mod.stage11_body;
    stage11_subject = mod.stage11_subject;
  });

  it('stage10_hook returns chosen variant + total cost of both calls', async () => {
    const r = await stage10_hook(FIXTURE_LEAD, PERSONA, SIGNALS);
    expect(r.hook).toMatch(/^MOCK_HOOK\[(A|B)\]$/);
    expect(r.costUsd).toBeCloseTo(0.002, 6);
    expect(r.hookVariantId).toMatch(/^[AB]$/);
  });

  it('stage11_body returns body string', async () => {
    const r = await stage11_body(FIXTURE_LEAD, 'a hook', PERSONA);
    expect(r.body).toBe('mock body');
  });

  it('stage11_subject returns subject string', async () => {
    const r = await stage11_subject(FIXTURE_LEAD);
    expect(r.subject).toBe('mock subject');
  });
});
