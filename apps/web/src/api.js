// ─── api.js ─────────────────────────────────────────────────────────────────
//
// Thin client used by the legacy `.jsx` pages. Two transports under one roof:
//
//   1. GraphQL adapter (default)
//      Most read/write methods talk to `/graphql` (apps/api). Each operation
//      uses GraphQL field aliases to reshape the camelCase server payload
//      into the snake_case shape the legacy REST routes used to return, so
//      the consuming pages don't need to change. Long-form aliasing is
//      deliberate — it keeps the wire shape pinned and surfaces drift in PRs.
//
//   2. REST passthrough (holdouts)
//      A few endpoints stay on legacy REST for now. Each line in the
//      "REST holdouts" block below has a comment explaining why; in short:
//      query-string parsing not yet ported (leads/sendLog/leadKpis), changed
//      runtime semantics from the BullMQ cutover (runEngine/engineStatus/
//      unlockEngine), binary streaming (exportLeadsCsv), or scoped to a
//      separate PR for the bulk-action UI (bulkLeadStatus/bulkLeadRetryDryRun).
//      `request()` and `requestWithStatus()` are kept solely for these.
//
// Pages that already use `urql` directly (settings/*, superadmin/*) bypass
// this file entirely. Once every page has migrated this file goes away.
// ────────────────────────────────────────────────────────────────────────────

const BASE = import.meta.env.VITE_API_BASE || '/api';
const GRAPHQL_URL = (import.meta.env.VITE_API_URL ?? '') + '/graphql';

// ── REST helpers (holdouts only) ───────────────────────────────────────────
async function request(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.headers || {})
    }
  });
  if (res.status === 401) {
    window.location.href = '/login';
    return;
  }
  return res.json();
}

async function requestWithStatus(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.headers || {})
    }
  });
  if (res.status === 401) {
    window.location.href = '/login';
    return { status: 401, body: null };
  }
  const body = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, body };
}

// ── GraphQL helper ─────────────────────────────────────────────────────────
async function gql(query, variables) {
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables })
  });
  if (res.status === 401) {
    window.location.href = '/login';
    return null;
  }
  const json = await res.json().catch(() => ({}));
  if (json.errors?.length) {
    return { error: json.errors[0].message };
  }
  return json.data;
}

// ── GraphQL operation strings ──────────────────────────────────────────────
// Aliases force the server's camelCase fields into the snake_case shape the
// legacy pages expect. Top-level wrappers like `{items}` / `{ok}` / `{view}`
// are added in JS after the fetch.

const Q_OVERVIEW = `query Overview {
  overview {
    metrics {
      today {
        id date
        leads_discovered: leadsDiscovered
        leads_extracted: leadsExtracted
        leads_judge_passed: leadsJudgePassed
        leads_email_found: leadsEmailFound
        leads_email_valid: leadsEmailValid
        leads_icp_ready: leadsIcpReady
        leads_ready: leadsReady
        leads_disqualified: leadsDisqualified
        emails_attempted: emailsAttempted
        emails_sent: emailsSent
        emails_hard_bounced: emailsHardBounced
        emails_soft_bounced: emailsSoftBounced
        emails_content_rejected: emailsContentRejected
        sent_inbox_1: sentInbox1
        sent_inbox_2: sentInbox2
        replies_total: repliesTotal
        replies_hot: repliesHot
        replies_schedule: repliesSchedule
        replies_soft_no: repliesSoftNo
        replies_unsubscribe: repliesUnsubscribe
        replies_ooo: repliesOoo
        replies_other: repliesOther
        bounce_rate: bounceRate
        reply_rate: replyRate
        unsubscribe_rate: unsubscribeRate
        gemini_cost_usd: geminiCostUsd
        sonnet_cost_usd: sonnetCostUsd
        haiku_cost_usd: haikuCostUsd
        mev_cost_usd: mevCostUsd
        total_api_cost_usd: totalApiCostUsd
        total_api_cost_inr: totalApiCostInr
        domain_blacklisted: domainBlacklisted
        mail_tester_score: mailTesterScore
        postmaster_reputation: postmasterReputation
        icp_parse_errors: icpParseErrors
        followups_sent: followupsSent
        created_at: createdAt
      }
      week {
        leads_discovered: leadsDiscovered
        emails_sent: emailsSent
        emails_hard_bounced: emailsHardBounced
        replies_total: repliesTotal
        replies_hot: repliesHot
        total_api_cost_usd: totalApiCostUsd
      }
      month {
        leads_discovered: leadsDiscovered
        emails_sent: emailsSent
        emails_hard_bounced: emailsHardBounced
        replies_total: repliesTotal
        replies_hot: repliesHot
        total_api_cost_usd: totalApiCostUsd
      }
      activeSequences
      replyRate7d
      bounceRateToday
    }
    funnel {
      total extracted judged
      email_found: emailFound
      email_valid: emailValid
      icp_ready: icpReady
      sent replied
    }
    sendActivity {
      date
      emails_sent: emailsSent
    }
  }
}`;

