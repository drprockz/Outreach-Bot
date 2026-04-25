import { prisma, getConfigMap, getConfigStr, getConfigInt } from '../../../core/db/index.js';
import { regenerateHook } from '../../../core/pipeline/regenerateHook.js';
import { regenerateBody } from '../../../core/pipeline/regenerateBody.js';
import { reextract } from '../../../core/pipeline/reextract.js';
import { verifyEmail } from '../../../core/pipeline/verifyEmailLib.js';
import { scoreLead, loadScoringContext } from '../../../core/ai/icpScorer.js';

const STAGES = new Set(['verify_email', 'regen_hook', 'regen_body', 'rescore_icp', 'reextract', 'rejudge']);
const MEV_FALLBACK = Number(process.env.MEV_COST_PER_CALL) || 0.0006;

function avg(rows, key) {
  const xs = rows.map(r => Number(r[key])).filter(n => Number.isFinite(n) && n > 0);
  return xs.length ? { mean: xs.reduce((a, b) => a + b, 0) / xs.length, count: xs.length } : { mean: 0, count: 0 };
}

async function estimateCost(stage) {
  if (stage === 'verify_email') return { mean: MEV_FALLBACK, count: 999 };
  if (stage === 'regen_hook' || stage === 'regen_body') {
    const rows = await prisma.email.findMany({ orderBy: { id: 'desc' }, take: 200, select: { hookCostUsd: true, bodyCostUsd: true } });
    return avg(rows, stage === 'regen_hook' ? 'hookCostUsd' : 'bodyCostUsd');
  }
  // rescore_icp / reextract / rejudge — proxy via Lead.geminiCostUsd
  const rows = await prisma.lead.findMany({ where: { geminiCostUsd: { gt: 0 } }, orderBy: { id: 'desc' }, take: 200, select: { geminiCostUsd: true } });
  return avg(rows, 'geminiCostUsd');
}

function toLegacyShape(lead) {
  return {
    id: lead.id,
    business_name: lead.businessName,
    website_url: lead.websiteUrl,
    city: lead.city,
    category: lead.category,
    contact_name: lead.contactName,
    contact_email: lead.contactEmail,
    owner_name: lead.ownerName,
    owner_role: lead.ownerRole,
    employees_estimate: lead.employeesEstimate,
    business_stage: lead.businessStage,
    tech_stack: lead.techStack,
    business_signals: lead.businessSignals,
    website_problems: lead.websiteProblems,
    judge_reason: lead.judgeReason,
    manual_hook_note: lead.manualHookNote,
  };
}

async function loadCtx(stage) {
  const cfg = await getConfigMap();
  const persona = {
    name:     getConfigStr(cfg, 'persona_name',     'Darshan Parmar'),
    role:     getConfigStr(cfg, 'persona_role',     'Full-Stack Developer'),
    company:  getConfigStr(cfg, 'persona_company',  'Simple Inc'),
    tone:     getConfigStr(cfg, 'persona_tone',     'professional but direct'),
    services: getConfigStr(cfg, 'persona_services', 'web rebuilds and custom software'),
  };
  const ctx = { persona };
  if (stage === 'rescore_icp') {
    const scoringCtx = await loadScoringContext(prisma);
    const weights = {
      firmographic: getConfigInt(cfg, 'icp_weight_firmographic', 20),
      problem:      getConfigInt(cfg, 'icp_weight_problem',      20),
      intent:       getConfigInt(cfg, 'icp_weight_intent',       15),
      tech:         getConfigInt(cfg, 'icp_weight_tech',         15),
      economic:     getConfigInt(cfg, 'icp_weight_economic',     15),
      buying:       getConfigInt(cfg, 'icp_weight_buying',       15),
    };
    ctx.scoringCtx = { ...scoringCtx, weights };
  }
  return ctx;
}

