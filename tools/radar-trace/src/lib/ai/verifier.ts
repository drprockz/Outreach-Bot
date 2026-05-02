/**
 * Entity-match verifier — Claude Haiku 4.5.
 *
 * Used by adapters that must perform a name-based search (e.g. `voice.linkedin_pulse`,
 * `positioning.brave_news`) where the search API can return results for any
 * entity that shares a token with the company name. Without this gate, a search
 * for "Simple Inc" returns articles about "Safety Made Simple, Inc." — a real
 * regression we observed.
 *
 * Pricing (claude-haiku-4-5-20251001, verified 2026-04-12):
 *   input  $1.00 / 1M tokens
 *   output $5.00 / 1M tokens
 *
 * A batched call covering 10 candidates with the target context fits in roughly
 * 800 input + 300 output tokens → ~$0.0023 ≈ ₹0.20. Cheap enough to gate every
 * candidate result.
 *
 * The wrapper returns a structured per-candidate verdict and aggregate cost.
 * On invalid JSON we retry once; a second failure throws so the caller can
 * record an `error` status and avoid silently shipping unverified data.
 */
import { z } from 'zod';
import type { Env } from '../../types.js';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

// Anthropic token pricing per 1M tokens — Haiku 4.5 standard tier.
const INPUT_COST_PER_1M_USD = 1.00;
const OUTPUT_COST_PER_1M_USD = 5.00;

export interface VerifyTarget {
  name: string;
  domain: string;
  description?: string | null;
  founder?: string | null;
}

export interface VerifyCandidate {
  /** Stable id so the caller can correlate the verdict back. */
  id: string;
  url?: string | null;
  title?: string | null;
  snippet?: string | null;
  /** Optional extra hints (e.g. "podcast: <show>", "channel handle: @x"). */
  extra?: Record<string, string | null | undefined>;
}

export interface CandidateVerdict {
  id: string;
  match: boolean;
  confidence: number;
  reason: string;
}

export interface VerifyBatchResult {
  verdicts: CandidateVerdict[];
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  rawText: string;
}

const VerdictArraySchema = z.array(
  z.object({
    id: z.string(),
    match: z.boolean(),
    confidence: z.number(),
    reason: z.string(),
  }),
);

export interface VerifierClient {
  verifyBatch(input: {
    target: VerifyTarget;
    candidates: VerifyCandidate[];
    /** What kind of result is being verified — affects the prompt phrasing. */
    candidateKind: 'article' | 'podcast' | 'news' | 'profile' | 'channel' | 'company' | 'generic';
    signal?: AbortSignal;
    model?: string;
  }): Promise<VerifyBatchResult>;
}

interface AnthropicMessageResponse {
  content?: Array<{ type: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string };
}

const SYSTEM_PROMPT =
  `You are a precise entity-matching classifier. The user gives you a target ` +
  `company and a list of search-result candidates. For each candidate, decide ` +
  `whether the candidate is *about* the target company (or one of its named ` +
  `people/products), with a confidence between 0 and 1. ` +
  `Generic mentions of the company name that actually refer to a different ` +
  `entity (e.g. another company sharing a word with the target) MUST be marked ` +
  `match: false with low confidence. Return ONLY a JSON array — no commentary, ` +
  `no markdown fences. Schema: ` +
  `[{"id": string, "match": boolean, "confidence": number, "reason": string}]. ` +
  `Keep "reason" short (under 20 words).`;

