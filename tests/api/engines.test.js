import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { truncateAll, closeTestPrisma, getTestPrisma } from '../helpers/testDb.js';

let server, baseUrl, token;

async function getToken() {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'testpass' }),
  });
  return (await res.json()).token;
}

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
  const { resetDb, seedConfigDefaults } = await import('../../src/core/db/index.js');
  await resetDb();
  await seedConfigDefaults();
  token = await getToken();
});

afterAll(async () => {
  if (server) server.close();
  const { resetDb } = await import('../../src/core/db/index.js');
  await resetDb();
  await closeTestPrisma();
});

const authHeader = () => ({ Authorization: `Bearer ${token}` });
const EXPECTED_ENGINES = ['findLeads', 'sendEmails', 'checkReplies', 'sendFollowups', 'healthCheck', 'dailyReport'];

describe('GET /api/engines', () => {
  it('returns items for all 6 engines', async () => {
    const res = await fetch(`${baseUrl}/api/engines`, { headers: authHeader() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(6);
    const names = body.items.map(i => i.name);
    expect(names).toEqual(expect.arrayContaining(EXPECTED_ENGINES));
  });

  it('each item carries enabled, lastRun, schedule, costToday', async () => {
    const res = await fetch(`${baseUrl}/api/engines`, { headers: authHeader() });
    const body = await res.json();
    for (const item of body.items) {
      expect(item).toHaveProperty('enabled');
      expect(item).toHaveProperty('lastRun');
      expect(item).toHaveProperty('schedule');
      expect(item).toHaveProperty('costToday');
    }
  });

  it('reflects enabled=false when the config flag is "0"', async () => {
    const prisma = getTestPrisma();
    await prisma.config.update({ where: { key: 'find_leads_enabled' }, data: { value: '0' } });
    const res = await fetch(`${baseUrl}/api/engines`, { headers: authHeader() });
    const body = await res.json();
    const findLeads = body.items.find(i => i.name === 'findLeads');
    expect(findLeads.enabled).toBe(false);
  });

  it('engines without an enabled flag are always enabled=true', async () => {
    const res = await fetch(`${baseUrl}/api/engines`, { headers: authHeader() });
    const body = await res.json();
    expect(body.items.find(i => i.name === 'healthCheck').enabled).toBe(true);
    expect(body.items.find(i => i.name === 'dailyReport').enabled).toBe(true);
  });

  it('lastRun is populated from the most recent cron_log entry', async () => {
    const prisma = getTestPrisma();
    const now = new Date();
    await prisma.cronLog.create({
      data: {
        jobName: 'findLeads', scheduledAt: now, startedAt: now, completedAt: now,
        durationMs: 1234, status: 'success', recordsProcessed: 42, costUsd: 0.12,
      },
    });
    const res = await fetch(`${baseUrl}/api/engines`, { headers: authHeader() });
    const body = await res.json();
    const findLeads = body.items.find(i => i.name === 'findLeads');
    expect(findLeads.lastRun).not.toBeNull();
    expect(findLeads.lastRun.status).toBe('success');
    expect(findLeads.lastRun.primaryCount).toBe(42);
    expect(findLeads.lastRun.durationMs).toBe(1234);
  });

  it('guardrails sub-route still works (mount order preserved)', async () => {
    const res = await fetch(`${baseUrl}/api/engines/sendEmails/guardrails`, { headers: authHeader() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('email_min_words');
  });
});
