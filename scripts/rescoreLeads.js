import 'dotenv/config';
import { getPrisma, getConfigMap, getConfigInt, getConfigStr } from '../src/core/db/index.js';
import { loadScoringContext, scoreLead } from '../src/core/ai/icpScorer.js';

const DEFAULT_WEIGHTS = { firmographic: 20, problem: 20, intent: 15, tech: 15, economic: 15, buying: 15 };
const SCOREABLE_STATUSES = ['ready', 'sent', 'replied', 'nurture', 'bounced', 'unsubscribed'];

// Prisma returns camelCase; scoreLead's buildScorerPrompt expects snake_case.
// Translate just the fields the prompt reads.
function toScorerLead(lead) {
  return {
    id: lead.id,
    business_name: lead.businessName,
    category: lead.category,
    city: lead.city,
    employees_estimate: lead.employeesEstimate,
    business_stage: lead.businessStage,
    tech_stack: Array.isArray(lead.techStack) ? lead.techStack : [],
    owner_role: lead.ownerRole,
    business_signals: Array.isArray(lead.businessSignals) ? lead.businessSignals : [],
    website_problems: Array.isArray(lead.websiteProblems) ? lead.websiteProblems : [],
    judge_reason: lead.judgeReason,
  };
}

export default async function rescoreLeads({ legacy = false } = {}) {
  if (legacy) return rescoreLegacy();

  const prisma = getPrisma();
  const cfg = await getConfigMap();
  const scoringCtx = await loadScoringContext(prisma);
  scoringCtx.weights = (() => {
    try { return JSON.parse(getConfigStr(cfg, 'icp_weights', JSON.stringify(DEFAULT_WEIGHTS))); }
    catch { return DEFAULT_WEIGHTS; }
  })();
  scoringCtx.threshA = getConfigInt(cfg, 'icp_threshold_a', 70);
  scoringCtx.threshB = getConfigInt(cfg, 'icp_threshold_b', 40);

  const leads = await prisma.lead.findMany({
    where: { status: { in: SCOREABLE_STATUSES } },
    orderBy: { id: 'asc' },
  });

  const stats = { total: leads.length, A: 0, B: 0, C: 0, disqualified: 0, ready_to_dq: 0, cost: 0 };

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];
    const icp = await scoreLead(toScorerLead(lead), scoringCtx);
    stats.cost += icp.costUsd;

    await prisma.$transaction(async (tx) => {
      await tx.lead.update({
        where: { id: lead.id },
        data: {
          icpScore: icp.icp_score,
          icpPriority: icp.icp_priority,
          icpReason: icp.icp_reason,
          icpBreakdown: icp.icp_breakdown || null,
          icpKeyMatches: icp.icp_key_matches || [],
          icpKeyGaps: icp.icp_key_gaps || [],
          icpDisqualifiers: icp.icp_disqualifiers || [],
        },
      });

      if (icp.icp_disqualifiers.length > 0 && lead.status === 'ready') {
        await tx.lead.update({ where: { id: lead.id }, data: { status: 'disqualified' } });
        await tx.email.deleteMany({ where: { leadId: lead.id, status: 'pending' } });
      }
    });

    stats[icp.icp_priority]++;
    if (icp.icp_disqualifiers.length > 0) {
      stats.disqualified++;
      if (lead.status === 'ready') stats.ready_to_dq++;
    }

    if ((i + 1) % 50 === 0) {
      console.log(`[rescore] ${i + 1}/${leads.length} done ($${stats.cost.toFixed(4)} so far)`);
    }
  }

  console.log('\n=== Rescore summary ===');
  console.log(`Total: ${stats.total}`);
  console.log(`A: ${stats.A}  B: ${stats.B}  C: ${stats.C}  Disqualified: ${stats.disqualified}`);
  console.log(`ready → disqualified transitions: ${stats.ready_to_dq}`);
  console.log(`Gemini cost: $${stats.cost.toFixed(4)}`);

  return stats;
}

async function rescoreLegacy() {
  const { callGemini } = await import('../src/core/ai/gemini.js');
  const prisma = getPrisma();

  const rules = await prisma.icpRule.findMany({ where: { enabled: true }, orderBy: { sortOrder: 'asc' } });
  if (rules.length === 0) throw new Error('legacy rescore requires icp_rules rows');
  const rubric = rules.map(r => `${r.points > 0 ? '+' : ''}${r.points}  ${r.label}`).join('\n');
  const threshA = 7;
  const threshB = 4;

  const leads = await prisma.lead.findMany({
    where: { status: { in: SCOREABLE_STATUSES } },
  });

  let cost = 0;
  for (const lead of leads) {
    const prompt = `Score this lead on the ICP rubric and return JSON {icp_score: number, icp_priority: "A"|"B"|"C", icp_reason: "brief explanation"}.

Rubric:
${rubric}

Priority: A=${threshA}-10, B=${threshB}-${threshA - 1}, C=below ${threshB} (including negative)

Lead data:
Company: ${lead.businessName}
Tech stack: ${JSON.stringify(lead.techStack || [])}
Business signals: ${JSON.stringify(lead.businessSignals || [])}
City: ${lead.city}
Category: ${lead.category}
Quality score: ${lead.websiteQualityScore}

Return only valid JSON.`;
    const result = await callGemini(prompt);
    cost += result.costUsd;
    let parsed;
    try {
      parsed = JSON.parse(result.text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim());
    } catch {
      parsed = { icp_score: 0, icp_priority: 'C', icp_reason: 'parse error' };
    }
    await prisma.lead.update({
      where: { id: lead.id },
      data: { icpScore: parsed.icp_score, icpPriority: parsed.icp_priority, icpReason: parsed.icp_reason || '' },
    });
  }
  console.log(`Legacy rescore done: ${leads.length} leads, cost $${cost.toFixed(4)}`);
  return { total: leads.length, cost };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*[/\\]/, ''))) {
  const legacy = process.argv.includes('--legacy');
  rescoreLeads({ legacy }).catch(err => { console.error(err); process.exit(1); });
}
