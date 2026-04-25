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
const h = () => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });

beforeAll(async () => {
  process.env.DASHBOARD_PASSWORD = 'testpass';
  process.env.JWT_SECRET = 'testsecret64charslongpadded00000000000000000000000000000000000000';
  process.env.JWT_EXPIRES_IN = '7d';
  process.env.NODE_ENV = 'test';
  delete process.env.BULK_RETRY_ENABLED;
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
    { businessName: 'Alpha', status: 'ready', icpScore: 80, contactEmail: 'priya@alpha.test' },
  ] });
  token = await login();
});

afterAll(async () => { server.close(); await closeTestPrisma(); });

describe('POST /api/leads/bulk/retry?dry_run=1', () => {
  it('returns count + estimated cost without side effects', async () => {
    const { prisma } = await import('../../src/core/db/index.js');
    const a = await prisma.lead.findFirst({ where: { businessName: 'Alpha' } });
    await prisma.email.createMany({ data: [
      { leadId: a.id, sequenceStep: 0, hookCostUsd: 0.01, bodyCostUsd: 0.005 },
      { leadId: a.id, sequenceStep: 1, hookCostUsd: 0.02, bodyCostUsd: 0.006 },
    ] });
    const r = await fetch(`${baseUrl}/api/leads/bulk/retry?dry_run=1`, { method: 'POST', headers: h(),
      body: JSON.stringify({ leadIds: [a.id], stage: 'regen_hook' }) });
    expect(r.status).toBe(200);
    const d = await r.json();
    expect(d.count).toBe(1);
    expect(d.estimated_cost_usd).toBeGreaterThan(0);
    expect(d.estimate_quality).toBe('low'); // < 5 samples
    expect(d.breakdown_by_stage).toHaveProperty('regen_hook');
  });

  it('rejects invalid stage', async () => {
    const r = await fetch(`${baseUrl}/api/leads/bulk/retry?dry_run=1`, { method: 'POST', headers: h(),
      body: JSON.stringify({ leadIds: [1], stage: 'fly_to_moon' }) });
    expect(r.status).toBe(400);
  });

  it('rejects empty leadIds', async () => {
    const r = await fetch(`${baseUrl}/api/leads/bulk/retry?dry_run=1`, { method: 'POST', headers: h(),
      body: JSON.stringify({ leadIds: [], stage: 'regen_hook' }) });
    expect(r.status).toBe(400);
  });

  it('rejects batch > 25', async () => {
    const r = await fetch(`${baseUrl}/api/leads/bulk/retry?dry_run=1`, { method: 'POST', headers: h(),
      body: JSON.stringify({ leadIds: Array.from({ length: 26 }, (_, i) => i + 1), stage: 'regen_hook' }) });
    expect(r.status).toBe(400);
    const d = await r.json();
    expect(d.error).toBe('batch_too_large');
    expect(d.max).toBe(25);
  });

  it('returns 503 for real execution when BULK_RETRY_ENABLED is unset', async () => {
    delete process.env.BULK_RETRY_ENABLED;
    const r = await fetch(`${baseUrl}/api/leads/bulk/retry`, { method: 'POST', headers: h(),
      body: JSON.stringify({ leadIds: [1], stage: 'regen_hook' }) });
    expect(r.status).toBe(503);
  });
});
