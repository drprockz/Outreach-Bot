import { describe, it, expect, vi } from 'vitest';
import { createVerifierClient, DEFAULT_MATCH_THRESHOLD } from '../../../src/lib/ai/verifier.js';

function fakeAnthropicResponse(content: string, usage = { input_tokens: 100, output_tokens: 50 }) {
  return new Response(
    JSON.stringify({ content: [{ type: 'text', text: content }], usage }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

describe('createVerifierClient', () => {
  it('throws when ANTHROPIC_API_KEY is missing', async () => {
    const client = createVerifierClient({}, async () => new Response('', { status: 500 }));
    await expect(
      client.verifyBatch({
        target: { name: 'Acme', domain: 'acme.com' },
        candidates: [{ id: '1' }],
        candidateKind: 'article',
      }),
    ).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });

  it('returns empty result for an empty candidate list (no API call)', async () => {
    const fetchSpy = vi.fn();
    const client = createVerifierClient({ ANTHROPIC_API_KEY: 'sk-fake' }, fetchSpy);
    const r = await client.verifyBatch({
      target: { name: 'Acme', domain: 'acme.com' },
      candidates: [],
      candidateKind: 'news',
    });
    expect(r.verdicts).toEqual([]);
    expect(r.costUsd).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('parses a strict JSON array, clamps confidence into [0,1]', async () => {
    const responseJson = JSON.stringify([
      { id: '1', match: true, confidence: 1.5, reason: 'on point' },
      { id: '2', match: false, confidence: -0.2, reason: 'unrelated entity' },
    ]);
    const http = vi.fn(async () => fakeAnthropicResponse(responseJson));
    const client = createVerifierClient({ ANTHROPIC_API_KEY: 'sk-fake' }, http as unknown as typeof fetch);
    const r = await client.verifyBatch({
      target: { name: 'Acme', domain: 'acme.com' },
      candidates: [{ id: '1', title: 'A' }, { id: '2', title: 'B' }],
      candidateKind: 'article',
    });
    expect(r.verdicts).toEqual([
      { id: '1', match: true, confidence: 1, reason: 'on point' },
      { id: '2', match: false, confidence: 0, reason: 'unrelated entity' },
    ]);
    expect(r.costUsd).toBeGreaterThan(0);
    expect(http).toHaveBeenCalledTimes(1);
  });

  it('strips ```json fences before parsing', async () => {
    const wrapped = '```json\n[{"id":"x","match":true,"confidence":0.9,"reason":"yes"}]\n```';
    const http = vi.fn(async () => fakeAnthropicResponse(wrapped));
    const client = createVerifierClient({ ANTHROPIC_API_KEY: 'sk-fake' }, http as unknown as typeof fetch);
    const r = await client.verifyBatch({
      target: { name: 'Acme', domain: 'acme.com' },
      candidates: [{ id: 'x' }],
      candidateKind: 'profile',
    });
    expect(r.verdicts).toHaveLength(1);
    expect(r.verdicts[0]!.confidence).toBe(0.9);
  });

  it('retries once on invalid JSON, then succeeds', async () => {
    let call = 0;
    const http = vi.fn(async () => {
      call++;
      if (call === 1) return fakeAnthropicResponse('not json at all');
      return fakeAnthropicResponse('[{"id":"x","match":false,"confidence":0.1,"reason":"no"}]');
    });
    const client = createVerifierClient({ ANTHROPIC_API_KEY: 'sk-fake' }, http as unknown as typeof fetch);
    const r = await client.verifyBatch({
      target: { name: 'Acme', domain: 'acme.com' },
      candidates: [{ id: 'x' }],
      candidateKind: 'news',
    });
    expect(r.verdicts).toHaveLength(1);
    expect(http).toHaveBeenCalledTimes(2);
  });

  it('throws after second invalid-JSON attempt so adapters can record an error', async () => {
    const http = vi.fn(async () => fakeAnthropicResponse('still not json'));
    const client = createVerifierClient({ ANTHROPIC_API_KEY: 'sk-fake' }, http as unknown as typeof fetch);
    await expect(
      client.verifyBatch({
        target: { name: 'Acme', domain: 'acme.com' },
        candidates: [{ id: 'x' }],
        candidateKind: 'news',
      }),
    ).rejects.toThrow(/invalid JSON/);
    expect(http).toHaveBeenCalledTimes(2);
  });

  it('throws on non-2xx HTTP responses', async () => {
    const http = vi.fn(async () => new Response('boom', { status: 500 }));
    const client = createVerifierClient({ ANTHROPIC_API_KEY: 'sk-fake' }, http as unknown as typeof fetch);
    await expect(
      client.verifyBatch({
        target: { name: 'Acme', domain: 'acme.com' },
        candidates: [{ id: 'x' }],
        candidateKind: 'article',
      }),
    ).rejects.toThrow(/anthropic http 500/);
  });
});

describe('DEFAULT_MATCH_THRESHOLD', () => {
  it('is in [0,1] and high enough to drop common-name collisions', () => {
    // Sanity: not zero (would accept everything), not one (would reject anything < 1).
    expect(DEFAULT_MATCH_THRESHOLD).toBeGreaterThanOrEqual(0.5);
    expect(DEFAULT_MATCH_THRESHOLD).toBeLessThan(1);
  });
});
