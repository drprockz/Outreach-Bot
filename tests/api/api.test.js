import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Helper: get auth token
async function getToken() {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'testpass' })
  });
  return (await res.json()).token;
}

let tmpDir, server, baseUrl;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'radar-test-'));
  process.env.DB_PATH = join(tmpDir, 'radar.sqlite');
  process.env.DASHBOARD_PASSWORD = 'testpass';
  process.env.JWT_SECRET = 'testsecret64charslongpadded00000000000000000000000000000000000000';
  process.env.JWT_EXPIRES_IN = '7d';
  process.env.NODE_ENV = 'test';

  const { resetDb, initSchema } = await import('../../src/core/db/index.js');
  resetDb();
  initSchema();

  const mod = await import('../../src/api/server.js');
  // Start on random port
  server = mod.app.listen(0);
  const port = server.address().port;
  baseUrl = `http://localhost:${port}`;
});

afterAll(async () => {
  if (server) server.close();
  const { resetDb } = await import('../../src/core/db/index.js');
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
    const { getDb } = await import('../../src/core/db/index.js');
    getDb().prepare(`INSERT INTO error_log (source, error_message) VALUES ('test', 'test error')`).run();
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
    const { getDb } = await import('../../src/core/db/index.js');
    getDb().prepare(`INSERT INTO leads (business_name, contact_email, status) VALUES ('TestCo', 'test@testco.com', 'discovered')`).run();
    const lead = getDb().prepare(`SELECT id FROM leads WHERE business_name='TestCo'`).get();

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
    const { getDb } = await import('../../src/core/db/index.js');
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

describe('GET /api/config', () => {
  it('requires auth', async () => {
    const res = await fetch(`${baseUrl}/api/config`);
    expect(res.status).toBe(401);
  });

  it('returns seeded config as flat object', async () => {
    const token = await getToken();
    const res = await fetch(`${baseUrl}/api/config`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.daily_send_limit).toBeDefined();
    expect(data.persona_name).toBe('Darshan Parmar');
  });
});

describe('PUT /api/config', () => {
  it('updates provided keys without touching others', async () => {
    const token = await getToken();
    await fetch(`${baseUrl}/api/config`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ daily_send_limit: '20' })
    });
    const res = await fetch(`${baseUrl}/api/config`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    expect(data.daily_send_limit).toBe('20');
    expect(data.persona_name).toBe('Darshan Parmar');
  });

  it('PUT /api/config rejects icp_weights that do not sum to 100', async () => {
    const token = await getToken();
    const r = await fetch(`${baseUrl}/api/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ icp_weights: JSON.stringify({ firmographic: 50, problem: 20, intent: 15, tech: 15, economic: 15, buying: 15 }) })
    });
    expect(r.status).toBe(400);
  });

  it('PUT /api/config accepts valid icp_weights summing to 100', async () => {
    const token = await getToken();
    const r = await fetch(`${baseUrl}/api/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ icp_weights: JSON.stringify({ firmographic: 20, problem: 20, intent: 15, tech: 15, economic: 15, buying: 15 }) })
    });
    expect(r.status).toBe(200);
  });
});

// NOTE: GET /api/niches must run before POST /api/niches tests — POST tests add rows
// that would break the length===6 assertion. Declaration order in this file is relied upon.
describe('GET /api/niches', () => {
  it('returns seeded niches ordered by sort_order', async () => {
    const token = await getToken();
    const res = await fetch(`${baseUrl}/api/niches`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.niches)).toBe(true);
    expect(data.niches.length).toBe(6);
    expect(data.niches[0].day_of_week).toBe(1); // Monday first
  });
});

