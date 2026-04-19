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

describe('GET/PUT /api/offer', () => {
  it('requires auth', async () => {
    const r = await fetch(`${baseUrl}/api/offer`);
    expect(r.status).toBe(401);
  });

  it('GET returns seeded row with nulls', async () => {
    const r = await fetch(`${baseUrl}/api/offer`, { headers: authHeaders() });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.offer).toBeTruthy();
    expect(body.offer.problem).toBeNull();
    expect(body.offer.use_cases).toEqual([]);
  });

  it('PUT persists offer and GET returns it', async () => {
    const offer = {
      problem: 'outdated websites',
      outcome: '2x conversion',
      category: 'web dev',
      use_cases: ['redesign', 'SEO'],
      triggers: ['Google penalty'],
      alternatives: ['freelancers'],
      differentiation: 'founder-built',
      price_range: '₹40k-2L',
      sales_cycle: '2-6 weeks',
      criticality: 'optional',
      inaction_cost: 'lost leads',
      required_inputs: ['existing hosting access'],
      proof_points: ['case studies']
    };
    const put = await fetch(`${baseUrl}/api/offer`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(offer) });
    expect(put.status).toBe(200);
    const get = await fetch(`${baseUrl}/api/offer`, { headers: authHeaders() });
    const body = await get.json();
    expect(body.offer.problem).toBe('outdated websites');
    expect(body.offer.use_cases).toEqual(['redesign', 'SEO']);
  });

  it('PUT rejects non-array where array expected', async () => {
    const r = await fetch(`${baseUrl}/api/offer`, {
      method: 'PUT', headers: authHeaders(),
      body: JSON.stringify({ problem: 'x', use_cases: 'not-an-array' })
    });
    expect(r.status).toBe(400);
  });

  it('PUT is full replacement, not patch', async () => {
    await fetch(`${baseUrl}/api/offer`, {
      method: 'PUT', headers: authHeaders(),
      body: JSON.stringify({ problem: 'first', use_cases: ['a'], triggers: [], alternatives: [], required_inputs: [], proof_points: [] })
    });
    await fetch(`${baseUrl}/api/offer`, {
      method: 'PUT', headers: authHeaders(),
      body: JSON.stringify({ problem: 'second', use_cases: [], triggers: [], alternatives: [], required_inputs: [], proof_points: [] })
    });
    const r = await fetch(`${baseUrl}/api/offer`, { headers: authHeaders() });
    const body = await r.json();
    expect(body.offer.problem).toBe('second');
    expect(body.offer.use_cases).toEqual([]);
  });
});
