import 'dotenv/config';
import { callGemini } from './gemini.js';
import { withConcurrency } from '../lib/concurrency.js';
import { logError } from '../db/index.js';

function stripJson(text) {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
}

export async function analyzeCompetitors(lead) {
  const bizName = lead.business_name;
  try {
    // Call 1: Competitor discovery
    const discoveryResult = await callGemini(
      `Find the top 3 direct competitors of "${bizName}", a ${lead.category} business in ${lead.city}, India. Return ONLY valid JSON array, no markdown: [{"name":"string","website":"string"}]`,
      { useGrounding: true }
    );

    let competitors;
    try {
      competitors = JSON.parse(stripJson(discoveryResult.text));
      if (!Array.isArray(competitors) || competitors.length === 0) throw new Error('empty');
    } catch {
      await logError('competitorAnalysis.parse.discovery', new Error('invalid JSON'), { jobName: 'findLeads' });
      return null;
    }

    let totalCost = discoveryResult.costUsd;
    competitors = competitors.slice(0, 3);

    // Call 2: Client/portfolio scrape — each lambda catches own errors (withConcurrency contract)
    const profiles = await withConcurrency(competitors, 3, async (comp) => {
      try {
        const result = await callGemini(
          `Find notable clients, case studies, or portfolio work listed by "${comp.name}" (${comp.website}). Return ONLY valid JSON, no markdown: {"clients":[],"portfolioHighlights":[]}`,
          { useGrounding: true }
        );
        totalCost += result.costUsd;
        let profile;
        try { profile = JSON.parse(stripJson(result.text)); } catch { return null; }
        return {
          name: comp.name,
          website: comp.website,
          clients: profile.clients || [],
          portfolioHighlights: profile.portfolioHighlights || [],
        };
      } catch {
        return null;
      }
    });

    // filter(Boolean) removes nulls from failed lambdas before Call 3 prompt construction
    const validProfiles = profiles.filter(Boolean);

    // Call 3: Gap comparison
    const gapResult = await callGemini(
      `Compare "${bizName}" against these competitors: ${JSON.stringify(validProfiles)}.
Known issues with ${bizName}: website problems: ${JSON.stringify(lead.website_problems || [])}, tech stack: ${JSON.stringify(lead.tech_stack || [])}.
Return ONLY valid JSON, no markdown: {"pros":[],"cons":[],"gaps":[],"opportunityHook":"one sentence"}`,
      { useGrounding: false }
    );
    totalCost += gapResult.costUsd;

    let gap;
    try {
      gap = JSON.parse(stripJson(gapResult.text));
    } catch {
      await logError('competitorAnalysis.parse.gap', new Error('invalid JSON'), { jobName: 'findLeads' });
      return null;
    }

    return {
      competitors: validProfiles,
      pros: gap.pros || [],
      cons: gap.cons || [],
      gaps: gap.gaps || [],
      opportunityHook: gap.opportunityHook || '',
      costUsd: totalCost,
    };
  } catch (err) {
    await logError('competitorAnalysis', err, { jobName: 'findLeads' });
    return null;
  }
}
