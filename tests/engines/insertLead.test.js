import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let tmpDir;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'radar-test-'));
  process.env.DB_PATH = join(tmpDir, 'radar.sqlite');
  const { resetDb, initSchema } = await import('../../src/core/db/index.js');
  resetDb();
  initSchema();
});

afterEach(async () => {
  const { resetDb } = await import('../../src/core/db/index.js');
  resetDb();
  rmSync(tmpDir, { recursive: true });
});

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
  icp_score: 75, icp_priority: 'A', icp_reason: 'good fit',
  icp_breakdown: { firmographic: 18, problem: 17, intent: 10, tech: 12, economic: 10, buying: 8 },
  icp_key_matches: ['restaurant match'],
  icp_key_gaps: ['budget unknown'],
  icp_disqualifiers: [],
  extractCost: 0.001, icpCost: 0.001,
};

describe('insertLead', () => {
  it('status=ready inserts all columns and sets email_verified_at', async () => {
    const { insertLead } = await import('../../src/engines/findLeads.js');
    const { getDb } = await import('../../src/core/db/index.js');
    const db = getDb();
    insertLead(db, baseLead, { query: 'q' }, 'ready');
    const row = db.prepare('SELECT * FROM leads').get();
    expect(row.status).toBe('ready');
    expect(row.icp_score).toBe(75);
    expect(row.email_verified_at).not.toBeNull();
    expect(JSON.parse(row.icp_breakdown).firmographic).toBe(18);
  });

  it('status=nurture leaves email_verified_at NULL', async () => {
    const { insertLead } = await import('../../src/engines/findLeads.js');
    const { getDb } = await import('../../src/core/db/index.js');
    const db = getDb();
    insertLead(db, { ...baseLead, icp_priority: 'C', icp_score: 20 }, { query: 'q' }, 'nurture');
    const row = db.prepare('SELECT * FROM leads').get();
    expect(row.status).toBe('nurture');
    expect(row.email_verified_at).toBeNull();
  });

  it('status=disqualified stores disqualifiers JSON', async () => {
    const { insertLead } = await import('../../src/engines/findLeads.js');
    const { getDb } = await import('../../src/core/db/index.js');
    const db = getDb();
    const lead = { ...baseLead, icp_disqualifiers: ['locked-in contract'] };
    insertLead(db, lead, { query: 'q' }, 'disqualified');
    const row = db.prepare('SELECT * FROM leads').get();
    expect(row.status).toBe('disqualified');
    expect(JSON.parse(row.icp_disqualifiers)).toEqual(['locked-in contract']);
    expect(row.email_verified_at).toBeNull();
  });

  it('defaults missing optional fields to safe values', async () => {
    const { insertLead } = await import('../../src/engines/findLeads.js');
    const { getDb } = await import('../../src/core/db/index.js');
    const db = getDb();
    const minimal = { ...baseLead };
    delete minimal.employees_estimate;
    delete minimal.business_stage;
    insertLead(db, minimal, { query: 'q' }, 'nurture');
    const row = db.prepare('SELECT * FROM leads').get();
    expect(row.employees_estimate).toBe('unknown');
    expect(row.business_stage).toBe('unknown');
  });
});