const Q_REPLIES = `query Replies {
  replies {
    id
    lead_id: leadId
    email_id: emailId
    inbox_received_at: inboxReceivedAt
    received_at: receivedAt
    category
    raw_text: rawText
    classification_model: classificationModel
    classification_cost_usd: classificationCostUsd
    sentiment_score: sentimentScore
    telegram_alerted: telegramAlerted
    requeue_date: requeueDate
    actioned_at: actionedAt
    action_taken: actionTaken
    business_name: businessName
    contact_name: contactName
    contact_email: contactEmail
  }
}`;

const Q_SEQUENCES = `query Sequences {
  sequences {
    sequences {
      id
      lead_id: leadId
      current_step: currentStep
      next_send_date: nextSendDate
      last_sent_at: lastSentAt
      last_message_id: lastMessageId
      last_subject: lastSubject
      status
      paused_reason: pausedReason
      updated_at: updatedAt
      business_name: businessName
      contact_name: contactName
      contact_email: contactEmail
    }
    aggregates {
      active paused completed replied unsubscribed
    }
  }
}`;

const Q_CRON_STATUS = `query CronStatus {
  cronStatus {
    date
    jobs {
      id
      name
      time
      day
      pass
      status
      log {
        id
        job_name: jobName
        scheduled_at: scheduledAt
        started_at: startedAt
        completed_at: completedAt
        duration_ms: durationMs
        status
        error_message: errorMessage
        records_processed: recordsProcessed
        records_skipped: recordsSkipped
        cost_usd: costUsd
        notes
      }
    }
  }
}`;

const Q_CRON_HISTORY = `query CronJobHistory($jobName: String!) {
  cronJobHistory(jobName: $jobName) {
    id
    job_name: jobName
    scheduled_at: scheduledAt
    started_at: startedAt
    completed_at: completedAt
    duration_ms: durationMs
    status
    error_message: errorMessage
    records_processed: recordsProcessed
    records_skipped: recordsSkipped
    cost_usd: costUsd
    notes
  }
}`;

const Q_HEALTH = `query Health {
  health {
    bounceRate
    unsubscribeRate
    domain
    blacklisted
    blacklistZonesJson
    postmasterReputation
    mailTesterScore
    mailTesterDate
    inbox1 { email lastSend }
    inbox2 { email lastSend }
    rejectListSize
  }
}`;

const M_SET_MAIL_TESTER = `mutation SetMailTester($score: Float!) {
  setMailTesterScore(score: $score)
}`;

const Q_COSTS = `query Costs {
  costs {
    daily {
      date
      gemini_cost_usd: geminiCostUsd
      sonnet_cost_usd: sonnetCostUsd
      haiku_cost_usd: haikuCostUsd
      mev_cost_usd: mevCostUsd
      total_api_cost_usd: totalApiCostUsd
    }
    monthly {
      gemini_cost_usd: geminiCostUsd
      sonnet_cost_usd: sonnetCostUsd
      haiku_cost_usd: haikuCostUsd
      mev_cost_usd: mevCostUsd
      total_api_cost_usd: totalApiCostUsd
      emails_sent: emailsSent
      perEmailCost
    }
  }
}`;

