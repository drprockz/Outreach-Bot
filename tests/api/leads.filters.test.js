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
