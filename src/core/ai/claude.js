import Anthropic from '@anthropic-ai/sdk';
import 'dotenv/config';
import { getPrisma, bumpCostMetric, today, logError } from '../db/index.js';

// Pricing per 1M tokens (Haiku 4.5: $1.00/$5.00, Sonnet 4: $3.00/$15.00)
const PRICING = {
  sonnet:   { input: 3.00, output: 15.00 },
  haiku:    { input: 1.00, output: 5.00  },
  classify: { input: 1.00, output: 5.00  }
};

const MODEL_IDS = {
  sonnet:   process.env.MODEL_HOOK     || 'claude-sonnet-4-20250514',
  haiku:    process.env.MODEL_BODY     || 'claude-haiku-4-5-20251001',
  classify: process.env.MODEL_CLASSIFY || 'claude-haiku-4-5-20251001'
};

let _client;
function getClient() {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

async function checkSpendCap() {
  const cap = parseFloat(process.env.CLAUDE_DAILY_SPEND_CAP || '3.00');
  const row = await getPrisma().dailyMetrics.findUnique({
    where: { date: today() },
    select: { sonnetCostUsd: true, haikuCostUsd: true },
  });
  const spent = Number(row?.sonnetCostUsd || 0) + Number(row?.haikuCostUsd || 0);
  if (spent >= cap) {
    const err = new Error(`Claude daily spend cap ($${cap}) reached — spent $${spent.toFixed(4)}`);
    await logError('claude.spendCap', err);
    throw err;
  }
}

/**
 * @param {'sonnet'|'haiku'} model
 * @param {string} prompt
 * @param {{ systemPrompt?: string, maxTokens?: number }} opts
 * @returns {Promise<{ text: string, costUsd: number, inputTokens: number, outputTokens: number }>}
 */
export async function callClaude(model, prompt, { systemPrompt, maxTokens = 1024 } = {}) {
  await checkSpendCap();

  const pricing = PRICING[model];
  if (!pricing) throw new Error(`Unknown model alias: ${model}`);

  const messages = [{ role: 'user', content: prompt }];
  const params = {
    model: MODEL_IDS[model],
    max_tokens: maxTokens,
    messages,
    ...(systemPrompt ? { system: systemPrompt } : {})
  };

  const response = await getClient().messages.create(params);
  const text = response.content[0].text;
  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  const costUsd = (inputTokens / 1_000_000) * pricing.input
                + (outputTokens / 1_000_000) * pricing.output;

  // Write cost to daily_metrics via consolidated helper
  const field = model === 'sonnet' ? 'sonnetCostUsd' : 'haikuCostUsd';
  await bumpCostMetric(field, costUsd);

  return { text, costUsd, inputTokens, outputTokens, model: MODEL_IDS[model] };
}
