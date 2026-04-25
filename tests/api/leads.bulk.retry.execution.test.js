import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import { truncateAll, closeTestPrisma } from '../helpers/testDb.js';

// Hoisted — before any imports that use this module.
vi.mock('../../src/core/pipeline/regenerateHook.js', () => ({
  regenerateHook: vi.fn(async () => ({ hook: 'NEW_HOOK', costUsd: 0.001, model: 'mock', hookVariantId: 'A' })),
}));

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
  process.env.BULK_RETRY_ENABLED = 'true';
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
  await prisma.lead.create({ data: {
    businessName: 'Alpha', status: 'ready', icpScore: 80, contactEmail: 'priya@alpha.test',
    websiteUrl: 'https://alpha.test',
  }});
  token = await login();
});

afterAll(async () => { server.close(); await closeTestPrisma(); delete process.env.BULK_RETRY_ENABLED; });

describe('POST /api/leads/bulk/retry — real execution (mocked pipeline)', () => {
  it('regen_hook: streams ok+done events and updates email row', async () => {
    const { prisma } = await import('../../src/core/db/index.js');
    const a = await prisma.lead.findFirst({ where: { businessName: 'Alpha' } });
    await prisma.email.create({ data: { leadId: a.id, sequenceStep: 0, status: 'pending' } });

    const r = await fetch(`${baseUrl}/api/leads/bulk/retry`, { method: 'POST', headers: h(),
      body: JSON.stringify({ leadIds: [a.id], stage: 'regen_hook' }) });
    const text = await r.text();
    expect(text).toContain('"status":"ok"');
    expect(text).toContain('"status":"done"');

    const email = await prisma.email.findFirst({ where: { leadId: a.id, sequenceStep: 0 } });
    expect(email.hook).toBe('NEW_HOOK');
  });

  it('regen_hook on lead with no pending email writes error event', async () => {
    const { prisma } = await import('../../src/core/db/index.js');
    const a = await prisma.lead.findFirst({ where: { businessName: 'Alpha' } });
    const r = await fetch(`${baseUrl}/api/leads/bulk/retry`, { method: 'POST', headers: h(),
      body: JSON.stringify({ leadIds: [a.id], stage: 'regen_hook' }) });
    const text = await r.text();
    expect(text).toContain('"status":"error"');
    expect(text).toContain('no_pending_email');
  });
});
