import { GoogleGenerativeAI } from '@google/generative-ai';
import 'dotenv/config';

// Gemini 2.5 Flash pricing (per 1M tokens, standard tier)
// Source: ai.google.dev/gemini-api/docs/pricing — verified 2026-04-12
const INPUT_COST_PER_1M = 0.30;
const OUTPUT_COST_PER_1M = 2.50;

let _client;

function getClient() {
  if (!_client) _client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  return _client;
}

/**
 * @param {string} prompt
 * @param {{ useGrounding?: boolean }} opts
 * @returns {Promise<{ text: string, costUsd: number, inputTokens: number, outputTokens: number }>}
 */
export async function callGemini(prompt, { useGrounding = false } = {}) {
  const model = getClient().getGenerativeModel({
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    ...(useGrounding ? { tools: [{ googleSearch: {} }] } : {})
  });

  const result = await model.generateContent(prompt);
  const response = result.response;
  const text = response.text();
  const usage = response.usageMetadata || {};
  const inputTokens = usage.promptTokenCount || 0;
  const outputTokens = usage.candidatesTokenCount || 0;
  const costUsd = (inputTokens / 1_000_000) * INPUT_COST_PER_1M
                + (outputTokens / 1_000_000) * OUTPUT_COST_PER_1M;

  return { text, costUsd, inputTokens, outputTokens };
}