const Q_ERRORS = `query Errors($source: String, $errorType: String, $resolved: Boolean, $dateFrom: String, $dateTo: String) {
  errors(source: $source, errorType: $errorType, resolved: $resolved, dateFrom: $dateFrom, dateTo: $dateTo) {
    errors {
      id
      occurred_at: occurredAt
      source
      job_name: jobName
      error_type: errorType
      error_code: errorCode
      error_message: errorMessage
      stack_trace: stackTrace
      lead_id: leadId
      email_id: emailId
      resolved
      resolved_at: resolvedAt
    }
    unresolvedCount
  }
}`;

const M_RESOLVE_ERROR = `mutation ResolveError($id: Int!) {
  resolveError(id: $id)
}`;

const M_REPLY_ACTION = `mutation ActionReply($id: Int!, $action: String!) {
  actionReply(id: $id, action: $action)
}`;

const M_REPLY_REJECT = `mutation RejectReply($id: Int!) {
  rejectReply(id: $id)
}`;

const Q_FUNNEL = `query Funnel {
  funnel {
    stages {
      discovered extracted
      judge_passed: judgePassed
      email_found: emailFound
      email_valid: emailValid
      icp_ready: icpReady
      nurture ready sent replied unsubscribed
      icp_high: icpHigh
      icp_medium: icpMedium
      icp_low: icpLow
    }
    dropReasons {
      extraction_failed: extractionFailed
      gate1_modern_stack: gate1ModernStack
      no_email: noEmail
      email_invalid: emailInvalid
      deduped
      icp_low_nurture: icpLowNurture
      email_not_found: emailNotFound
    }
    dailyTrend {
      date discovered extracted
      judge_passed: judgePassed
      email_found: emailFound
      email_valid: emailValid
      icp_ready: icpReady
      ready sent
    }
    byCategory {
      category total
      icp_high: icpHigh
      icp_medium: icpMedium
      icp_low: icpLow
      ready_or_sent: readyOrSent
    }
    byCity {
      city total
      ready_or_sent: readyOrSent
    }
    icpDistribution {
      icp_score: icpScore
      count
    }
    emailStatusBreakdown {
      status count
    }
    confidenceBreakdown {
      confidence count
    }
  }
}`;

const Q_CONFIG = `query Config {
  config { key value }
}`;

const M_UPDATE_CONFIG = `mutation UpdateConfig($updatesJson: String!) {
  updateConfig(updatesJson: $updatesJson)
}`;

const NICHE_FIELDS = `
  id label query
  day_of_week: dayOfWeek
  enabled
  sort_order: sortOrder
  created_at: createdAt
`;
const Q_NICHES = `query Niches { niches { ${NICHE_FIELDS} } }`;
const M_CREATE_NICHE = `mutation CreateNiche($label: String!, $query: String!, $dayOfWeek: Int, $enabled: Boolean) {
  createNiche(label: $label, query: $query, dayOfWeek: $dayOfWeek, enabled: $enabled) { ${NICHE_FIELDS} }
}`;
const M_UPDATE_NICHE = `mutation UpdateNiche($id: Int!, $label: String!, $query: String!, $dayOfWeek: Int, $enabled: Boolean, $sortOrder: Int) {
  updateNiche(id: $id, label: $label, query: $query, dayOfWeek: $dayOfWeek, enabled: $enabled, sortOrder: $sortOrder) { ${NICHE_FIELDS} }
}`;
const M_DELETE_NICHE = `mutation DeleteNiche($id: Int!) { deleteNiche(id: $id) }`;

