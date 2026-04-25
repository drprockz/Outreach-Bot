import { callClaude } from '../ai/claude.js';
import { callGemini } from '../ai/gemini.js';

const ANTHROPIC_DISABLED = process.env.ANTHROPIC_DISABLED === 'true';

// ── Stage 11: Email body — Claude Haiku (or Gemini fallback) ─────────
export async function regenerateBody(lead, hook, persona) {
  const prompt = `Write a cold email from ${persona.name} (${persona.role}, ${persona.company}) to ${lead.contact_name || lead.owner_name || 'the owner'} at ${lead.business_name}.

Hook to open with: "${hook}"

Services context: ${persona.services}

Rules:
- Plain text only, no HTML
- 50-90 words total
- No links, no URLs
- CTA: ask to reply
- Tone: ${persona.tone}
- Do not mention price

Return only the email body, no subject line.`;
  if (ANTHROPIC_DISABLED) {
    const result = await callGemini(prompt);
    return { body: result.text.trim(), costUsd: result.costUsd, model: 'gemini-2.5-flash' };
  }
  const result = await callClaude('haiku', prompt, { maxTokens: 200 });
  return { body: result.text.trim(), costUsd: result.costUsd, model: result.model };
}
