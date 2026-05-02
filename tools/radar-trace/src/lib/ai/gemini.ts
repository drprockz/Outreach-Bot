/**
 * Thin wrapper around the Gemini REST API used for anchor extraction.
 *
 * We hit the REST endpoint directly (no SDK) so the radar-trace tool stays free
 * of the @google/generative-ai dependency. The CLI is standalone and ships from
 * the monorepo's `tools/` workspace; keeping its dep tree minimal makes it
 * easier to bundle and to reason about.
 *
 * Pricing (gemini-2.5-flash, standard tier, verified 2026-04-12):
 *   input  $0.30 / 1M tokens
 *   output $2.50 / 1M tokens
 *
 * For the small payloads we send (~5 KB of homepage text) a single anchor call
 * costs roughly $0.0003 — effectively free. We still return the cost so the
 * caller can attribute it to the dossier's cost breakdown.
 */
import type { Env } from '../../types.js';

const INPUT_COST_PER_1M_USD = 0.30;
const OUTPUT_COST_PER_1M_USD = 2.50;
const DEFAULT_MODEL = 'gemini-2.5-flash';
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

export interface GeminiCallOptions {
  prompt: string;
  systemInstruction?: string;
  signal?: AbortSignal;
  responseMimeType?: 'application/json' | 'text/plain';
  /** Override `process.env.GEMINI_MODEL`. Defaults to gemini-2.5-flash. */
  model?: string;
}

export interface GeminiCallResult {
  text: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
}

interface GeminiRestResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: { message?: string };
}

export interface GeminiClient {
  call(opts: GeminiCallOptions): Promise<GeminiCallResult>;
}

export function createGeminiClient(env: Env, http: typeof fetch = fetch): GeminiClient {
  const apiKey = env.GEMINI_API_KEY;
  return {
    async call(opts: GeminiCallOptions): Promise<GeminiCallResult> {
      if (!apiKey) {
        throw new Error('GEMINI_API_KEY is not set');
      }
      const model = opts.model ?? DEFAULT_MODEL;
      const url = `${ENDPOINT}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const body: Record<string, unknown> = {
        contents: [{ role: 'user', parts: [{ text: opts.prompt }] }],
        generationConfig: {
          temperature: 0,
          ...(opts.responseMimeType ? { responseMimeType: opts.responseMimeType } : {}),
        },
      };
      if (opts.systemInstruction) {
        body.systemInstruction = { parts: [{ text: opts.systemInstruction }] };
      }
      const res = await http(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: opts.signal,
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`gemini http ${res.status}: ${detail.slice(0, 200)}`);
      }
      const json = (await res.json()) as GeminiRestResponse;
      if (json.error?.message) {
        throw new Error(`gemini api: ${json.error.message}`);
      }
      const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
      const inputTokens = json.usageMetadata?.promptTokenCount ?? 0;
      const outputTokens = json.usageMetadata?.candidatesTokenCount ?? 0;
      const costUsd =
        (inputTokens / 1_000_000) * INPUT_COST_PER_1M_USD +
        (outputTokens / 1_000_000) * OUTPUT_COST_PER_1M_USD;
      return { text, costUsd, inputTokens, outputTokens };
    },
  };
}
