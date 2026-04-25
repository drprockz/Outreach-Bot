import { describe, it, expect } from 'vitest';
import { parseLeadsQuery } from '../../../src/api/routes/leads/filterParser.js';

const T = { threshA: 70, threshB: 40 };

describe('parseLeadsQuery', () => {
  it('parses single-value status', () => {
    const out = parseLeadsQuery({ status: 'ready' }, T);
    expect(out.where.status).toBe('ready');
  });

  it('parses multi-value status', () => {
    const out = parseLeadsQuery({ status: ['ready', 'queued'] }, T);
    expect(out.where.status).toEqual({ in: ['ready', 'queued'] });
  });

  it('translates icp_priority A → score >= threshA', () => {
    const out = parseLeadsQuery({ icp_priority: 'A' }, T);
    expect(out.where.icpScore).toEqual({ gte: 70 });
  });

  it('translates icp_priority B → range [threshB, threshA)', () => {
    const out = parseLeadsQuery({ icp_priority: 'B' }, T);
    expect(out.where.icpScore).toEqual({ gte: 40, lt: 70 });
  });

  it('translates icp_priority C → score < threshB', () => {
    const out = parseLeadsQuery({ icp_priority: 'C' }, T);
    expect(out.where.icpScore).toEqual({ lt: 40 });
  });

  it('translates multi-priority to OR of ranges', () => {
    const out = parseLeadsQuery({ icp_priority: ['A', 'C'] }, T);
    expect(out.where.OR).toBeDefined();
    expect(out.where.OR.length).toBeGreaterThanOrEqual(2);
  });

  it('parses search across business_name / website_url / contact_email', () => {
    const out = parseLeadsQuery({ search: 'acme' }, T);
    expect(out.where.OR).toEqual([
      { businessName: { contains: 'acme', mode: 'insensitive' } },
      { websiteUrl:   { contains: 'acme', mode: 'insensitive' } },
      { contactEmail: { contains: 'acme', mode: 'insensitive' } },
    ]);
  });

  it('parses icp_score range', () => {
    const out = parseLeadsQuery({ icp_score_min: '50', icp_score_max: '90' }, T);
    expect(out.where.icpScore).toEqual({ gte: 50, lte: 90 });
  });

  it('parses has_linkedin_dm bool', () => {
    const out = parseLeadsQuery({ has_linkedin_dm: '1' }, T);
    expect(out.where.dmLinkedinUrl).toEqual({ not: null });
  });

  it('parses sort with allowlist', () => {
    expect(parseLeadsQuery({ sort: 'icp_score:desc' }, T).orderBy).toEqual([
      { icpScore: 'desc' }, { discoveredAt: 'desc' },
    ]);
  });

  it('falls back to default sort when invalid', () => {
    expect(parseLeadsQuery({ sort: 'malicious;drop' }, T).orderBy).toEqual([
      { icpScore: 'desc' }, { discoveredAt: 'desc' },
    ]);
  });

  it('hides reject_list rows by default', () => {
    const out = parseLeadsQuery({}, T);
    expect(out.where.inRejectList).toBe(false);
  });

  it('includes reject_list rows when in_reject_list=all', () => {
    const out = parseLeadsQuery({ in_reject_list: 'all' }, T);
    expect(out.where.inRejectList).toBeUndefined();
  });

  it('parses signal filters', () => {
    const out = parseLeadsQuery({ has_signals: '1', min_signal_count: '2', signal_type: ['hiring', 'funding'] }, T);
    expect(out.signalFilter).toMatchObject({ has: true, minCount: 2, types: ['hiring', 'funding'] });
  });

  it('signalFilter is empty when no signal params', () => {
    const out = parseLeadsQuery({ status: 'ready' }, T);
    expect(out.signalFilter).toEqual({});
  });
});