async function runStage(stage, lead, ctx) {
  const legacy = toLegacyShape(lead);
  if (stage === 'verify_email') {
    if (!lead.contactEmail) throw new Error('no_contact_email');
    const r = await verifyEmail(lead.contactEmail);
    if (!r || !r.status || r.status === 'skipped' || r.status === 'error') {
      throw new Error(`verify_email_failed: ${r?.status || 'no_response'}`);
    }
    await prisma.lead.update({ where: { id: lead.id }, data: { emailStatus: r.status, emailVerifiedAt: new Date() } });
    return { costUsd: r.costUsd || 0 };
  }
  if (stage === 'rescore_icp') {
    const r = await scoreLead(legacy, ctx.scoringCtx);
    await prisma.lead.update({ where: { id: lead.id }, data: {
      icpScore: r.icp_score, icpReason: r.icp_reason, icpBreakdown: r.icp_breakdown,
      icpKeyMatches: r.icp_key_matches, icpKeyGaps: r.icp_key_gaps, icpDisqualifiers: r.icp_disqualifiers,
    }});
    return { costUsd: r.costUsd || 0 };
  }
  if (stage === 'regen_hook') {
    const email = await prisma.email.findFirst({ where: { leadId: lead.id, sequenceStep: 0, status: 'pending' } });
    if (!email) throw new Error('no_pending_email');
    const signals = await prisma.leadSignal.findMany({ where: { leadId: lead.id }, orderBy: { confidence: 'desc' }, take: 3 });
    const r = await regenerateHook(legacy, ctx.persona, signals);
    await prisma.email.update({ where: { id: email.id }, data: {
      hook: r.hook, hookCostUsd: r.costUsd, hookModel: r.model, hookVariantId: r.hookVariantId,
    }});
    return { costUsd: r.costUsd, hook: r.hook };
  }
  if (stage === 'regen_body') {
    const email = await prisma.email.findFirst({ where: { leadId: lead.id, sequenceStep: 0, status: 'pending' } });
    if (!email) throw new Error('no_pending_email');
    if (!email.hook) throw new Error('no_hook_run_regen_hook_first');
    const r = await regenerateBody(legacy, email.hook, ctx.persona);
    await prisma.email.update({ where: { id: email.id }, data: {
      body: r.body, bodyCostUsd: r.costUsd, bodyModel: r.model,
    }});
    return { costUsd: r.costUsd };
  }
  if (stage === 'reextract') {
    const r = await reextract(legacy);
    if (!r.data) throw new Error('reextract_failed');
    await prisma.lead.update({ where: { id: lead.id }, data: {
      ownerName: r.data.owner_name, ownerRole: r.data.owner_role,
      contactEmail: r.data.contact_email, contactConfidence: r.data.contact_confidence, contactSource: r.data.contact_source,
      techStack: r.data.tech_stack, websiteProblems: r.data.website_problems,
      lastUpdated: r.data.last_updated, hasSsl: !!r.data.has_ssl, hasAnalytics: !!r.data.has_analytics,
      businessSignals: r.data.business_signals, socialActive: !!r.data.social_active,
      websiteQualityScore: r.data.website_quality_score, judgeReason: r.data.judge_reason,
      employeesEstimate: r.data.employees_estimate, businessStage: r.data.business_stage,
    }});
    return { costUsd: r.costUsd };
  }
  if (stage === 'rejudge') {
    const r = await reextract(legacy);
    if (!r.data) throw new Error('rejudge_failed');
    await prisma.lead.update({ where: { id: lead.id }, data: {
      judgeReason: r.data.judge_reason,
      websiteQualityScore: r.data.website_quality_score,
    }});
    return { costUsd: r.costUsd };
  }
  throw new Error(`unknown_stage_${stage}`);
}

export async function bulkRetry(req, res) {
  const { leadIds, stage } = req.body || {};
  if (!STAGES.has(stage)) return res.status(400).json({ error: 'invalid_stage' });
  if (!Array.isArray(leadIds) || leadIds.length === 0) return res.status(400).json({ error: 'no_lead_ids' });
  if (leadIds.length > 25) return res.status(400).json({ error: 'batch_too_large', max: 25 });

  if (req.query.dry_run === '1' || req.query.dry_run === 'true') {
    const est = await estimateCost(stage);
    const total = est.mean * leadIds.length;
    return res.json({
      count: leadIds.length,
      estimated_cost_usd: Number(total.toFixed(4)),
      breakdown_by_stage: { [stage]: Number(total.toFixed(4)) },
      estimate_quality: est.count < 5 ? 'low' : 'normal',
    });
  }

  if (process.env.BULK_RETRY_ENABLED !== 'true') return res.status(503).json({ error: 'bulk_retry_disabled' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  let aborted = false;
  res.on('close', () => { if (!res.writableEnded) aborted = true; });

  const ctx = await loadCtx(stage);
  const leads = await prisma.lead.findMany({ where: { id: { in: leadIds } } });
  for (const lead of leads) {
    if (aborted) break;
    try {
      const r = await runStage(stage, lead, ctx);
      res.write(`data: ${JSON.stringify({ leadId: lead.id, status: 'ok', costUsd: r.costUsd })}\n\n`);
    } catch (err) {
      try {
        await prisma.errorLog.create({ data: {
          source: 'bulk_retry', errorType: stage, errorMessage: err.message, leadId: lead.id, occurredAt: new Date(),
        }});
      } catch { /* don't let logging failure break the loop */ }
      res.write(`data: ${JSON.stringify({ leadId: lead.id, status: 'error', error: err.message })}\n\n`);
    }
  }
  if (!aborted) {
    res.write('data: {"status":"done"}\n\n');
    res.end();
  }
}