describe('POST /api/niches', () => {
  it('creates a niche and returns it', async () => {
    const token = await getToken();
    const res = await fetch(`${baseUrl}/api/niches`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'Test Niche', query: 'test query string here', day_of_week: null, enabled: 1 })
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.niche.label).toBe('Test Niche');
    expect(data.niche.id).toBeDefined();
  });

  it('clears conflicting day assignment atomically when day is taken', async () => {
    const token = await getToken();
    // Monday (day 1) is already taken by seed
    const res = await fetch(`${baseUrl}/api/niches`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'New Monday', query: 'new monday query string', day_of_week: 1, enabled: 1 })
    });
    expect(res.status).toBe(201);
    // Old Monday niche should now have day_of_week = null
    const listRes = await fetch(`${baseUrl}/api/niches`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const { niches } = await listRes.json();
    const mondayNiches = niches.filter(n => n.day_of_week === 1);
    expect(mondayNiches.length).toBe(1);
    expect(mondayNiches[0].label).toBe('New Monday');
  });
});

describe('PUT /api/niches/:id', () => {
  it('updates a niche', async () => {
    const token = await getToken();
    const listRes = await fetch(`${baseUrl}/api/niches`, { headers: { Authorization: `Bearer ${token}` } });
    const { niches } = await listRes.json();
    const id = niches[0].id;

    const res = await fetch(`${baseUrl}/api/niches/${id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'Updated', query: 'updated query text here', day_of_week: niches[0].day_of_week, enabled: 1 })
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });
});

describe('DELETE /api/niches/:id', () => {
  it('deletes a niche', async () => {
    const token = await getToken();
    // Create one first
    const createRes = await fetch(`${baseUrl}/api/niches`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'To Delete', query: 'to be deleted query', day_of_week: null, enabled: 1 })
    });
    const { niche } = await createRes.json();

    const res = await fetch(`${baseUrl}/api/niches/${niche.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(200);

    const listRes = await fetch(`${baseUrl}/api/niches`, { headers: { Authorization: `Bearer ${token}` } });
    const { niches } = await listRes.json();
    expect(niches.find(n => n.id === niche.id)).toBeUndefined();
  });
});

// NOTE: GET /api/icp-rules must run before PUT /api/icp-rules — the PUT bulk-replaces
// the table, leaving only 2 rules after it runs, which would break the length===8 assertion.
describe('GET /api/icp-rules', () => {
  it('returns seeded rules', async () => {
    const token = await getToken();
    const res = await fetch(`${baseUrl}/api/icp-rules`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.rules)).toBe(true);
    expect(data.rules.length).toBe(8);
    expect(data.rules[0].points).toBe(3);
  });
});

describe('PUT /api/icp-rules', () => {
  it('bulk-replaces rules and re-sequences sort_order', async () => {
    const token = await getToken();
    const newRules = [
      { label: 'Rule A', points: 2, description: null, enabled: 1 },
      { label: 'Rule B', points: -1, description: 'desc', enabled: 1 },
    ];
    const res = await fetch(`${baseUrl}/api/icp-rules`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(newRules)
    });
    expect(res.status).toBe(200);

    const listRes = await fetch(`${baseUrl}/api/icp-rules`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const { rules } = await listRes.json();
    expect(rules.length).toBe(2);
    expect(rules[0].label).toBe('Rule A');
    expect(rules[0].sort_order).toBe(0);
    expect(rules[1].sort_order).toBe(1);
  });

  it('rolls back entirely if a rule has invalid points', async () => {
    const token = await getToken();
    // First get current count
    const beforeRes = await fetch(`${baseUrl}/api/icp-rules`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const { rules: before } = await beforeRes.json();

    const badRules = [
      { label: 'Good', points: 2, enabled: 1 },
      { label: 'Bad', points: 99, enabled: 1 }, // invalid
    ];
    const res = await fetch(`${baseUrl}/api/icp-rules`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(badRules)
    });
    expect(res.status).toBe(400);

    // Table unchanged
    const afterRes = await fetch(`${baseUrl}/api/icp-rules`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const { rules: after } = await afterRes.json();
    expect(after.length).toBe(before.length);
  });
});
