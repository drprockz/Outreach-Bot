import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { truncateAll, closeTestPrisma } from '../helpers/testDb.js';

let server, baseUrl, token;

async function login() {
  const r = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'testpass' }),
  });
  return (await r.json()).token;
}
const h = () => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  process.env.DASHBOARD_PASSWORD = 'testpass';
  process.env.JWT_SECRET = 'testsecret64charslongpadded00000000000000000000000000000000000000';
  process.env.JWT_EXPIRES_IN = '7d';
  process.env.NODE_ENV = 'test';
  const mod = await import('../../src/api/server.js');
  server = mod.app.listen(0);
  baseUrl = `http://localhost:${server.address().port}`;
});

beforeEach(async () => {
  await truncateAll();
  const { resetDb, seedConfigDefaults, seedNichesAndDefaults, prisma } = await import('../../src/core/db/index.js');
  await resetDb();
  await seedConfigDefaults();
  await seedNichesAndDefaults();
  await prisma.lead.createMany({ data: [
    { businessName: 'Alpha', status: 'ready',   icpScore: 80, city: 'Mumbai',    category: 'd2c' },
    { businessName: 'Beta',  status: 'queued',  icpScore: 50, city: 'Bangalore', category: 'd2c' },
    { businessName: 'Gamma', status: 'nurture', icpScore: 30, city: 'Mumbai',    category: 'real_estate' },
    { businessName: 'Delta', status: 'ready',   icpScore: 75, city: 'Mumbai',    category: 'real_estate', dmLinkedinUrl: 'https://li/x' },
  ] });
  // Reset the in-process facets cache so each test sees fresh distinct values.
  const { _resetFacetsCacheForTests } = await import('../../src/api/routes/leads.js');
  _resetFacetsCacheForTests?.();
  token = await login();
});

afterAll(async () => { server.close(); await closeTestPrisma(); });

describe('GET /api/leads — extended filters', () => {
  it('multi-value status', async () => {
    const r = await fetch(`${baseUrl}/api/leads?status=ready&status=queued`, { headers: h() });
    const d = await r.json();
    expect(d.total).toBe(3);
  });

  it('icp_priority A returns score >= 70', async () => {
    const r = await fetch(`${baseUrl}/api/leads?icp_priority=A`, { headers: h() });
    const d = await r.json();
    expect(d.leads.map(l => l.business_name).sort()).toEqual(['Alpha', 'Delta']);
  });

  it('search matches business_name case-insensitive', async () => {
    const r = await fetch(`${baseUrl}/api/leads?search=alp`, { headers: h() });
    const d = await r.json();
    expect(d.total).toBe(1);
    expect(d.leads[0].business_name).toBe('Alpha');
  });

  it('has_linkedin_dm filter', async () => {
    const r = await fetch(`${baseUrl}/api/leads?has_linkedin_dm=1`, { headers: h() });
    const d = await r.json();
    expect(d.total).toBe(1);
    expect(d.leads[0].business_name).toBe('Delta');
  });

  it('sort=icp_score:asc orders ascending', async () => {
    const r = await fetch(`${baseUrl}/api/leads?sort=icp_score:asc`, { headers: h() });
    const d = await r.json();
    expect(d.leads[0].business_name).toBe('Gamma');
  });

  it('default sort is icp_score:desc', async () => {
    const r = await fetch(`${baseUrl}/api/leads`, { headers: h() });
    const d = await r.json();
    expect(d.leads[0].business_name).toBe('Alpha');
  });
});

