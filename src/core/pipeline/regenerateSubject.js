import { callClaude } from '../ai/claude.js';
import { callGemini } from '../ai/gemini.js';

const ANTHROPIC_DISABLED = process.env.ANTHROPIC_DISABLED === 'true';

// ── Stage 11b: Subject line — Claude Haiku (or Gemini fallback) ──────
export async function regenerateSubject(lead) {
  const prompt = `Write a cold email subject line for ${lead.business_name}. Max 7 words. No ! or ? or ALL CAPS. Make it sound like a human colleague writing, not marketing. Return only the subject line text.`;
  if (ANTHROPIC_DISABLED) {
    const result = await callGemini(prompt);
    return { subject: result.text.trim(), costUsd: result.costUsd };
  }
  const result = await callClaude('haiku', prompt, { maxTokens: 30 });
  return { subject: result.text.trim(), costUsd: result.costUsd };
}
