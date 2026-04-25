import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma, getConfigInt, getConfigMap } from '../../core/db/index.js';
import { bucket } from '../../core/ai/icpScorer.js';
import { parseLeadsQuery } from './leads/filterParser.js';

const router = Router();

// Cached thresholds — refreshed per request via getConfigMap. Cheap query.
async function getThresholds() {
  const cfg = await getConfigMap();
  return {
    threshA: getConfigInt(cfg, 'icp_threshold_a', 70),
    threshB: getConfigInt(cfg, 'icp_threshold_b', 40),
  };
}

// Returns ids of leads where the JSONB array column shares any element with `values`.
// Uses Postgres `?|` operator on jsonb arrays; identifier interpolation goes
// through Prisma.raw (safe — caller passes a hardcoded column name), the
// values list is parameterized as text[]. Returns null when the cleaned
// values list is empty (no constraint to apply).
async function jsonArrayFilterIds(prisma, column, values) {
  const clean = values.filter(v => typeof v === 'string' && v.length > 0);
  if (!clean.length) return null;
  const rows = await prisma.$queryRaw`
    SELECT id FROM leads
    WHERE jsonb_typeof(${Prisma.raw(`"${column}"`)}) = 'array'
      AND ${Prisma.raw(`"${column}"`)} ?| ${clean}::text[]
  `;
  return rows.map(r => r.id);
}

function serializeLead(l, thresholds) {
  if (!l) return null;
  const t = thresholds || { threshA: 70, threshB: 40 };
  // Replace v1 stored icp_priority with a computed bucket from icp_score (ICP v2).
  // 'high' (≥A) → A | 'medium' (≥B) → B | 'low' (<B) → C
  const bucketName = l.icpScore != null ? bucket(l.icpScore, t.threshA, t.threshB) : null;
  const priorityLetter = { high: 'A', medium: 'B', low: 'C' }[bucketName] || null;
  return {
    id: l.id,
    discovered_at: l.discoveredAt,
    business_name: l.businessName,
    website_url: l.websiteUrl,
    category: l.category,
    city: l.city,
    country: l.country,
    search_query: l.searchQuery,
    tech_stack: l.techStack,
    website_problems: l.websiteProblems,
    last_updated: l.lastUpdated,
    has_ssl: l.hasSsl,
    has_analytics: l.hasAnalytics,
    owner_name: l.ownerName,
    owner_role: l.ownerRole,
    business_signals: l.businessSignals,
    social_active: l.socialActive,
    website_quality_score: l.websiteQualityScore,
    judge_reason: l.judgeReason,
    judge_skip: l.judgeSkip,
    icp_score: l.icpScore,
    icp_reason: l.icpReason,
    icp_breakdown: l.icpBreakdown,
    icp_key_matches: l.icpKeyMatches,
    icp_key_gaps: l.icpKeyGaps,
    icp_disqualifiers: l.icpDisqualifiers,
    employees_estimate: l.employeesEstimate,
    business_stage: l.businessStage,
    contact_name: l.contactName,
    contact_email: l.contactEmail,
    contact_confidence: l.contactConfidence,
    contact_source: l.contactSource,
    email_status: l.emailStatus,
    email_verified_at: l.emailVerifiedAt,
    status: l.status,
    domain_last_contacted: l.domainLastContacted,
    in_reject_list: l.inRejectList,
    gemini_tokens_used: l.geminiTokensUsed,
    gemini_cost_usd: l.geminiCostUsd !== null && l.geminiCostUsd !== undefined ? Number(l.geminiCostUsd) : null,
    discovery_model: l.discoveryModel,
    extraction_model: l.extractionModel,
    judge_model: l.judgeModel,
    icp_priority_v2: priorityLetter,
    icp_bucket: bucketName,
    dm_linkedin_url: l.dmLinkedinUrl,
    company_linkedin_url: l.companyLinkedinUrl,
    founder_linkedin_url: l.founderLinkedinUrl,
    manual_hook_note: l.manualHookNote,
  };
}

function serializeSignal(s) {
  if (!s) return null;
  return {
    id: s.id,
    lead_id: s.leadId,
    source: s.source,
    signal_type: s.signalType,
    headline: s.headline,
    url: s.url || null,
    payload: s.payloadJson,
    confidence: s.confidence,
    signal_date: s.signalDate,
    collected_at: s.collectedAt,
  };
}

