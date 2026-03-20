import Anthropic from '@anthropic-ai/sdk';
import 'dotenv/config';
import { getDb, today, logError } from './db.js';

// Pricing per 1M tokens
const PRICING = {
  sonnet: { input: 3.00, output: 15.00 },
  haiku:  { input: 0.80, output: 4.00  }
};

const MODEL_IDS = {
  sonnet: 'claude-sonnet-4-20250514',
  haiku:  'claude-haiku-4-5-20251001'
};

let _client;
function getClient() {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

async function checkSpendCap() {
  const cap = parseFloat(process.env.CLAUDE_DAILY_SPEND_CAP || '3.00');
  const row = getDb().prepare(
    `SELECT sonnet_cost_usd, haiku_cost_usd FROM daily_metrics WHERE date=?`
  ).get(today());
  const spent = (row?.sonnet_cost_usd || 0) + (row?.haiku_cost_usd || 0);
  if (spent >= cap) {
    const err = new Error(`Claude daily spend cap ($${cap}) reached — spent $${spent.toFixed(4)}`);
    logError('claude.spendCap', err);
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

  // Write cost to daily_metrics
  const db = getDb();
  const d = today();
  db.prepare(`INSERT INTO daily_metrics (date) VALUES (?) ON CONFLICT(date) DO NOTHING`).run(d);
  const col = model === 'sonnet' ? 'sonnet_cost_usd' : 'haiku_cost_usd';
  db.prepare(`UPDATE daily_metrics SET ${col}=${col}+?, total_api_cost_usd=total_api_cost_usd+? WHERE date=?`)
    .run(costUsd, costUsd, d);

  return { text, costUsd, inputTokens, outputTokens, model: MODEL_IDS[model] };
}
