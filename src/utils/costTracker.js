import { logApiCost } from '../../db/database.js';

// Sonnet 4 pricing as of 2025
const INPUT_COST_PER_1K = 0.003;
const OUTPUT_COST_PER_1K = 0.015;

/**
 * Log a Claude API call's token usage and cost to the api_costs table.
 * Call this after every anthropic.messages.create() response.
 */
export function trackCost(job, response) {
  const inputTokens = response.usage?.input_tokens || 0;
  const outputTokens = response.usage?.output_tokens || 0;
  logApiCost({ job, inputTokens, outputTokens });
}
