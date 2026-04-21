import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { truncateAll, closeTestPrisma, getTestPrisma } from '../helpers/testDb.js';

beforeEach(async () => {
  await truncateAll();
  const { resetDb } = await import('../../src/core/db/index.js');
  await resetDb();
});

afterAll(async () => { await closeTestPrisma(); });

const baseLead = {
  business_name: 'Acme', website_url: 'https://x.com', category: 'restaurant', city: 'Mumbai',
  tech_stack: ['WordPress'], website_problems: ['no SSL'],
  last_updated: '2022', has_ssl: 0, has_analytics: 0,
  owner_name: 'John', owner_role: 'Founder',
  business_signals: ['low reviews'], social_active: 1,
  website_quality_score: 4, judge_reason: 'outdated',
  contact_email: 'j@x.com', contact_confidence: 'medium', contact_source: 'guess',
  email_status: 'valid',
  employees_estimate: '1-10', business_stage: 'owner-operated',
  icp_score: 75, icp_reason: 'good fit',
  icp_breakdown: { firmographic: 18, problem: 17, intent: 10, tech: 12, economic: 10, buying: 8 },
  icp_key_matches: ['restaurant match'],
  icp_key_gaps: ['budget unknown'],
  icp_disqualifiers: [],
  extractCost: 0.001, icpCost: 0.001,
};

describe('insertLead', () => {
  it('status=ready inserts all columns and sets email_verified_at', async () => {
    const { insertLead } = await import('../../src/engines/findLeads.js');
    await insertLead(baseLead, { query: 'q' }, 'ready');
    const prisma = getTestPrisma();
    const row = await prisma.lead.findFirst();
    expect(row.status).toBe('ready');
    expect(row.icpScore).toBe(75);
    expect(row.emailVerifiedAt).not.toBeNull();
    expect(row.icpBreakdown.firmographic).toBe(18);
  });

  it('status=nurture leaves email_verified_at NULL', async () => {
    const { insertLead } = await import('../../src/engines/findLeads.js');
    await insertLead({ ...baseLead, icp_score: 20 }, { query: 'q' }, 'nurture');
    const prisma = getTestPrisma();
    const row = await prisma.lead.findFirst();
    expect(row.status).toBe('nurture');
    expect(row.emailVerifiedAt).toBeNull();
  });

  it('status=disqualified stores disqualifiers JSON', async () => {
    const { insertLead } = await import('../../src/engines/findLeads.js');
    const lead = { ...baseLead, icp_disqualifiers: ['locked-in contract'] };
    await insertLead(lead, { query: 'q' }, 'disqualified');
    const prisma = getTestPrisma();
    const row = await prisma.lead.findFirst();
    expect(row.status).toBe('disqualified');
    expect(row.icpDisqualifiers).toEqual(['locked-in contract']);
    expect(row.emailVerifiedAt).toBeNull();
  });

  it('defaults missing optional fields to safe values', async () => {
    const { insertLead } = await import('../../src/engines/findLeads.js');
    const minimal = { ...baseLead };
    delete minimal.employees_estimate;
    delete minimal.business_stage;
    await insertLead(minimal, { query: 'q' }, 'nurture');
    const prisma = getTestPrisma();
    const row = await prisma.lead.findFirst();
    expect(row.employeesEstimate).toBe('unknown');
    expect(row.businessStage).toBe('unknown');
  });
});
