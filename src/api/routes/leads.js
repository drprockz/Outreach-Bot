import { Router } from 'express';
import { prisma } from '../../core/db/index.js';

const router = Router();

function serializeLead(l) {
  if (!l) return null;
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

  const where = {};
  if (req.query.status) where.status = req.query.status;
  if (req.query.category) where.category = req.query.category;
  if (req.query.city) where.city = req.query.city;
  if (req.query.date_from) where.discoveredAt = { ...(where.discoveredAt || {}), gte: new Date(req.query.date_from) };
  if (req.query.date_to) where.discoveredAt = { ...(where.discoveredAt || {}), lte: new Date(req.query.date_to) };
  // tech_stack filter: leave out — previously worked as LIKE against a string column,
  // now techStack is JSON. Skip for now to avoid raw SQL (contract: filter is optional).

  const [total, leads] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.findMany({ where, orderBy: { id: 'desc' }, take: limit, skip: offset }),
  ]);

  res.json({ leads: leads.map(serializeLead), total, page, limit });
});

router.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id);

  const lead = await prisma.lead.findUnique({ where: { id } });
  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  const emails = await prisma.email.findMany({ where: { leadId: id }, orderBy: { createdAt: 'desc' } });
  const replies = await prisma.reply.findMany({ where: { leadId: id }, orderBy: { receivedAt: 'desc' } });
  const sequence = await prisma.sequenceState.findUnique({ where: { leadId: id } });

  res.json({
    lead: serializeLead(lead),
    emails: emails.map(serializeEmail),
    replies: replies.map(serializeReply),
    sequence: serializeSequence(sequence),
  });
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

export { serializeLead, serializeEmail, serializeReply };
export default router;
