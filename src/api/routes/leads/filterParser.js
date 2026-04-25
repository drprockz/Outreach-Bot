const SORT_ALLOWLIST = {
  icp_score: 'icpScore',
  website_quality_score: 'websiteQualityScore',
  signal_count: '__signalCount',
  discovered_at: 'discoveredAt',
  domain_last_contacted: 'domainLastContacted',
};

function asArray(v) { return v == null ? [] : Array.isArray(v) ? v : [v]; }

function priorityToRange(p, t) {
  if (p === 'A') return { gte: t.threshA };
  if (p === 'B') return { gte: t.threshB, lt: t.threshA };
  if (p === 'C') return { lt: t.threshB };
  return null;
}

function parseSort(s) {
  const fallback = [{ icpScore: 'desc' }, { discoveredAt: 'desc' }];
  if (!s || typeof s !== 'string') return fallback;
  const [field, dir] = s.split(':');
  if (!SORT_ALLOWLIST[field] || !['asc', 'desc'].includes(dir)) return fallback;
  if (SORT_ALLOWLIST[field] === '__signalCount') return fallback; // deferred
  return [{ [SORT_ALLOWLIST[field]]: dir }, { discoveredAt: 'desc' }];
}

export function parseLeadsQuery(q, thresholds) {
  const where = {};

  // single/multi-value enums
  for (const [qkey, dbkey] of [
    ['status', 'status'], ['category', 'category'], ['city', 'city'],
    ['country', 'country'], ['email_status', 'emailStatus'],
    ['business_stage', 'businessStage'], ['employees_estimate', 'employeesEstimate'],
  ]) {
    const arr = asArray(q[qkey]);
    if (arr.length === 1) where[dbkey] = arr[0];
    else if (arr.length > 1) where[dbkey] = { in: arr };
  }

  // search → push as one AND clause to avoid OR collision with other multi-value filters
  if (q.search) {
    where.AND = (where.AND || []).concat([{
      OR: [
        { businessName: { contains: q.search, mode: 'insensitive' } },
        { websiteUrl:   { contains: q.search, mode: 'insensitive' } },
        { contactEmail: { contains: q.search, mode: 'insensitive' } },
      ],
    }]);
  }

  // icp_priority — single value sets icpScore directly; multi value goes into a separate AND clause
  const priorities = asArray(q.icp_priority);
  if (priorities.length === 1) {
    const r = priorityToRange(priorities[0], thresholds);
    if (r) where.icpScore = r;
  } else if (priorities.length > 1) {
    const ors = priorities
      .map(p => priorityToRange(p, thresholds))
      .filter(Boolean)
      .map(r => ({ icpScore: r }));
    if (ors.length) where.AND = (where.AND || []).concat([{ OR: ors }]);
  }

  // icp_score range
  if (q.icp_score_min || q.icp_score_max) {
    where.icpScore = where.icpScore || {};
    if (q.icp_score_min) where.icpScore.gte = Number(q.icp_score_min);
    if (q.icp_score_max) where.icpScore.lte = Number(q.icp_score_max);
  }

  // quality_score range
  if (q.quality_score_min || q.quality_score_max) {
    where.websiteQualityScore = {};
    if (q.quality_score_min) where.websiteQualityScore.gte = Number(q.quality_score_min);
    if (q.quality_score_max) where.websiteQualityScore.lte = Number(q.quality_score_max);
  }

  // has_linkedin_dm
  if (q.has_linkedin_dm === '1' || q.has_linkedin_dm === 'true') {
    where.dmLinkedinUrl = { not: null };
  }

  // in_reject_list — default hidden
  if (q.in_reject_list === '1' || q.in_reject_list === 'true') {
    where.inRejectList = true;
  } else if (q.in_reject_list !== 'all') {
    where.inRejectList = false;
  }

  // discovered date range
  if (q.date_from || q.date_to) {
    where.discoveredAt = {};
    if (q.date_from) where.discoveredAt.gte = new Date(q.date_from);
    if (q.date_to) where.discoveredAt.lte = new Date(q.date_to);
  }

  // signal filters — surfaced separately because they require a sub-query
  // against lead_signals, AND-ed with `where` at route handler level.
  const signalFilter = {};
  if (q.has_signals === '1' || q.has_signals === 'true') signalFilter.has = true;
  if (q.min_signal_count) signalFilter.minCount = Number(q.min_signal_count);
  const sigTypes = asArray(q.signal_type);
  if (sigTypes.length) signalFilter.types = sigTypes;
  if (q.signal_date_from) signalFilter.from = new Date(q.signal_date_from);
  if (q.signal_date_to)   signalFilter.to   = new Date(q.signal_date_to);

  return { where, orderBy: parseSort(q.sort), signalFilter };
}
