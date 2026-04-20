import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { truncateAll, closeTestPrisma } from '../helpers/testDb.js';

let server, baseUrl, token;

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
  const { resetDb, seedConfigDefaults, seedNichesAndIcpRules } = await import('../../src/core/db/index.js');
  await resetDb();
  await seedConfigDefaults();
  await seedNichesAndIcpRules();

  const r = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'testpass' })
  });
  token = (await r.json()).token;
});

afterAll(async () => {
  if (server) server.close();
  const { resetDb } = await import('../../src/core/db/index.js');
  await resetDb();
  await closeTestPrisma();
});

const authHeaders = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` });

describe('GET/PUT /api/icp-profile', () => {
  it('requires auth', async () => {
    const r = await fetch(`${baseUrl}/api/icp-profile`);
    expect(r.status).toBe(401);
  });

  it('GET returns seeded row with empty arrays', async () => {
    const r = await fetch(`${baseUrl}/api/icp-profile`, { headers: authHeaders() });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.profile).toBeTruthy();
    expect(body.profile.industries).toEqual([]);
    expect(body.profile.company_size).toBeNull();
  });

  it('PUT persists profile and GET returns it', async () => {
    const profile = {
      industries: ['restaurants', 'salons'],
      company_size: '5-20',
      revenue_range: '₹1-5Cr',
      geography: ['Mumbai', 'Pune'],
      stage: ['growth'],
      tech_stack: ['WordPress'],
      internal_capabilities: ['basic marketing'],
      budget_range: '₹40k-2L',
      problem_frequency: 'weekly',
      problem_cost: 'high',
      impacted_kpis: ['conversion rate'],
      initiator_roles: ['marketing head'],
      decision_roles: ['founder'],
      objections: ['budget'],
      buying_process: 'single decision maker',
      intent_signals: ['slow site'],
      current_tools: ['manual'],
      workarounds: ['freelancers'],
      frustrations: ['slow turnaround'],
      switching_barriers: ['data migration'],
      hard_disqualifiers: ['existing enterprise contract']
    };
    const put = await fetch(`${baseUrl}/api/icp-profile`, {
      method: 'PUT', headers: authHeaders(), body: JSON.stringify(profile)
    });
    expect(put.status).toBe(200);
    const get = await fetch(`${baseUrl}/api/icp-profile`, { headers: authHeaders() });
    const body = await get.json();
    expect(body.profile.industries).toEqual(['restaurants', 'salons']);
    expect(body.profile.company_size).toBe('5-20');
    expect(body.profile.geography).toEqual(['Mumbai', 'Pune']);
  });

  it('PUT rejects non-array where array expected', async () => {
    const r = await fetch(`${baseUrl}/api/icp-profile`, {
      method: 'PUT', headers: authHeaders(),
      body: JSON.stringify({ industries: 'not-array' })
    });
    expect(r.status).toBe(400);
  });

  it('PUT is full replacement, not patch', async () => {
    await fetch(`${baseUrl}/api/icp-profile`, {
      method: 'PUT', headers: authHeaders(),
      body: JSON.stringify({
        industries: ['a'], company_size: 'first',
        geography: [], stage: [], tech_stack: [], internal_capabilities: [],
        impacted_kpis: [], initiator_roles: [], decision_roles: [], objections: [],
        intent_signals: [], current_tools: [], workarounds: [], frustrations: [],
        switching_barriers: [], hard_disqualifiers: []
      })
    });
    await fetch(`${baseUrl}/api/icp-profile`, {
      method: 'PUT', headers: authHeaders(),
      body: JSON.stringify({
        industries: [], company_size: 'second',
        geography: [], stage: [], tech_stack: [], internal_capabilities: [],
        impacted_kpis: [], initiator_roles: [], decision_roles: [], objections: [],
        intent_signals: [], current_tools: [], workarounds: [], frustrations: [],
        switching_barriers: [], hard_disqualifiers: []
      })
    });
    const r = await fetch(`${baseUrl}/api/icp-profile`, { headers: authHeaders() });
    const body = await r.json();
    expect(body.profile.company_size).toBe('second');
    expect(body.profile.industries).toEqual([]);
  });
});
