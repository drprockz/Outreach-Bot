import 'dotenv/config';
import { getDb, getConfigMap, getConfigInt, getConfigStr } from '../src/core/db/index.js';
import { loadScoringContext, scoreLead } from '../src/core/ai/icpScorer.js';

const DEFAULT_WEIGHTS = { firmographic: 20, problem: 20, intent: 15, tech: 15, economic: 15, buying: 15 };
const SCOREABLE_STATUSES = ['ready', 'sent', 'replied', 'nurture', 'bounced', 'unsubscribed'];

export default async function rescoreLeads({ legacy = false } = {}) {
  if (legacy) {
    return rescoreLegacy();
  }

  const db = getDb();
  const cfg = getConfigMap();
  const scoringCtx = loadScoringContext(db);
  scoringCtx.weights = (() => {
    try { return JSON.parse(getConfigStr(cfg, 'icp_weights', JSON.stringify(DEFAULT_WEIGHTS))); }
    catch { return DEFAULT_WEIGHTS; }
  })();
  scoringCtx.threshA = getConfigInt(cfg, 'icp_threshold_a', 70);
  scoringCtx.threshB = getConfigInt(cfg, 'icp_threshold_b', 40);

  const placeholders = SCOREABLE_STATUSES.map(() => '?').join(',');
  const leads = db.prepare(
    `SELECT * FROM leads WHERE status IN (${placeholders}) ORDER BY id`
  ).all(...SCOREABLE_STATUSES);

  const stats = { total: leads.length, A: 0, B: 0, C: 0, disqualified: 0, ready_to_dq: 0, cost: 0 };
  const updateStmt = db.prepare(`
    UPDATE leads SET
      icp_score=?, icp_priority=?, icp_reason=?,
      icp_breakdown=?, icp_key_matches=?, icp_key_gaps=?, icp_disqualifiers=?
    WHERE id=?
  `);
  const statusUpdate = db.prepare(`UPDATE leads SET status='disqualified' WHERE id=?`);
  const deletePending = db.prepare(`DELETE FROM emails WHERE lead_id=? AND status='pending'`);

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];
    try { lead.tech_stack = JSON.parse(lead.tech_stack || '[]'); } catch { lead.tech_stack = []; }
    try { lead.website_problems = JSON.parse(lead.website_problems || '[]'); } catch { lead.website_problems = []; }
    try { lead.business_signals = JSON.parse(lead.business_signals || '[]'); } catch { lead.business_signals = []; }

    const icp = await scoreLead(lead, scoringCtx);
    stats.cost += icp.costUsd;

    updateStmt.run(
      icp.icp_score, icp.icp_priority, icp.icp_reason,
      JSON.stringify(icp.icp_breakdown || null),
      JSON.stringify(icp.icp_key_matches || []),
      JSON.stringify(icp.icp_key_gaps || []),
      JSON.stringify(icp.icp_disqualifiers || []),
      lead.id
    );

    stats[icp.icp_priority]++;

    if (icp.icp_disqualifiers.length > 0) {
      stats.disqualified++;
      if (lead.status === 'ready') {
        statusUpdate.run(lead.id);
        deletePending.run(lead.id);
        stats.ready_to_dq++;
      }
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
  const db = getDb();

  const rules = db.prepare('SELECT * FROM icp_rules WHERE enabled=1 ORDER BY sort_order').all();
  if (rules.length === 0) throw new Error('legacy rescore requires icp_rules rows');
  const rubric = rules.map(r => `${r.points > 0 ? '+' : ''}${r.points}  ${r.label}`).join('\n');
  const threshA = 7;
  const threshB = 4;

  const placeholders = SCOREABLE_STATUSES.map(() => '?').join(',');
  const leads = db.prepare(`SELECT * FROM leads WHERE status IN (${placeholders})`).all(...SCOREABLE_STATUSES);

  const stmt = db.prepare(`UPDATE leads SET icp_score=?, icp_priority=?, icp_reason=? WHERE id=?`);
  let cost = 0;
  for (const lead of leads) {
    const prompt = `Score this lead on the ICP rubric and return JSON {icp_score: number, icp_priority: "A"|"B"|"C", icp_reason: "brief explanation"}.

Rubric:
${rubric}

Priority: A=${threshA}-10, B=${threshB}-${threshA - 1}, C=below ${threshB} (including negative)

Lead data:
Company: ${lead.business_name}
Tech stack: ${lead.tech_stack || 'unknown'}
Business signals: ${lead.business_signals || 'none'}
City: ${lead.city}
Category: ${lead.category}
Quality score: ${lead.website_quality_score}

Return only valid JSON.`;
    const result = await callGemini(prompt);
    cost += result.costUsd;
    let parsed;
    try {
      parsed = JSON.parse(result.text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim());
    } catch {
      parsed = { icp_score: 0, icp_priority: 'C', icp_reason: 'parse error' };
    }
    stmt.run(parsed.icp_score, parsed.icp_priority, parsed.icp_reason || '', lead.id);
  }
  console.log(`Legacy rescore done: ${leads.length} leads, cost $${cost.toFixed(4)}`);
  return { total: leads.length, cost };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*[/\\]/, ''))) {
  const legacy = process.argv.includes('--legacy');
  rescoreLeads({ legacy }).catch(err => { console.error(err); process.exit(1); });
}