const OFFER_FIELDS = `
  id problem outcome category
  use_cases: useCases
  triggers
  alternatives
  differentiation
  price_range: priceRange
  sales_cycle: salesCycle
  criticality
  inaction_cost: inactionCost
  required_inputs: requiredInputs
  proof_points: proofPoints
  updated_at: updatedAt
`;
const Q_OFFER = `query Offer { offer { ${OFFER_FIELDS} } }`;
const M_UPDATE_OFFER = `mutation UpdateOffer(
  $problem: String, $outcome: String, $category: String,
  $useCases: [String!], $triggers: [String!], $alternatives: [String!],
  $differentiation: String, $priceRange: String, $salesCycle: String,
  $criticality: String, $inactionCost: String,
  $requiredInputs: [String!], $proofPoints: [String!]
) {
  updateOffer(
    problem: $problem, outcome: $outcome, category: $category,
    useCases: $useCases, triggers: $triggers, alternatives: $alternatives,
    differentiation: $differentiation, priceRange: $priceRange, salesCycle: $salesCycle,
    criticality: $criticality, inactionCost: $inactionCost,
    requiredInputs: $requiredInputs, proofPoints: $proofPoints
  ) { ${OFFER_FIELDS} }
}`;

const ICP_FIELDS = `
  id
  industries
  company_size: companySize
  revenue_range: revenueRange
  geography
  stage
  tech_stack: techStack
  internal_capabilities: internalCapabilities
  budget_range: budgetRange
  problem_frequency: problemFrequency
  problem_cost: problemCost
  impacted_kpis: impactedKpis
  initiator_roles: initiatorRoles
  decision_roles: decisionRoles
  objections
  buying_process: buyingProcess
  intent_signals: intentSignals
  current_tools: currentTools
  workarounds
  frustrations
  switching_barriers: switchingBarriers
  hard_disqualifiers: hardDisqualifiers
  updated_at: updatedAt
`;
const Q_ICP = `query Icp { icpProfile { ${ICP_FIELDS} } }`;
const M_UPDATE_ICP = `mutation UpdateIcp(
  $industries: [String!], $companySize: String, $revenueRange: String,
  $geography: [String!], $stage: [String!], $techStack: [String!],
  $internalCapabilities: [String!], $budgetRange: String,
  $problemFrequency: String, $problemCost: String, $impactedKpis: [String!],
  $initiatorRoles: [String!], $decisionRoles: [String!], $objections: [String!],
  $buyingProcess: String, $intentSignals: [String!],
  $currentTools: [String!], $workarounds: [String!], $frustrations: [String!],
  $switchingBarriers: [String!], $hardDisqualifiers: [String!]
) {
  updateIcpProfile(
    industries: $industries, companySize: $companySize, revenueRange: $revenueRange,
    geography: $geography, stage: $stage, techStack: $techStack,
    internalCapabilities: $internalCapabilities, budgetRange: $budgetRange,
    problemFrequency: $problemFrequency, problemCost: $problemCost, impactedKpis: $impactedKpis,
    initiatorRoles: $initiatorRoles, decisionRoles: $decisionRoles, objections: $objections,
    buyingProcess: $buyingProcess, intentSignals: $intentSignals,
    currentTools: $currentTools, workarounds: $workarounds, frustrations: $frustrations,
    switchingBarriers: $switchingBarriers, hardDisqualifiers: $hardDisqualifiers
  ) { ${ICP_FIELDS} }
}`;

const Q_ENGINES = `query Engines {
  engines {
    name
    enabled
    schedule
    costToday
    lastRun {
      status
      startedAt
      durationMs
      primaryCount
    }
  }
}`;

const Q_GUARDRAILS = `query EngineGuardrails($engineName: String!) {
  engineGuardrails(engineName: $engineName)
}`;

const M_SAVE_GUARDRAILS = `mutation SaveEngineGuardrails($engineName: String!, $payloadJson: String!) {
  updateEngineGuardrails(engineName: $engineName, payloadJson: $payloadJson)
}`;

const CRON_LOG_SUMMARY_FIELDS = `
  id
  job_name: jobName
  status
  started_at: startedAt
  completed_at: completedAt
  duration_ms: durationMs
  records_processed: recordsProcessed
  records_skipped: recordsSkipped
  cost_usd: costUsd
  error_message: errorMessage
`;

