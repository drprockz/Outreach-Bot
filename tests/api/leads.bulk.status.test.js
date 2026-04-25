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
    { businessName: 'Alpha', status: 'ready',   icpScore: 80, contactEmail: 'priya@alpha.test' },
    { businessName: 'Beta',  status: 'queued',  icpScore: 50, contactEmail: 'bob@beta.test' },
    { businessName: 'Gamma', status: 'nurture', icpScore: 30, contactEmail: 'g@gamma.test' },
    { businessName: 'Delta', status: 'replied', icpScore: 75, contactEmail: 'd@delta.test' },
    { businessName: 'NoEmail', status: 'ready', icpScore: 80, contactEmail: null },
  ] });
  token = await login();
});

afterAll(async () => { server.close(); await closeTestPrisma(); });

describe('POST /api/leads/bulk/status', () => {
  it('rejects non-whitelisted action', async () => {
    const r = await fetch(`${baseUrl}/api/leads/bulk/status`, { method: 'POST', headers: h(),
      body: JSON.stringify({ leadIds: [1], action: 'sent' }) });
    expect(r.status).toBe(400);
  });

  it('rejects empty leadIds', async () => {
    const r = await fetch(`${baseUrl}/api/leads/bulk/status`, { method: 'POST', headers: h(),
      body: JSON.stringify({ leadIds: [], action: 'nurture' }) });
    expect(r.status).toBe(400);
  });

  it('rejects batch > 200', async () => {
    const r = await fetch(`${baseUrl}/api/leads/bulk/status`, { method: 'POST', headers: h(),
      body: JSON.stringify({ leadIds: Array.from({ length: 201 }, (_, i) => i + 1), action: 'nurture' }) });
    expect(r.status).toBe(400);
    const d = await r.json();
    expect(d.error).toBe('batch_too_large');
  });

  it('nurture: updates status', async () => {
    const { prisma } = await import('../../src/core/db/index.js');
    const a = await prisma.lead.findFirst({ where: { businessName: 'Alpha' } });
    const r = await fetch(`${baseUrl}/api/leads/bulk/status`, { method: 'POST', headers: h(),
      body: JSON.stringify({ leadIds: [a.id], action: 'nurture' }) });
    expect(r.status).toBe(200);
    const d = await r.json();
    expect(d.updated).toBe(1);
    const refreshed = await prisma.lead.findUnique({ where: { id: a.id } });
    expect(refreshed.status).toBe('nurture');
  });

  it('reject: inserts into reject_list + sets in_reject_list=true', async () => {
    const { prisma } = await import('../../src/core/db/index.js');
    const a = await prisma.lead.findFirst({ where: { businessName: 'Alpha' } });
    const r = await fetch(`${baseUrl}/api/leads/bulk/status`, { method: 'POST', headers: h(),
      body: JSON.stringify({ leadIds: [a.id], action: 'reject' }) });
    expect(r.status).toBe(200);
    const refreshed = await prisma.lead.findUnique({ where: { id: a.id } });
    expect(refreshed.inRejectList).toBe(true);
    expect(refreshed.status).toBe('unsubscribed');
    const reject = await prisma.rejectList.findFirst({ where: { email: 'priya@alpha.test' } });
    expect(reject).toBeTruthy();
    expect(reject.domain).toBe('alpha.test');
  });

  it('reject: skips lead with no contact email', async () => {
    const { prisma } = await import('../../src/core/db/index.js');
    const ne = await prisma.lead.findFirst({ where: { businessName: 'NoEmail' } });
    const r = await fetch(`${baseUrl}/api/leads/bulk/status`, { method: 'POST', headers: h(),
      body: JSON.stringify({ leadIds: [ne.id], action: 'reject' }) });
    const d = await r.json();
    expect(d.skipped).toContainEqual({ id: ne.id, reason: 'no_email' });
    const refreshed = await prisma.lead.findUnique({ where: { id: ne.id } });
    expect(refreshed.inRejectList).toBe(false);
  });

  it('skips terminal status (replied)', async () => {
    const { prisma } = await import('../../src/core/db/index.js');
    const d = await prisma.lead.findFirst({ where: { businessName: 'Delta' } });
    const r = await fetch(`${baseUrl}/api/leads/bulk/status`, { method: 'POST', headers: h(),
      body: JSON.stringify({ leadIds: [d.id], action: 'nurture' }) });
    const body = await r.json();
    expect(body.skipped).toContainEqual({ id: d.id, reason: 'terminal_replied' });
  });

  it('requeue: skips leads with no pending step-0 email', async () => {
    const { prisma } = await import('../../src/core/db/index.js');
    const a = await prisma.lead.findFirst({ where: { businessName: 'Alpha' } });
    const r = await fetch(`${baseUrl}/api/leads/bulk/status`, { method: 'POST', headers: h(),
      body: JSON.stringify({ leadIds: [a.id], action: 'requeue' }) });
    const d = await r.json();
    expect(d.skipped).toContainEqual({ id: a.id, reason: 'no_pending_email' });
  });

  it('requeue: succeeds when pending email row exists', async () => {
    const { prisma } = await import('../../src/core/db/index.js');
    const a = await prisma.lead.findFirst({ where: { businessName: 'Alpha' } });
    await prisma.email.create({ data: { leadId: a.id, sequenceStep: 0, status: 'pending' } });
    const r = await fetch(`${baseUrl}/api/leads/bulk/status`, { method: 'POST', headers: h(),
      body: JSON.stringify({ leadIds: [a.id], action: 'requeue' }) });
    expect((await r.json()).updated).toBe(1);
    const refreshed = await prisma.lead.findUnique({ where: { id: a.id } });
    expect(refreshed.status).toBe('ready');
  });

  it('requeue: ICP-C lead is rejected with icp_c_cannot_queue', async () => {
    const { prisma } = await import('../../src/core/db/index.js');
    const g = await prisma.lead.findFirst({ where: { businessName: 'Gamma' } }); // icpScore 30 → C bucket
    await prisma.email.create({ data: { leadId: g.id, sequenceStep: 0, status: 'pending' } });
    const r = await fetch(`${baseUrl}/api/leads/bulk/status`, { method: 'POST', headers: h(),
      body: JSON.stringify({ leadIds: [g.id], action: 'requeue' }) });
    const d = await r.json();
    expect(d.skipped).toContainEqual({ id: g.id, reason: 'icp_c_cannot_queue' });
  });
});
