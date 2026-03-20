import axios from 'axios';
import 'dotenv/config';

const MEV_BASE = 'https://api.myemailverifier.com/verify';

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
    // status: 'valid' | 'invalid' | 'disposable' | 'unknown'
    const confidence = data.score ?? (data.status === 'valid' ? 0.9 : 0);
    return { status: data.status, confidence };
  } catch (err) {
    return { status: 'error', confidence: 0 };
  }
}