describe('GET /api/leads — signal filters', () => {
  it('has_signals=1 returns leads with at least one signal', async () => {
    const { prisma } = await import('../../src/core/db/index.js');
    const lead = await prisma.lead.findFirst({ where: { businessName: 'Alpha' } });
    await prisma.leadSignal.create({ data: {
      leadId: lead.id, source: 'rss', signalType: 'hiring', headline: 'h',
      confidence: 0.8, signalDate: new Date(),
    }});
    const r = await fetch(`${baseUrl}/api/leads?has_signals=1`, { headers: h() });
    const d = await r.json();
    expect(d.total).toBe(1);
    expect(d.leads[0].business_name).toBe('Alpha');
  });

  it('signal_type=funding filters via join', async () => {
    const { prisma } = await import('../../src/core/db/index.js');
    const a = await prisma.lead.findFirst({ where: { businessName: 'Alpha' } });
    const b = await prisma.lead.findFirst({ where: { businessName: 'Beta' } });
    await prisma.leadSignal.createMany({ data: [
      { leadId: a.id, source: 'rss', signalType: 'hiring',  headline: 'h', confidence: 0.8, signalDate: new Date() },
      { leadId: b.id, source: 'rss', signalType: 'funding', headline: 'f', confidence: 0.9, signalDate: new Date() },
    ]});
    const r = await fetch(`${baseUrl}/api/leads?signal_type=funding`, { headers: h() });
    const d = await r.json();
    expect(d.total).toBe(1);
    expect(d.leads[0].business_name).toBe('Beta');
  });

  it('min_signal_count=2 filters leads with at least N signals', async () => {
    const { prisma } = await import('../../src/core/db/index.js');
    const a = await prisma.lead.findFirst({ where: { businessName: 'Alpha' } });
    await prisma.leadSignal.createMany({ data: [
      { leadId: a.id, source: 'rss', signalType: 'hiring',  headline: 'h1', confidence: 0.8, signalDate: new Date() },
      { leadId: a.id, source: 'rss', signalType: 'hiring',  headline: 'h2', confidence: 0.7, signalDate: new Date(), url: 'https://x.test/2' },
    ]});
    const r = await fetch(`${baseUrl}/api/leads?has_signals=1&min_signal_count=2`, { headers: h() });
    const d = await r.json();
    expect(d.total).toBe(1);
  });
});

describe('GET /api/leads — JSONB array filters', () => {
  it('tech_stack any-of using JSONB ?| operator', async () => {
    const { prisma } = await import('../../src/core/db/index.js');
    const alpha = await prisma.lead.findFirst({ where: { businessName: 'Alpha' } });
    const beta  = await prisma.lead.findFirst({ where: { businessName: 'Beta' } });
    await prisma.lead.update({ where: { id: alpha.id }, data: { techStack: ['WordPress', 'PHP'] } });
    await prisma.lead.update({ where: { id: beta.id  }, data: { techStack: ['Next.js'] } });
    const r = await fetch(`${baseUrl}/api/leads?tech_stack=WordPress&tech_stack=Shopify`, { headers: h() });
    const d = await r.json();
    expect(d.leads.map(l => l.business_name)).toEqual(['Alpha']);
  });

  it('business_signals any-of using JSONB ?| operator', async () => {
    const { prisma } = await import('../../src/core/db/index.js');
    const alpha = await prisma.lead.findFirst({ where: { businessName: 'Alpha' } });
    await prisma.lead.update({ where: { id: alpha.id }, data: { businessSignals: ['low reviews', 'dated design'] } });
    const r = await fetch(`${baseUrl}/api/leads?business_signals=low%20reviews`, { headers: h() });
    const d = await r.json();
    expect(d.leads.map(l => l.business_name)).toContain('Alpha');
  });
});

describe('GET /api/leads/facets', () => {
  it('returns distinct categories/cities/countries', async () => {
    const r = await fetch(`${baseUrl}/api/leads/facets`, { headers: h() });
    expect(r.status).toBe(200);
    const d = await r.json();
    expect(d.categories).toEqual(expect.arrayContaining(['d2c', 'real_estate']));
    expect(d.cities).toEqual(expect.arrayContaining(['Mumbai', 'Bangalore']));
    // country defaults to 'IN' for the seeded leads (per Prisma schema default)
    expect(Array.isArray(d.countries)).toBe(true);
  });
});
