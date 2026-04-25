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
  // 4 leads — same fixture as leads.filters.test.js
  await prisma.lead.createMany({ data: [
    { businessName: 'Alpha', status: 'ready',   icpScore: 80, city: 'Mumbai',    category: 'd2c' },
    { businessName: 'Beta',  status: 'queued',  icpScore: 50, city: 'Bangalore', category: 'd2c' },
    { businessName: 'Gamma', status: 'nurture', icpScore: 30, city: 'Mumbai',    category: 'real_estate' },
    { businessName: 'Delta', status: 'ready',   icpScore: 75, city: 'Mumbai',    category: 'real_estate' },
  ] });
  // signal in last 7d on Alpha
  const alpha = await prisma.lead.findFirst({ where: { businessName: 'Alpha' } });
  await prisma.leadSignal.create({ data: {
    leadId: alpha.id, source: 'rss', signalType: 'hiring', headline: 'h',
    confidence: 0.8, signalDate: new Date(),
  }});
  // unactioned reply
  await prisma.reply.create({ data: { leadId: alpha.id, rawText: 'hi', actionedAt: null, receivedAt: new Date() } });
  token = await login();
});

afterAll(async () => { server.close(); await closeTestPrisma(); });

describe('GET /api/leads/kpis', () => {
  it('returns global + filter-scoped counters', async () => {
    const r = await fetch(`${baseUrl}/api/leads/kpis?status=ready`, { headers: h() });
    expect(r.status).toBe(200);
    const d = await r.json();
    expect(d.global).toMatchObject({
      total: 4,
      readyToSend: 2,
      icpA: 2, icpB: 1, icpC: 1,
      signals7d: 1,
      repliesAwaitingTriage: 1,
    });
    expect(d.inFilter).toMatchObject({
      total: 2, readyToSend: 2, icpA: 2, icpB: 0, icpC: 0,
    });
  });

  it('global tile when no filter applied', async () => {
    const r = await fetch(`${baseUrl}/api/leads/kpis`, { headers: h() });
    const d = await r.json();
    expect(d.global.total).toBe(4);
    // inFilter should equal global when no filter is active (parser still applies in_reject_list=false default — that excludes nothing because all leads have in_reject_list=false)
    expect(d.inFilter.total).toBe(4);
  });
});