const Q_ENGINE_LATEST = `query EngineLatest($engineName: String!) {
  engineLatest(engineName: $engineName) { ${CRON_LOG_SUMMARY_FIELDS} }
}`;

const Q_ENGINE_STATS = `query EngineStats($engineName: String!, $sample: Int) {
  engineStats(engineName: $engineName, sample: $sample) {
    sample_size: sampleSize
    avg_cost_per_lead_usd: avgCostPerLeadUsd
    median_cost_per_lead_usd: medianCostPerLeadUsd
    avg_duration_ms: avgDurationMs
    most_recent_at: mostRecentAt
  }
}`;

const Q_TODAY_COSTS = `query TodayCosts {
  engineTodayCosts {
    date
    gemini_cost_usd: geminiCostUsd
    sonnet_cost_usd: sonnetCostUsd
    haiku_cost_usd: haikuCostUsd
    mev_cost_usd: mevCostUsd
    total_api_cost_usd: totalApiCostUsd
    leads_discovered: leadsDiscovered
    leads_ready: leadsReady
    leads_disqualified: leadsDisqualified
    emails_attempted: emailsAttempted
    emails_sent: emailsSent
  }
}`;

const Q_LEAD_FACETS = `query LeadFacets {
  leadFacets {
    categories
    cities
    countries
  }
}`;

const SAVED_VIEW_FIELDS = `
  id
  name
  filtersJson
  sort
  updatedAt
`;
const Q_SAVED_VIEWS = `query SavedViews { savedViews { ${SAVED_VIEW_FIELDS} } }`;
const M_CREATE_SAVED_VIEW = `mutation CreateSavedView($name: String!, $filtersJson: String!, $sort: String) {
  createSavedView(name: $name, filtersJson: $filtersJson, sort: $sort) { ${SAVED_VIEW_FIELDS} }
}`;
const M_UPDATE_SAVED_VIEW = `mutation UpdateSavedView($id: Int!, $name: String, $filtersJson: String, $sort: String) {
  updateSavedView(id: $id, name: $name, filtersJson: $filtersJson, sort: $sort) { ${SAVED_VIEW_FIELDS} }
}`;
const M_DELETE_SAVED_VIEW = `mutation DeleteSavedView($id: Int!) { deleteSavedView(id: $id) }`;

