import { describe, it, expect, vi } from 'vitest';
import { makeVoiceLinkedinPulseAdapter } from '../../../src/adapters/voice/linkedinPulse.js';
import type { AdapterContext } from '../../../src/types.js';
import { EMPTY_ANCHORS } from '../../../src/types.js';
import type { SerperClient } from '../../../src/clients/serper.js';
import type { VerifierClient } from '../../../src/lib/ai/verifier.js';

function makeVerifierSpy(matches: Array<{ id: string; match: boolean; confidence: number }>): VerifierClient {
  return {
    verifyBatch: vi.fn(async () => ({
      verdicts: matches.map((m) => ({ ...m, reason: 'test' })),
      costUsd: 0.001,
      inputTokens: 200,
      outputTokens: 80,
      rawText: '',
    })),
  };
}

function makeCtx(
  overrides: Partial<AdapterContext['input']> = {},
  envOverrides: Record<string, string> = {},
): AdapterContext {
  const noop = () => {};
  return {
    input: { name: 'Acme', domain: 'acme.com', ...overrides },
    http: (() => {}) as unknown as typeof fetch,
    cache: { read: async () => null, write: async () => {}, clear: async () => {} },
    logger: { debug: noop, info: noop, warn: noop, error: noop, child: () => makeCtx(overrides).logger },
    env: { SERPER_API_KEY: 'fake-key', ...envOverrides },
    signal: new AbortController().signal,
    anchors: EMPTY_ANCHORS,
  };
}

function makeSerperSpy(organic: Array<{ title: string; link: string; snippet: string }>): SerperClient {
  return {
    search: vi.fn(async () => ({ organic, costPaise: 3 })),
    newsSearch: vi.fn(async () => ({ news: [], costPaise: 3 })),
  };
}

describe('voiceLinkedinPulseAdapter', () => {
  it('contract surface', () => {
    const adapter = makeVoiceLinkedinPulseAdapter(() => makeSerperSpy([]));
    expect(adapter.name).toBe('voice.linkedin_pulse');
    expect(adapter.module).toBe('voice');
    expect(adapter.estimatedCostInr).toBe(0.5);
    expect(adapter.requiredEnv).toContain('SERPER_API_KEY');
  });

  it('returns multiple articles from pulse results', async () => {
    const organic = [
      { title: 'Why B2B matters', link: 'https://www.linkedin.com/pulse/why-b2b-matters-jane-doe/', snippet: 'B2B outreach...' },
      { title: 'Scaling your team', link: 'https://linkedin.com/pulse/scaling-team-jane-doe/', snippet: 'Team scaling...' },
      { title: 'Unrelated result', link: 'https://linkedin.com/in/someuser/', snippet: 'Not a pulse article' },
    ];
    const adapter = makeVoiceLinkedinPulseAdapter(() => makeSerperSpy(organic));
    const result = await adapter.run(makeCtx({ founder: 'Jane Doe' }));
    expect(result.status).toBe('ok');
    expect(result.payload!.articles.length).toBe(2);
    expect(result.payload!.articles[0]!.url).toContain('linkedin.com/pulse/');
    expect(result.payload!.articles[1]!.url).toContain('linkedin.com/pulse/');
  });

  it('returns empty when no pulse articles match', async () => {
    const organic = [
      { title: 'Some result', link: 'https://linkedin.com/in/someuser/', snippet: 'Not a pulse' },
    ];
    const adapter = makeVoiceLinkedinPulseAdapter(() => makeSerperSpy(organic));
    const result = await adapter.run(makeCtx());
    expect(result.status).toBe('empty');
    expect(result.payload!.articles).toHaveLength(0);
  });

  it('drops articles the verifier rejects (e.g. Safety Made Simple Inc when target is Simple Inc)', async () => {
    // Recreates the exact regression: Pulse search returns 3 articles, two
    // about other "Simple Inc" entities, one actually about the target.
    const organic = [
      { title: 'Susan Bedsaul Joins Safety Made Simple, Inc.', link: 'https://www.linkedin.com/pulse/susan-bedsaul-safety-simple', snippet: 'Olathe, KS company' },
      { title: 'Simple Inc raises Series B', link: 'https://www.linkedin.com/pulse/simple-inc-series-b', snippet: 'Bangalore-based outreach SaaS' },
      { title: 'HR Simple Inc — newsletter', link: 'https://www.linkedin.com/pulse/hr-simple-inc-newsletter', snippet: 'Mid-market HR consultancy' },
    ];
    const verifier = makeVerifierSpy([
      { id: '0', match: false, confidence: 0.05 }, // Safety Made Simple — drop
      { id: '1', match: true, confidence: 0.95 },  // The real Simple Inc — keep
      { id: '2', match: false, confidence: 0.1 },  // HR Simple — drop
    ]);
    const adapter = makeVoiceLinkedinPulseAdapter(
      () => makeSerperSpy(organic),
      () => verifier,
    );
    const result = await adapter.run(makeCtx({ name: 'Simple Inc' }, { ANTHROPIC_API_KEY: 'sk-fake' }));
    expect(result.status).toBe('ok');
    expect(result.payload!.articles).toHaveLength(1);
    expect(result.payload!.articles[0]!.url).toContain('simple-inc-series-b');
    expect(result.verification?.method).toBe('llm');
    expect(result.verification?.droppedCandidates).toBe(2);
  });

  it('skips verification gracefully when ANTHROPIC_API_KEY is missing (degraded mode)', async () => {
    const organic = [
      { title: 'X about Simple Inc', link: 'https://www.linkedin.com/pulse/x', snippet: '' },
    ];
    // No verifier is wired, but adapter shouldn't call it because no API key.
    const verifier = makeVerifierSpy([{ id: '0', match: true, confidence: 0.9 }]);
    const adapter = makeVoiceLinkedinPulseAdapter(
      () => makeSerperSpy(organic),
      () => verifier,
    );
    const result = await adapter.run(makeCtx());
    expect(result.status).toBe('ok');
    expect(result.payload!.articles).toHaveLength(1); // unverified — kept
    expect(result.verification?.method).toBe('none');
    expect(verifier.verifyBatch).not.toHaveBeenCalled();
  });
});