function buildUserPrompt(
  target: VerifyTarget,
  candidates: VerifyCandidate[],
  candidateKind: VerifierClient extends never ? never : Parameters<VerifierClient['verifyBatch']>[0]['candidateKind'],
): string {
  const lines: string[] = [];
  lines.push('TARGET COMPANY:');
  lines.push(`  name:    ${target.name}`);
  lines.push(`  domain:  ${target.domain}`);
  if (target.description) lines.push(`  about:   ${target.description.slice(0, 400)}`);
  if (target.founder) lines.push(`  founder: ${target.founder}`);
  lines.push('');
  lines.push(`CANDIDATES (${candidateKind}):`);
  for (const c of candidates) {
    lines.push(`- id: ${c.id}`);
    if (c.title) lines.push(`  title:   ${c.title.slice(0, 200)}`);
    if (c.snippet) lines.push(`  snippet: ${c.snippet.slice(0, 300)}`);
    if (c.url) lines.push(`  url:     ${c.url}`);
    if (c.extra) {
      for (const [k, v] of Object.entries(c.extra)) {
        if (v) lines.push(`  ${k}: ${String(v).slice(0, 200)}`);
      }
    }
  }
  lines.push('');
  lines.push('Reply with ONLY the JSON array described in the system prompt.');
  return lines.join('\n');
}

function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('```')) {
    return trimmed.replace(/^```(?:json)?\s*\n/, '').replace(/\n?```\s*$/, '');
  }
  return trimmed;
}

export function createVerifierClient(env: Env, http: typeof fetch = fetch): VerifierClient {
  const apiKey = env.ANTHROPIC_API_KEY;

  async function callOnce(
    input: Parameters<VerifierClient['verifyBatch']>[0],
    forceJsonReminder = false,
  ): Promise<AnthropicMessageResponse> {
    const userPrompt = buildUserPrompt(input.target, input.candidates, input.candidateKind);
    const finalUser = forceJsonReminder
      ? userPrompt + '\n\nIMPORTANT: previous reply was not valid JSON. Return ONLY the JSON array.'
      : userPrompt;
    const body = {
      model: input.model ?? DEFAULT_MODEL,
      max_tokens: 800,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: finalUser }],
    };
    const res = await http(ENDPOINT, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey ?? '',
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: input.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`anthropic http ${res.status}: ${detail.slice(0, 200)}`);
    }
    return (await res.json()) as AnthropicMessageResponse;
  }

  return {
    async verifyBatch(input) {
      if (!apiKey) {
        throw new Error('ANTHROPIC_API_KEY is not set');
      }
      if (input.candidates.length === 0) {
        return { verdicts: [], costUsd: 0, inputTokens: 0, outputTokens: 0, rawText: '' };
      }

      let totalInput = 0;
      let totalOutput = 0;
      let lastText = '';

      for (let attempt = 0; attempt < 2; attempt++) {
        const json = await callOnce(input, attempt === 1);
        if (json.error?.message) throw new Error(`anthropic api: ${json.error.message}`);
        const text = json.content?.map((c) => (c.type === 'text' ? c.text ?? '' : '')).join('') ?? '';
        lastText = text;
        totalInput += json.usage?.input_tokens ?? 0;
        totalOutput += json.usage?.output_tokens ?? 0;
        const stripped = stripJsonFences(text);
        let parsed: unknown;
        try {
          parsed = JSON.parse(stripped);
        } catch {
          if (attempt === 1) {
            throw new Error(`verifier: invalid JSON after retry (got: ${stripped.slice(0, 120)})`);
          }
          continue;
        }
        const safe = VerdictArraySchema.safeParse(parsed);
        if (!safe.success) {
          if (attempt === 1) {
            throw new Error(`verifier: schema mismatch — ${safe.error.message.slice(0, 200)}`);
          }
          continue;
        }
        const verdicts = safe.data.map((v) => ({
          id: v.id,
          match: v.match,
          confidence: Math.max(0, Math.min(1, v.confidence)),
          reason: v.reason,
        }));
        const costUsd =
          (totalInput / 1_000_000) * INPUT_COST_PER_1M_USD +
          (totalOutput / 1_000_000) * OUTPUT_COST_PER_1M_USD;
        return { verdicts, costUsd, inputTokens: totalInput, outputTokens: totalOutput, rawText: text };
      }

      // Unreachable — both retry branches throw on failure.
      throw new Error(`verifier: failed (last text: ${lastText.slice(0, 120)})`);
    },
  };
}

/** Default minimum confidence for accepting a candidate. */
export const DEFAULT_MATCH_THRESHOLD = 0.6;