// ── Public surface ─────────────────────────────────────────────────────────
export const api = {
  // ── GraphQL-backed reads ────────────────────────────────────────────────
  overview: async () => {
    const data = await gql(Q_OVERVIEW);
    if (!data || data.error) return data;
    const out = data.overview;
    // Legacy returned domain_blacklisted as 0/1 int, GraphQL exposes Boolean
    if (out?.metrics?.today && 'domain_blacklisted' in out.metrics.today) {
      out.metrics.today.domain_blacklisted = out.metrics.today.domain_blacklisted ? 1 : 0;
    }
    return out;
  },
  replies: async () => {
    const data = await gql(Q_REPLIES);
    if (!data || data.error) return data;
    return { replies: data.replies };
  },
  sequences: async () => {
    const data = await gql(Q_SEQUENCES);
    if (!data || data.error) return data;
    return data.sequences;
  },
  cronStatus: async () => {
    const data = await gql(Q_CRON_STATUS);
    if (!data || data.error) return data;
    return data.cronStatus;
  },
  cronHistory: async (job) => {
    const data = await gql(Q_CRON_HISTORY, { jobName: job });
    if (!data || data.error) return data;
    return { history: data.cronJobHistory };
  },
  health: async () => {
    const data = await gql(Q_HEALTH);
    if (!data || data.error) return data;
    const h = data.health;
    // Legacy returned `inboxes: { inbox1, inbox2 }` and `blacklistZones` as
    // a JSON string of zones — preserve those shapes.
    return {
      bounceRate: h.bounceRate,
      unsubscribeRate: h.unsubscribeRate,
      domain: h.domain,
      blacklisted: h.blacklisted,
      blacklistZones: h.blacklistZonesJson ? JSON.parse(h.blacklistZonesJson) : null,
      postmasterReputation: h.postmasterReputation,
      mailTesterScore: h.mailTesterScore,
      mailTesterDate: h.mailTesterDate,
      inboxes: { inbox1: h.inbox1, inbox2: h.inbox2 },
      rejectListSize: h.rejectListSize,
    };
  },
  costs: async () => {
    const data = await gql(Q_COSTS);
    if (!data || data.error) return data;
    return data.costs;
  },
  errors: async (params = '') => {
    const vars = parseErrorsParams(params);
    const data = await gql(Q_ERRORS, vars);
    if (!data || data.error) return data;
    return data.errors;
  },
  funnel: async () => {
    const data = await gql(Q_FUNNEL);
    if (!data || data.error) return data;
    return data.funnel;
  },
  getConfig: async () => {
    const data = await gql(Q_CONFIG);
    if (!data || data.error) return data;
    // Legacy returned a flat `{key: value, ...}` map — collapse the array form
    return Object.fromEntries((data.config || []).map((r) => [r.key, r.value]));
  },
  getNiches: async () => {
    const data = await gql(Q_NICHES);
    if (!data || data.error) return [];
    return data.niches || [];
  },
  getOffer: async () => {
    const data = await gql(Q_OFFER);
    if (!data || data.error) return data;
    return data.offer || {};
  },
  getIcpProfile: async () => {
    const data = await gql(Q_ICP);
    if (!data || data.error) return data;
    return data.icpProfile || {};
  },
  getEngines: async () => {
    const data = await gql(Q_ENGINES);
    if (!data || data.error) return data;
    return { items: data.engines };
  },
  getGuardrails: async (name) => {
    const data = await gql(Q_GUARDRAILS, { engineName: name });
    if (!data || data.error) return data;
    try {
      return JSON.parse(data.engineGuardrails);
    } catch {
      return {};
    }
  },
  engineLatest: async (engineName) => {
    const data = await gql(Q_ENGINE_LATEST, { engineName });
    if (!data || data.error) return data;
    return { cron_log: data.engineLatest };
  },
  engineStats: async (engineName, sample = 10) => {
    const data = await gql(Q_ENGINE_STATS, { engineName, sample });
    if (!data || data.error) return data;
    return data.engineStats;
  },
  todayCosts: async () => {
    const data = await gql(Q_TODAY_COSTS);
    if (!data || data.error) return data;
    return data.engineTodayCosts;
  },
  leadFacets: async () => {
    const data = await gql(Q_LEAD_FACETS);
    if (!data || data.error) return data;
    return data.leadFacets;
  },
  listSavedViews: async () => {
    const data = await gql(Q_SAVED_VIEWS);
    if (!data || data.error) return data;
    return { views: data.savedViews };
  },

  // ── GraphQL-backed mutations ────────────────────────────────────────────
  resolveError: async (id) => {
    const data = await gql(M_RESOLVE_ERROR, { id });
    if (!data || data.error) return data;
    return { ok: !!data.resolveError };
  },
  replyAction: async (id, action) => {
    const data = await gql(M_REPLY_ACTION, { id, action });
    if (!data || data.error) return data;
    return { ok: !!data.actionReply };
  },
  replyReject: async (id) => {
    const data = await gql(M_REPLY_REJECT, { id });
    if (!data || data.error) return data;
    return { ok: !!data.rejectReply };
  },
  updateMailTester: async (score) => {
    const data = await gql(M_SET_MAIL_TESTER, { score: parseFloat(score) });
    if (!data || data.error) return data;
    return { ok: !!data.setMailTesterScore };
  },
  updateConfig: async (obj) => {
    const data = await gql(M_UPDATE_CONFIG, { updatesJson: JSON.stringify(obj || {}) });
    if (!data || data.error) return data;
    return { ok: !!data.updateConfig };
  },
  createNiche: async (input) => {
    const data = await gql(M_CREATE_NICHE, normalizeNicheInput(input));
    if (!data || data.error) return data;
    return { ok: true, data: data.createNiche };
  },
  updateNiche: async (id, input) => {
    const data = await gql(M_UPDATE_NICHE, { id, ...normalizeNicheInput(input) });
    if (!data || data.error) return data;
    return { ok: true, data: data.updateNiche };
  },
  deleteNiche: async (id) => {
    const data = await gql(M_DELETE_NICHE, { id });
    if (!data || data.error) return data;
    return { ok: !!data.deleteNiche };
  },
  updateOffer: async (input) => {
    const data = await gql(M_UPDATE_OFFER, snakeToCamelArgs(input, OFFER_ARG_KEYS));
    if (!data || data.error) return data;
    return { ok: true, data: data.updateOffer };
  },
  updateIcpProfile: async (input) => {
    const data = await gql(M_UPDATE_ICP, snakeToCamelArgs(input, ICP_ARG_KEYS));
    if (!data || data.error) return data;
    return { ok: true, data: data.updateIcpProfile };
  },
  saveGuardrails: async (name, payload) => {
    const data = await gql(M_SAVE_GUARDRAILS, {
      engineName: name,
      payloadJson: JSON.stringify(payload || {}),
    });
    if (!data || data.error) return data;
    let parsed = {};
    try { parsed = JSON.parse(data.updateEngineGuardrails); } catch { /* ignore */ }
    return { ok: true, data: parsed };
  },
  createSavedView: async (body) => {
    const vars = {
      name: body?.name,
      filtersJson: typeof body?.filters_json === 'string'
        ? body.filters_json
        : JSON.stringify(body?.filters_json ?? body?.filters ?? {}),
      sort: body?.sort ?? null,
    };
    const data = await gql(M_CREATE_SAVED_VIEW, vars);
    if (!data || data.error) return data;
    return { view: data.createSavedView };
  },
  updateSavedView: async (id, body) => {
    const vars = { id, name: body?.name ?? null, sort: body?.sort ?? null };
    if (body && Object.prototype.hasOwnProperty.call(body, 'filters_json')) {
      vars.filtersJson = typeof body.filters_json === 'string'
        ? body.filters_json
        : JSON.stringify(body.filters_json);
    } else if (body && Object.prototype.hasOwnProperty.call(body, 'filters')) {
      vars.filtersJson = JSON.stringify(body.filters);
    }
    const data = await gql(M_UPDATE_SAVED_VIEW, vars);
    if (!data || data.error) return data;
    return { view: data.updateSavedView };
  },
  deleteSavedView: async (id) => {
    const data = await gql(M_DELETE_SAVED_VIEW, { id });
    if (!data || data.error) return false;
    return !!data.deleteSavedView;
  },

  // ── REST holdouts ───────────────────────────────────────────────────────
  // Each line below stays on legacy REST. Reasons:
  //   leads / sendLog / leadKpis : take URL query strings; converting them
  //     needs a parser that turns `?status=ready&icp_priority=A,B` into the
  //     LeadFilter input shape — own design decision, separate PR.
  //   lead / patchLead / updateStatus / leadSignals : tightly coupled to
  //     the leads(qs) holdout above; ship together.
  //   runEngine / unlockEngine / engineStatus : changed semantics in the
  //     BullMQ cutover (enqueue returns jobId, not cronLogId; old polling
  //     contract breaks). Wait for the dashboard run-control redesign.
  //   exportLeadsCsv : streams a binary blob — doesn't fit GraphQL.
  //   bulkLeadStatus / bulkLeadRetryDryRun : functional via GraphQL but the
  //     dashboard's bulk-action UI is the riskiest single feature; own PR.
  leads:               (params = '') => request(`/leads${params}`),
  lead:                (id) => request(`/leads/${id}`),
  leadSignals:         (id) => request(`/leads/${id}/signals`),
  patchLead:           (id, body) => request(`/leads/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  updateStatus:        (id, status) => request(`/leads/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  sendLog:             (params = '') => request(`/send-log${params}`),
  leadKpis:            (params = '') => request(`/leads/kpis${params}`),
  bulkLeadStatus:      (body) => request('/leads/bulk/status', { method: 'POST', body: JSON.stringify(body) }),
  bulkLeadRetryDryRun: (body) => request('/leads/bulk/retry?dry_run=1', { method: 'POST', body: JSON.stringify(body) }),
  runEngine:           (engineName, override = {}) =>
    requestWithStatus(`/run-engine/${engineName}`, { method: 'POST', body: JSON.stringify(override) }),
  unlockEngine:        (engineName) =>
    requestWithStatus(`/run-engine/${engineName}/unlock`, { method: 'POST' }),
  engineStatus:        (cronLogId) => request(`/run-engine/status/${cronLogId}`),
  exportLeadsCsv:      (params, columns) => {
    const sep = params && params.includes('?') ? '&' : '?';
    const qs = (params || '') + sep + `columns=${columns}`;
    return fetch(`${BASE}/leads/export.csv${qs}`, { credentials: 'include' })
      .then(async (res) => {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `leads-${Date.now()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      });
  },
};

// ── Helpers ────────────────────────────────────────────────────────────────

// Legacy `errors(?source=foo&resolved=0&date_from=...)` parser. Mapped onto
// the GraphQL `errors(...)` query arg shape. Anything unknown is dropped.
function parseErrorsParams(params) {
  const out = {};
  if (!params) return out;
  const qs = params.startsWith('?') ? params.slice(1) : params;
  for (const pair of qs.split('&').filter(Boolean)) {
    const [rawK, rawV] = pair.split('=');
    if (!rawK) continue;
    const k = decodeURIComponent(rawK);
    const v = rawV !== undefined ? decodeURIComponent(rawV) : '';
    if (k === 'source') out.source = v;
    else if (k === 'error_type') out.errorType = v;
    else if (k === 'resolved') out.resolved = v === '1' || v === 'true';
    else if (k === 'date_from') out.dateFrom = v;
    else if (k === 'date_to') out.dateTo = v;
    // 'limit' is supported by the legacy endpoint but ignored by the
    // GraphQL resolver — drop silently rather than fail.
  }
  return out;
}

// Niche payloads come in as `{ label, query, day_of_week, enabled }`.
function normalizeNicheInput(input) {
  const out = {
    label: input?.label,
    query: input?.query,
    enabled: input?.enabled !== undefined ? !!input.enabled : true,
  };
  if (input && Object.prototype.hasOwnProperty.call(input, 'day_of_week')) {
    out.dayOfWeek = input.day_of_week;
  } else if (input && Object.prototype.hasOwnProperty.call(input, 'dayOfWeek')) {
    out.dayOfWeek = input.dayOfWeek;
  }
  return out;
}

// snake_case page payload → camelCase GraphQL variables. The keys that need
// rewriting are listed per-mutation; anything else passes through unchanged.
const OFFER_ARG_KEYS = {
  use_cases: 'useCases',
  price_range: 'priceRange',
  sales_cycle: 'salesCycle',
  inaction_cost: 'inactionCost',
  required_inputs: 'requiredInputs',
  proof_points: 'proofPoints',
};
const ICP_ARG_KEYS = {
  company_size: 'companySize',
  revenue_range: 'revenueRange',
  tech_stack: 'techStack',
  internal_capabilities: 'internalCapabilities',
  budget_range: 'budgetRange',
  problem_frequency: 'problemFrequency',
  problem_cost: 'problemCost',
  impacted_kpis: 'impactedKpis',
  initiator_roles: 'initiatorRoles',
  decision_roles: 'decisionRoles',
  buying_process: 'buyingProcess',
  intent_signals: 'intentSignals',
  current_tools: 'currentTools',
  switching_barriers: 'switchingBarriers',
  hard_disqualifiers: 'hardDisqualifiers',
};
function snakeToCamelArgs(input, map) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const [k, v] of Object.entries(input)) {
    out[map[k] ?? k] = v;
  }
  return out;
}
