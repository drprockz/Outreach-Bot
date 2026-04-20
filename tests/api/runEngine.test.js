import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import { truncateAll, closeTestPrisma, getTestPrisma } from '../helpers/testDb.js';

// Stub findLeads so the route's kickoff doesn't hit real Gemini.
// The stub writes a cron_log row the route can find (mimicking the real engine).
vi.mock('../../src/engines/findLeads.js', () => ({
  default: vi.fn(async (override) => {
    const { logCron, finishCron } = await import('../../src/core/db/index.js');
    const id = await logCron('findLeads');
    // Yield to the event loop so the route's 150ms poll can see status='running'
    await new Promise(r => setTimeout(r, 50));
    await finishCron(id, {
      status: 'success',
      recordsProcessed: override?.leadsCount || 0,
      recordsSkipped: 0,
      costUsd: 0.001,
    });
  }),
}));

async function getToken(baseUrl) {
  const r = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'testpass' }),
  });
  return (await r.json()).token;
}

let server, baseUrl, token;

beforeAll(async () => {
  process.env.DASHBOARD_PASSWORD = 'testpass';
  process.env.JWT_SECRET = 'testsecret64charslongpadded00000000000000000000000000000000000000';
  process.env.JWT_EXPIRES_IN = '7d';
  process.env.NODE_ENV = 'test';

  const mod = await import('../../src/api/server.js');
  server = mod.app.listen(0);
  baseUrl = `http://localhost:${server.address().port}`;
  token = await getToken(baseUrl);
});

beforeEach(async () => {
  await truncateAll();
  const { resetDb } = await import('../../src/core/db/index.js');
  await resetDb();
});

afterAll(async () => {
  if (server) server.close();
  const { resetDb } = await import('../../src/core/db/index.js');
  await resetDb();
  await closeTestPrisma();
});

