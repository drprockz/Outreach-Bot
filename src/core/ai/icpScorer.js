import { callGemini } from './gemini.js';
import { logError } from '../db/index.js';

export function clampInt(n, lo, hi) {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

export function bucket(score, threshA, threshB) {
  if (score >= threshA) return 'A';
  if (score >= threshB) return 'B';
  return 'C';
}

function stripJson(text) {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
}

// Async + takes a Prisma client. JSON fields come back already parsed.
export async function loadScoringContext(prisma) {
  const offer = await prisma.offer.findUnique({ where: { id: 1 } });
  const icp   = await prisma.icpProfile.findUnique({ where: { id: 1 } });
  if (!offer || !icp) {
    throw new Error('ICP scoring requires offer + icp_profile rows to exist');
  }
  if (!offer.problem || !Array.isArray(icp.industries) || icp.industries.length === 0) {
    throw new Error('ICP scoring requires offer.problem and icp_profile.industries to be configured');
  }
  return { offer, icp };
}

export function buildScorerPrompt(lead, offer, icp, weights) {
  return `You are an ICP scoring engine.

OFFER: ${JSON.stringify(offer)}
ICP_PROFILE: ${JSON.stringify(icp)}
LEAD: ${JSON.stringify({
    business_name: lead.business_name,
    industry: lead.category,
    employees_estimate: lead.employees_estimate || 'unknown',
    business_stage: lead.business_stage || 'unknown',
    geography: lead.city,
    tech_stack: lead.tech_stack || [],
    roles_present: lead.owner_role ? [lead.owner_role] : [],
    signals: [
      ...(Array.isArray(lead.business_signals) ? lead.business_signals : []),
      ...(Array.isArray(lead.website_problems) ? lead.website_problems : [])
    ],
    observed_pains: lead.judge_reason || null,
  })}

Score LEAD 0-100 using these weights: ${JSON.stringify(weights)}.

Scoring method:
- Firmographic Fit (0-${weights.firmographic}): match industry, size, stage, geography
- Problem Intensity (0-${weights.problem}): evidence of pains aligned to OFFER.problem and ICP.problem_cost/frequency
- Intent/Trigger (0-${weights.intent}): presence of ICP.intent_signals or OFFER.triggers
- Tech/Environment Fit (0-${weights.tech}): overlap with ICP.tech_stack
- Economic Fit (0-${weights.economic}): inferred capacity vs OFFER.price_range (use business_stage/employees as proxy)
- Buying Readiness (0-${weights.buying}): presence of initiator_roles, decision_roles, compatible buying_process

For each factor, award points proportional to evidence.
Missing evidence counts as a key_gap, not a penalty.
If LEAD matches any ICP.hard_disqualifiers, list them in disqualifiers.

Return JSON ONLY (no markdown fences):
{
  "score": <int 0-100>,
  "breakdown": {"firmographic":n,"problem":n,"intent":n,"tech":n,"economic":n,"buying":n},
  "key_matches": [<strings>],
  "key_gaps": [<strings>],
  "disqualifiers": [<strings>]
}`;
}

function summarize({ key_matches, key_gaps, disqualifiers }) {
  const parts = [];
  if (disqualifiers && disqualifiers.length) parts.push(`DQ: ${disqualifiers.slice(0, 2).join(', ')}`);
  if (key_matches && key_matches.length)     parts.push(`✓ ${key_matches.slice(0, 2).join(', ')}`);
  if (key_gaps && key_gaps.length)           parts.push(`? ${key_gaps.slice(0, 2).join(', ')}`);
  return parts.join(' | ').slice(0, 300);
}

export async function scoreLead(lead, ctx) {
  const { offer, icp, weights, threshA, threshB } = ctx;
  const prompt = buildScorerPrompt(lead, offer, icp, weights);
  const result = await callGemini(prompt);

  let parsed;
  try {
    parsed = JSON.parse(stripJson(result.text));
  } catch (err) {
    await logError('icpScorer.parse', err, { rawResponse: result.text, leadId: lead.id });
    return {
      icp_score: 0,
      icp_priority: 'C',
      icp_breakdown: null,
      icp_key_matches: [],
      icp_key_gaps: ['scorer_parse_error'],
      icp_disqualifiers: [],
      icp_reason: 'parse error',
      costUsd: result.costUsd,
    };
  }

  const score = clampInt(parsed.score, 0, 100);
  return {
    icp_score:         score,
    icp_priority:      bucket(score, threshA, threshB),
    icp_breakdown:     parsed.breakdown || null,
    icp_key_matches:   Array.isArray(parsed.key_matches) ? parsed.key_matches : [],
    icp_key_gaps:      Array.isArray(parsed.key_gaps) ? parsed.key_gaps : [],
    icp_disqualifiers: Array.isArray(parsed.disqualifiers) ? parsed.disqualifiers : [],
    icp_reason:        summarize(parsed),
    costUsd:           result.costUsd,
  };
}
