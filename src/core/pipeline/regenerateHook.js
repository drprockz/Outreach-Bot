import { callClaude } from '../ai/claude.js';
import { callGemini } from '../ai/gemini.js';

const ANTHROPIC_DISABLED = process.env.ANTHROPIC_DISABLED === 'true';

// ── Stage 10: Hook generation — Claude Sonnet (or Gemini fallback) ──
function buildSignalsBlock(signals) {
  if (!Array.isArray(signals) || signals.length === 0) return '';
  const lines = signals.slice(0, 3).map((s, i) => `${i + 1}. [${s.signalType}] ${s.headline}${s.url ? ` (${s.url})` : ''}`);
  return `\n\nRecent signals about this business (newest/strongest first):\n${lines.join('\n')}\n\nIf one of these signals is genuinely interesting, weave it into the hook. If none feel natural, ignore them and observe the website directly.`;
}

// Two prompt seeds for the A/B framework. Both stay within the same length/tone
// constraints; the difference is angle, not voice. Variant winners surface in
// the Sunday report (dailyReport.js) — retire losers manually after ~2 weeks.
const VARIANT_SEEDS = {
  A: { name: 'observation', angle: 'a hyper-specific observation about something concrete you\'d notice as' },
  B: { name: 'curious-question', angle: 'a short curious question opening (max 20 words) that a' },
};

export function buildHookPrompt(variant, lead, persona, signals, competitorAnalysis = null) {
  const seed = VARIANT_SEEDS[variant];
  const opener = variant === 'A'
    ? `Write ONE sentence (max 20 words) that makes ${seed.angle} a ${persona.role} — outdated tech, missing feature, design issue. No fluff, no compliments.`
    : `${seed.angle.replace(/^a /, 'Write ')} ${persona.role} would ask ${lead.business_name}'s owner about their site (${lead.website_url}) — concrete, no fluff.`;
  const manualNote = lead.manual_hook_note ? `\n\nManual hook hint from operator: ${lead.manual_hook_note}` : '';
  const competitorBlock = competitorAnalysis
    ? `\n\nCompetitor context (use naturally, do not quote directly):\n- Hook insight: ${competitorAnalysis.opportunityHook}\n- Key gaps: ${(competitorAnalysis.cons || []).slice(0, 2).join('; ')}`
    : '';
  return opener + buildSignalsBlock(signals) + manualNote + competitorBlock;
}

async function generateHookVariant(variant, lead, persona, signals, competitorAnalysis = null) {
  const prompt = buildHookPrompt(variant, lead, persona, signals, competitorAnalysis);
  if (ANTHROPIC_DISABLED) {
    const result = await callGemini(prompt);
    return { variant, hook: result.text.trim(), costUsd: result.costUsd, model: 'gemini-2.5-flash' };
  }
  const result = await callClaude('sonnet', prompt, { maxTokens: 60 });
  return { variant, hook: result.text.trim(), costUsd: result.costUsd, model: result.model };
}

// Generate both variants in parallel, pick one at random for actual send.
// Returns the chosen variant's data + total cost (both calls billed).
export async function regenerateHook(lead, persona, signals = [], competitorAnalysis = null) {
  const [a, b] = await Promise.all([
    generateHookVariant('A', lead, persona, signals, competitorAnalysis),
    generateHookVariant('B', lead, persona, signals, competitorAnalysis),
  ]);
  const chosen = Math.random() < 0.5 ? a : b;
  const totalCost = (a.costUsd || 0) + (b.costUsd || 0);
  return { hook: chosen.hook, costUsd: totalCost, model: chosen.model, hookVariantId: chosen.variant };
}