function serializeEmail(e) {
  if (!e) return null;
  return {
    id: e.id,
    lead_id: e.leadId,
    sequence_step: e.sequenceStep,
    inbox_used: e.inboxUsed,
    from_domain: e.fromDomain,
    from_name: e.fromName,
    subject: e.subject,
    body: e.body,
    word_count: e.wordCount,
    hook: e.hook,
    contains_link: e.containsLink,
    is_html: e.isHtml,
    is_plain_text: e.isPlainText,
    content_valid: e.contentValid,
    validation_fail_reason: e.validationFailReason,
    regenerated: e.regenerated,
    status: e.status,
    sent_at: e.sentAt,
    smtp_response: e.smtpResponse,
    smtp_code: e.smtpCode,
    message_id: e.messageId,
    send_duration_ms: e.sendDurationMs,
    in_reply_to: e.inReplyTo,
    references_header: e.referencesHeader,
    hook_model: e.hookModel,
    body_model: e.bodyModel,
    hook_cost_usd: e.hookCostUsd !== null && e.hookCostUsd !== undefined ? Number(e.hookCostUsd) : null,
    body_cost_usd: e.bodyCostUsd !== null && e.bodyCostUsd !== undefined ? Number(e.bodyCostUsd) : null,
    total_cost_usd: e.totalCostUsd !== null && e.totalCostUsd !== undefined ? Number(e.totalCostUsd) : null,
    created_at: e.createdAt,
  };
}

function serializeReply(r) {
  if (!r) return null;
  return {
    id: r.id,
    lead_id: r.leadId,
    email_id: r.emailId,
    inbox_received_at: r.inboxReceivedAt,
    received_at: r.receivedAt,
    category: r.category,
    raw_text: r.rawText,
    classification_model: r.classificationModel,
    classification_cost_usd: r.classificationCostUsd !== null && r.classificationCostUsd !== undefined ? Number(r.classificationCostUsd) : null,
    sentiment_score: r.sentimentScore,
    telegram_alerted: r.telegramAlerted,
    requeue_date: r.requeueDate,
    actioned_at: r.actionedAt,
    action_taken: r.actionTaken,
  };
}

function serializeSequence(s) {
  if (!s) return null;
  return {
    id: s.id,
    lead_id: s.leadId,
    current_step: s.currentStep,
    next_send_date: s.nextSendDate,
    last_sent_at: s.lastSentAt,
    last_message_id: s.lastMessageId,
    last_subject: s.lastSubject,
    status: s.status,
    paused_reason: s.pausedReason,
    updated_at: s.updatedAt,
  };
}

router.get('/', async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const offset = (page - 1) * limit;

  const thresholds = await getThresholds();
  const { where, orderBy, signalFilter } = parseLeadsQuery(req.query, thresholds);

  // Signal sub-query: filter leadIds by lead_signals join + count threshold,
  // then AND the eligible id list into `where`.
  if (Object.keys(signalFilter).length) {
    const sw = {};
    if (signalFilter.types) sw.signalType = { in: signalFilter.types };
    if (signalFilter.from || signalFilter.to) {
      sw.signalDate = {};
      if (signalFilter.from) sw.signalDate.gte = signalFilter.from;
      if (signalFilter.to)   sw.signalDate.lte = signalFilter.to;
    }
    const grouped = await prisma.leadSignal.groupBy({
      by: ['leadId'], where: sw, _count: { _all: true },
    });
    const minCount = signalFilter.minCount || 1;
    const eligible = grouped.filter(g => g._count._all >= minCount).map(g => g.leadId);
    where.AND = (where.AND || []).concat([{ id: { in: eligible.length ? eligible : [-1] } }]);
  }

  // JSONB array filters: ?| (any-of) on tech_stack / business_signals.
  // Guarded by jsonb_typeof = 'array' so non-array JSON values don't error.
  const techStack = Array.isArray(req.query.tech_stack) ? req.query.tech_stack : req.query.tech_stack ? [req.query.tech_stack] : [];
  if (techStack.length) {
    const ids = await jsonArrayFilterIds(prisma, 'tech_stack', techStack);
    if (ids !== null) where.AND = (where.AND || []).concat([{ id: { in: ids.length ? ids : [-1] } }]);
  }

  const bizSigs = Array.isArray(req.query.business_signals) ? req.query.business_signals : req.query.business_signals ? [req.query.business_signals] : [];
  if (bizSigs.length) {
    const ids = await jsonArrayFilterIds(prisma, 'business_signals', bizSigs);
    if (ids !== null) where.AND = (where.AND || []).concat([{ id: { in: ids.length ? ids : [-1] } }]);
  }

  const [total, leads] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.findMany({ where, orderBy, take: limit, skip: offset }),
  ]);

  // Pre-join lead_signals counts so the dashboard can show a per-row badge
  // without N+1 fetches. Empty when feature is unused.
  const leadIds = leads.map(l => l.id);
  const signalCounts = leadIds.length > 0
    ? await prisma.leadSignal.groupBy({ by: ['leadId'], where: { leadId: { in: leadIds } }, _count: { _all: true } })
    : [];
  const countByLead = new Map(signalCounts.map(g => [g.leadId, g._count._all]));

  const enriched = leads.map(l => ({ ...serializeLead(l, thresholds), signal_count: countByLead.get(l.id) || 0 }));
  res.json({ leads: enriched, total, page, limit });
});

