import axios from 'axios';
import 'dotenv/config';
import { bumpCostMetric } from '../db/index.js';

const MEV_BASE = 'https://api.myemailverifier.com/verify';

// MEV PAYG cost: $0.00288 per verification
const MEV_COST_PER_VERIFY = 0.00288;

/**
 * @param {string} email
 * @returns {Promise<{ status: string, confidence: number }>}
 */
export async function verifyEmail(email) {
  if (!process.env.MEV_API_KEY) {
    return { status: 'skipped', confidence: 0 };
  }
  try {
    const { data } = await axios.get(MEV_BASE, {
      params: { secret: process.env.MEV_API_KEY, email },
      timeout: 10000
    });

    // Log MEV cost to daily_metrics — best-effort; don't break verification on DB errors
    try {
      await bumpCostMetric('mevCostUsd', MEV_COST_PER_VERIFY);
    } catch { /* swallow */ }

    const confidence = data.score ?? (data.status === 'valid' ? 0.9 : 0);
    return { status: data.status, confidence };
  } catch (err) {
    return { status: 'error', confidence: 0 };
  }
}