const authHeaders = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` });

describe('POST /api/run-engine/:engineName', () => {
  it('requires auth', async () => {
    const r = await fetch(`${baseUrl}/api/run-engine/findLeads`, { method: 'POST' });
    expect(r.status).toBe(401);
  });

  it('rejects unknown engine with 404', async () => {
    const r = await fetch(`${baseUrl}/api/run-engine/nonesuch`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify({}),
    });
    expect(r.status).toBe(404);
  });

  it('kicks off findLeads and returns cronLogId', async () => {
    const r = await fetch(`${baseUrl}/api/run-engine/findLeads`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify({ leadsCount: 3 }),
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.engineName).toBe('findLeads');
    expect(body.cronLogId).toBeTruthy();
    expect(body.override).toEqual({ leadsCount: 3 });
  });

  it('refuses concurrent runs with 409', async () => {
    // Override findLeads mock to hang (simulate long-running engine)
    const findLeadsMod = await import('../../src/engines/findLeads.js');
    findLeadsMod.default.mockImplementationOnce(async () => {
      const { logCron } = await import('../../src/core/db/index.js');
      await logCron('findLeads');
      // Don't finish — leave status='running'
      await new Promise(r => setTimeout(r, 500));
    });

    const first = await fetch(`${baseUrl}/api/run-engine/findLeads`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify({ leadsCount: 1 }),
    });
    expect(first.status).toBe(200);

    // Immediately try second — should 409
    const second = await fetch(`${baseUrl}/api/run-engine/findLeads`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify({ leadsCount: 1 }),
    });
    expect(second.status).toBe(409);
    const body = await second.json();
    expect(body.error).toMatch(/already running/);
    expect(body.runningCronLogId).toBeTruthy();
  });

  it('strips non-whitelisted override keys', async () => {
    const r = await fetch(`${baseUrl}/api/run-engine/findLeads`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ leadsCount: 2, evil: 'xxx', anotherBad: 999 }),
    });
    const body = await r.json();
    expect(body.override).toEqual({ leadsCount: 2 });
    expect(body.override.evil).toBeUndefined();
  });

  it('ignores non-numeric or negative override values', async () => {
    const r = await fetch(`${baseUrl}/api/run-engine/findLeads`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ leadsCount: -1, perBatch: 'banana' }),
    });
    const body = await r.json();
    expect(body.override).toEqual({});
  });
});

describe('GET /api/run-engine/status/:cronLogId', () => {
  it('requires auth', async () => {
    const r = await fetch(`${baseUrl}/api/run-engine/status/1`);
    expect(r.status).toBe(401);
  });

  it('returns 404 for unknown cronLogId', async () => {
    const r = await fetch(`${baseUrl}/api/run-engine/status/99999`, { headers: authHeaders() });
    expect(r.status).toBe(404);
  });

  it('returns cron_log + today_costs for an existing run', async () => {
    // Seed a cron_log row + daily_metrics row
    const prisma = getTestPrisma();
    const log = await prisma.cronLog.create({
      data: {
        jobName: 'findLeads',
        status: 'success',
        startedAt: new Date(Date.now() - 5000),
        completedAt: new Date(),
        durationMs: 5000,
        recordsProcessed: 3,
        recordsSkipped: 0,
        costUsd: 0.005,
      },
    });
    const d = new Date().toISOString().slice(0, 10);
    await prisma.dailyMetrics.upsert({
      where: { date: d },
      create: { date: d, leadsDiscovered: 3, leadsReady: 2, geminiCostUsd: 0.003, totalApiCostUsd: 0.005 },
      update: { leadsDiscovered: 3, leadsReady: 2, geminiCostUsd: 0.003, totalApiCostUsd: 0.005 },
    });

    const r = await fetch(`${baseUrl}/api/run-engine/status/${log.id}`, { headers: authHeaders() });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.cron_log.status).toBe('success');
    expect(body.cron_log.records_processed).toBe(3);
    expect(body.cron_log.cost_usd).toBeCloseTo(0.005);
    expect(body.today_costs.leads_discovered).toBe(3);
    expect(body.today_costs.total_api_cost_usd).toBeCloseTo(0.005);
  });

  it('handles missing daily_metrics gracefully (returns null)', async () => {
    const prisma = getTestPrisma();
    const log = await prisma.cronLog.create({
      data: { jobName: 'findLeads', status: 'running', startedAt: new Date() },
    });
    // No daily_metrics row
    const r = await fetch(`${baseUrl}/api/run-engine/status/${log.id}`, { headers: authHeaders() });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.cron_log.status).toBe('running');
    expect(body.today_costs).toBeNull();
  });
});

describe('GET /api/run-engine/today-costs', () => {
  it('requires auth', async () => {
    const r = await fetch(`${baseUrl}/api/run-engine/today-costs`);
    expect(r.status).toBe(401);
  });

  it('returns zeros when no daily_metrics row exists', async () => {
    const r = await fetch(`${baseUrl}/api/run-engine/today-costs`, { headers: authHeaders() });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.total_api_cost_usd).toBe(0);
    expect(body.leads_ready).toBe(0);
  });

  it('returns live totals', async () => {
    const prisma = getTestPrisma();
    const d = new Date().toISOString().slice(0, 10);
    await prisma.dailyMetrics.upsert({
      where: { date: d },
      create: { date: d, geminiCostUsd: 0.01, haikuCostUsd: 0.02, totalApiCostUsd: 0.03, leadsReady: 5 },
      update: { geminiCostUsd: 0.01, haikuCostUsd: 0.02, totalApiCostUsd: 0.03, leadsReady: 5 },
    });
    const r = await fetch(`${baseUrl}/api/run-engine/today-costs`, { headers: authHeaders() });
    const body = await r.json();
    expect(body.gemini_cost_usd).toBeCloseTo(0.01);
    expect(body.haiku_cost_usd).toBeCloseTo(0.02);
    expect(body.total_api_cost_usd).toBeCloseTo(0.03);
    expect(body.leads_ready).toBe(5);
  });
});

describe('GET /api/run-engine/stats/:engineName', () => {
  it('requires auth', async () => {
    const r = await fetch(`${baseUrl}/api/run-engine/stats/findLeads`);
    expect(r.status).toBe(401);
  });

  it('returns zeros when no completed runs exist', async () => {
    const r = await fetch(`${baseUrl}/api/run-engine/stats/findLeads`, { headers: authHeaders() });
    const body = await r.json();
    expect(body.sample_size).toBe(0);
    expect(body.avg_cost_per_lead_usd).toBeNull();
  });

  it('computes weighted avg cost/lead + median from completed runs', async () => {
    const prisma = getTestPrisma();
    // Run 1: 10 leads, $0.02 → $0.002/lead
    // Run 2: 5 leads, $0.015 → $0.003/lead
    // Run 3 (failed): should be skipped
    // Run 4 (skipped — 0 processed): should be skipped
    await prisma.cronLog.create({ data: { jobName: 'findLeads', status: 'success', recordsProcessed: 10, costUsd: 0.02, durationMs: 40_000, completedAt: new Date() } });
    await prisma.cronLog.create({ data: { jobName: 'findLeads', status: 'success', recordsProcessed: 5, costUsd: 0.015, durationMs: 20_000, completedAt: new Date() } });
    await prisma.cronLog.create({ data: { jobName: 'findLeads', status: 'failed', recordsProcessed: 0, costUsd: 0, durationMs: 100, completedAt: new Date() } });
    await prisma.cronLog.create({ data: { jobName: 'findLeads', status: 'success', recordsProcessed: 0, costUsd: 0, durationMs: 50, completedAt: new Date() } });

    const r = await fetch(`${baseUrl}/api/run-engine/stats/findLeads`, { headers: authHeaders() });
    const body = await r.json();
    expect(body.sample_size).toBe(2);
    // weighted: (0.02 + 0.015) / (10 + 5) = 0.035 / 15 = 0.002333...
    expect(body.avg_cost_per_lead_usd).toBeCloseTo(0.002333, 5);
    // median of [0.002, 0.003] = 0.0025
    expect(body.median_cost_per_lead_usd).toBeCloseTo(0.0025, 5);
    expect(body.avg_duration_ms).toBe(30_000);
  });

  it('honours sample query param', async () => {
    const prisma = getTestPrisma();
    // 15 successful runs
    for (let i = 0; i < 15; i++) {
      await prisma.cronLog.create({ data: { jobName: 'findLeads', status: 'success', recordsProcessed: 1, costUsd: 0.001 * (i + 1), durationMs: 100, completedAt: new Date() } });
    }
    const r = await fetch(`${baseUrl}/api/run-engine/stats/findLeads?sample=3`, { headers: authHeaders() });
    const body = await r.json();
    expect(body.sample_size).toBe(3);  // only the 3 most recent
  });
});

describe('GET /api/run-engine/latest/:engineName', () => {
  it('returns null cron_log when no runs exist', async () => {
    const r = await fetch(`${baseUrl}/api/run-engine/latest/findLeads`, { headers: authHeaders() });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.cron_log).toBeNull();
  });

  it('returns the most recent run', async () => {
    const prisma = getTestPrisma();
    await prisma.cronLog.create({ data: { jobName: 'findLeads', status: 'success', startedAt: new Date(Date.now() - 10_000), completedAt: new Date(Date.now() - 9_000) } });
    const latest = await prisma.cronLog.create({ data: { jobName: 'findLeads', status: 'success', startedAt: new Date(), completedAt: new Date() } });
    const r = await fetch(`${baseUrl}/api/run-engine/latest/findLeads`, { headers: authHeaders() });
    const body = await r.json();
    expect(body.cron_log.id).toBe(latest.id);
  });
});