router.get('/kpis', async (req, res) => {
  const t = await getThresholds();
  const { where } = parseLeadsQuery(req.query, t);

  async function summarize(scopedWhere) {
    const [total, readyToSend, icpA, icpB, icpC] = await Promise.all([
      prisma.lead.count({ where: scopedWhere }),
      prisma.lead.count({ where: { ...scopedWhere, status: 'ready' } }),
      prisma.lead.count({ where: { ...scopedWhere, icpScore: { gte: t.threshA } } }),
      prisma.lead.count({ where: { ...scopedWhere, icpScore: { gte: t.threshB, lt: t.threshA } } }),
      prisma.lead.count({ where: { ...scopedWhere, icpScore: { lt: t.threshB } } }),
    ]);
    return { total, readyToSend, icpA, icpB, icpC };
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000);
  // Global scope still respects "hide rejected by default" — call parseLeadsQuery
  // with empty req.query to get the same baseline as default-filter view.
  const { where: globalWhere } = parseLeadsQuery({}, t);
  const [globalCounts, inFilterCounts, signals7dRows, repliesAwaiting] = await Promise.all([
    summarize(globalWhere),
    summarize(where),
    prisma.leadSignal.findMany({ where: { signalDate: { gte: sevenDaysAgo } }, distinct: ['leadId'], select: { leadId: true } }),
    prisma.reply.count({ where: { actionedAt: null } }),
  ]);

  res.json({
    global: { ...globalCounts, signals7d: signals7dRows.length, repliesAwaitingTriage: repliesAwaiting },
    inFilter: { ...inFilterCounts },
  });
});

let _facetsCache = { at: 0, data: null };
export function _resetFacetsCacheForTests() { _facetsCache = { at: 0, data: null }; }
router.get('/facets', async (_req, res) => {
  if (_facetsCache.data && Date.now() - _facetsCache.at < 60_000) return res.json(_facetsCache.data);
  const [categories, cities, countries] = await Promise.all([
    prisma.lead.findMany({ where: { category: { not: null } }, distinct: ['category'], select: { category: true } }).then(r => r.map(x => x.category)),
    prisma.lead.findMany({ where: { city:     { not: null } }, distinct: ['city'],     select: { city: true } }).then(r => r.map(x => x.city)),
    prisma.lead.findMany({ where: { country:  { not: null } }, distinct: ['country'],  select: { country: true } }).then(r => r.map(x => x.country)),
  ]);
  _facetsCache = { at: Date.now(), data: { categories, cities, countries } };
  res.json(_facetsCache.data);
});

router.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id);

  const lead = await prisma.lead.findUnique({ where: { id } });
  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  const [emails, replies, sequence, signals, thresholds] = await Promise.all([
    prisma.email.findMany({ where: { leadId: id }, orderBy: { createdAt: 'desc' } }),
    prisma.reply.findMany({ where: { leadId: id }, orderBy: { receivedAt: 'desc' } }),
    prisma.sequenceState.findUnique({ where: { leadId: id } }),
    prisma.leadSignal.findMany({ where: { leadId: id }, orderBy: { confidence: 'desc' }, take: 10 }),
    getThresholds(),
  ]);

  res.json({
    lead: serializeLead(lead, thresholds),
    emails: emails.map(serializeEmail),
    replies: replies.map(serializeReply),
    sequence: serializeSequence(sequence),
    signals: signals.map(serializeSignal),
  });
});

router.get('/:id/signals', async (req, res) => {
  const id = parseInt(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'invalid id' });

  const signals = await prisma.leadSignal.findMany({
    where: { leadId: id },
    orderBy: { confidence: 'desc' },
    take: 10,
  });
  res.json({ signals: signals.map(serializeSignal) });
});

const PATCH_LEAD_WHITELIST = new Set(['manualHookNote', 'status']);

router.patch('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'invalid id' });

  const body = req.body || {};
  const keys = Object.keys(body);
  const rejected = keys.filter(k => !PATCH_LEAD_WHITELIST.has(k));
  if (rejected.length > 0) {
    return res.status(400).json({ error: `field(s) not allowed: ${rejected.join(', ')}` });
  }
  if (keys.length === 0) {
    return res.status(400).json({ error: 'at least one whitelisted field is required' });
  }

  const lead = await prisma.lead.findUnique({ where: { id }, select: { id: true } });
  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  const data = {};
  if ('manualHookNote' in body) data.manualHookNote = body.manualHookNote === '' ? null : body.manualHookNote;
  if ('status' in body) data.status = body.status;

  const updated = await prisma.lead.update({ where: { id }, data });
  const thresholds = await getThresholds();
  res.json({ ok: true, lead: serializeLead(updated, thresholds) });
});

router.patch('/:id/status', async (req, res) => {
  const id = parseInt(req.params.id);
  const { status } = req.body || {};

  if (!status) return res.status(400).json({ error: 'status is required' });

  const lead = await prisma.lead.findUnique({ where: { id }, select: { id: true } });
  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  await prisma.lead.update({ where: { id }, data: { status } });
  res.json({ ok: true });
});

export { serializeLead, serializeEmail, serializeReply, serializeSignal };
export default router;
