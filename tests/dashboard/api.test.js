import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let tmpDir, server, baseUrl;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'radar-test-'));
  process.env.DB_PATH = join(tmpDir, 'radar.sqlite');
  process.env.DASHBOARD_PASSWORD = 'testpass';
  process.env.JWT_SECRET = 'testsecret64charslongpadded00000000000000000000000000000000000000';
  process.env.JWT_EXPIRES_IN = '7d';
  process.env.NODE_ENV = 'test';

  const { resetDb, initSchema } = await import('../../utils/db.js');
  resetDb();
  initSchema();

  const mod = await import('../../dashboard/server.js');
  // Start on random port
  server = mod.app.listen(0);
  const port = server.address().port;
  baseUrl = `http://localhost:${port}`;
});

afterAll(async () => {
  if (server) server.close();
  const { resetDb } = await import('../../utils/db.js');
  resetDb();
  rmSync(tmpDir, { recursive: true });
});

describe('dashboard API', () => {
  it('POST /api/auth/login returns token with correct password', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'testpass' })
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBeTruthy();
  });

  it('POST /api/auth/login rejects wrong password', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'wrong' })
    });
    expect(res.status).toBe(401);
  });

  it('GET /api/overview requires auth', async () => {
    const res = await fetch(`${baseUrl}/api/overview`);
    expect(res.status).toBe(401);
  });

  it('GET /api/overview returns data with valid token', async () => {
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'testpass' })
    });
    const { token } = await loginRes.json();

    const res = await fetch(`${baseUrl}/api/overview`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('metrics');
  });

  it('GET /api/leads returns paginated leads', async () => {
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'testpass' })
    });
    const { token } = await loginRes.json();

    const res = await fetch(`${baseUrl}/api/leads?page=1&limit=10`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('leads');
    expect(data).toHaveProperty('total');
    expect(data).toHaveProperty('page');
  });

  it('GET /api/cron-status returns job statuses', async () => {
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'testpass' })
    });
    const { token } = await loginRes.json();

    const res = await fetch(`${baseUrl}/api/cron-status`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('jobs');
    expect(Array.isArray(data.jobs)).toBe(true);
  });

  it('GET /api/errors returns error log', async () => {
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'testpass' })
    });
    const { token } = await loginRes.json();

    const res = await fetch(`${baseUrl}/api/errors`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('errors');
  });

  it('PATCH /api/errors/:id/resolve marks error resolved', async () => {
    // Insert an error first
    const { getDb } = await import('../../utils/db.js');
    getDb().prepare(`INSERT INTO error_log (source, message) VALUES ('test', 'test error')`).run();
    const err = getDb().prepare(`SELECT id FROM error_log WHERE source='test'`).get();

    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'testpass' })
    });
    const { token } = await loginRes.json();

    const res = await fetch(`${baseUrl}/api/errors/${err.id}/resolve`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(200);

    const row = getDb().prepare(`SELECT resolved FROM error_log WHERE id=?`).get(err.id);
    expect(row.resolved).toBe(1);
  });

  it('GET /api/costs returns cost data', async () => {
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'testpass' })
    });
    const { token } = await loginRes.json();

    const res = await fetch(`${baseUrl}/api/costs`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('daily');
    expect(data).toHaveProperty('monthly');
  });

  it('GET /api/replies returns replies', async () => {
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'testpass' })
    });
    const { token } = await loginRes.json();

    const res = await fetch(`${baseUrl}/api/replies`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('replies');
  });

  it('GET /api/sequences returns sequence states', async () => {
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'testpass' })
    });
    const { token } = await loginRes.json();

    const res = await fetch(`${baseUrl}/api/sequences`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('sequences');
  });

  it('GET /api/health returns health data', async () => {
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'testpass' })
    });
    const { token } = await loginRes.json();

    const res = await fetch(`${baseUrl}/api/health`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('bounceRate');
    expect(data).toHaveProperty('domain');
  });

  it('GET /api/send-log returns paginated email log', async () => {
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'testpass' })
    });
    const { token } = await loginRes.json();

    const res = await fetch(`${baseUrl}/api/send-log?page=1&limit=10`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('emails');
    expect(data).toHaveProperty('total');
  });

  it('PATCH /api/leads/:id/status updates lead status', async () => {
    // Insert a lead
    const { getDb } = await import('../../utils/db.js');
    getDb().prepare(`INSERT INTO leads (company, contact_email, status) VALUES ('TestCo', 'test@testco.com', 'new')`).run();
    const lead = getDb().prepare(`SELECT id FROM leads WHERE company='TestCo'`).get();

    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'testpass' })
    });
    const { token } = await loginRes.json();

    const res = await fetch(`${baseUrl}/api/leads/${lead.id}/status`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ status: 'nurture' })
    });
    expect(res.status).toBe(200);

    const row = getDb().prepare(`SELECT status FROM leads WHERE id=?`).get(lead.id);
    expect(row.status).toBe('nurture');
  });

  it('GET /api/leads/:id returns lead detail', async () => {
    const { getDb } = await import('../../utils/db.js');
    const lead = getDb().prepare(`SELECT id FROM leads LIMIT 1`).get();
    if (!lead) return; // skip if no leads

    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'testpass' })
    });
    const { token } = await loginRes.json();

    const res = await fetch(`${baseUrl}/api/leads/${lead.id}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('lead');
    expect(data).toHaveProperty('emails');
    expect(data).toHaveProperty('replies');
  });

  it('GET /api/cron-status/:job/history returns job history', async () => {
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'testpass' })
    });
    const { token } = await loginRes.json();

    const res = await fetch(`${baseUrl}/api/cron-status/findLeads/history`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('history');
    expect(Array.isArray(data.history)).toBe(true);
  });
});
