import { callGemini } from '../ai/gemini.js';

const ANTHROPIC_DISABLED = process.env.ANTHROPIC_DISABLED === 'true';

// Strip markdown code fences Gemini sometimes wraps JSON in
function stripJson(text) {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
}

// ── Stages 2–6: Extraction + tech + signals + judge + DM finder ──
export async function reextract(lead) {
  const prompt = `Analyze this business website and return a JSON object with these fields:
- owner_name: owner/founder name (string or null)
- owner_role: their role e.g. "Founder", "Director" (string or null)
- contact_email: guessed email from name + domain pattern firstname@domain.com (string or null)
- contact_confidence: "high" if pattern match verified, "medium" if guessed, "low" if generic (string)
- contact_source: where you found the contact info e.g. "about page", "linkedin", "pattern guess" (string)
- tech_stack: JSON array of technologies detected e.g. ["WordPress","jQuery","PHP"] (array)
- website_problems: JSON array of specific issues e.g. ["no SSL","broken links","outdated design"] (array)
- last_updated: approximate date the site was last meaningfully updated (string or null)
- has_ssl: 1 if HTTPS, 0 if not (number)
- has_analytics: 1 if Google Analytics/GTM found, 0 if not (number)
- business_signals: JSON array e.g. ["low reviews","no booking","dated design","active social"] (array)
- social_active: 1 if active social media but neglected website, 0 otherwise (number)
- website_quality_score: 1-10 where 1=terrible needs complete rebuild, 10=excellent modern site (number)
- judge_reason: one sentence explaining the quality score (string)
- employees_estimate: "1-10" | "10-50" | "50-200" | "unknown" (string). Use team/about page clues.
- business_stage: "owner-operated" | "growing" | "established" | "unknown" (string).

Business: ${lead.business_name}, Website: ${lead.website_url}, City: ${lead.city}

Return only valid JSON, no markdown.`;
  const result = await callGemini(prompt, { useGrounding: true });
  try {
    return { data: JSON.parse(stripJson(result.text)), costUsd: result.costUsd };
  } catch {
    return { data: null, costUsd: result.costUsd };
  }
}
