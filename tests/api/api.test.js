import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { truncateAll, closeTestPrisma } from '../helpers/testDb.js';

// Helper: get auth token
async function getToken() {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'testpass' })
  });
  return (await res.json()).token;
}

let server, baseUrl;

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
  const { resetDb, seedConfigDefaults, seedNichesAndDefaults } = await import('../../src/core/db/index.js');
  await resetDb();
  await seedConfigDefaults();
  await seedNichesAndDefaults();
});

afterAll(async () => {
  if (server) server.close();
  const { resetDb } = await import('../../src/core/db/index.js');
  await resetDb();
  await closeTestPrisma();
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
    const token = await getToken();
    const res = await fetch(`${baseUrl}/api/overview`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('metrics');
  });

  it('GET /api/leads returns paginated leads', async () => {
    const token = await getToken();
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
    const token = await getToken();
    const res = await fetch(`${baseUrl}/api/cron-status`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('jobs');
    expect(Array.isArray(data.jobs)).toBe(true);
  });

  it('GET /api/errors returns error log', async () => {
    const token = await getToken();
    const res = await fetch(`${baseUrl}/api/errors`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('errors');
  });

  it('PATCH /api/errors/:id/resolve marks error resolved', async () => {
    const { getPrisma } = await import('../../src/core/db/index.js');
    const err = await getPrisma().errorLog.create({
      data: { source: 'test', errorMessage: 'test error' },
    });

    const token = await getToken();
    const res = await fetch(`${baseUrl}/api/errors/${err.id}/resolve`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(200);

    const row = await getPrisma().errorLog.findUnique({ where: { id: err.id } });
    expect(row.resolved).toBe(true);
  });

  it('GET /api/costs returns cost data', async () => {
    const token = await getToken();
    const res = await fetch(`${baseUrl}/api/costs`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('daily');
    expect(data).toHaveProperty('monthly');
  });

  it('GET /api/replies returns replies', async () => {
    const token = await getToken();
    const res = await fetch(`${baseUrl}/api/replies`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('replies');
  });

  it('GET /api/sequences returns sequence states', async () => {
    const token = await getToken();
    const res = await fetch(`${baseUrl}/api/sequences`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('sequences');
  });

  it('GET /api/health returns health data', async () => {
    const token = await getToken();
    const res = await fetch(`${baseUrl}/api/health`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('bounceRate');
    expect(data).toHaveProperty('domain');
  });

  it('GET /api/send-log returns paginated email log', async () => {
    const token = await getToken();
    const res = await fetch(`${baseUrl}/api/send-log?page=1&limit=10`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('emails');
    expect(data).toHaveProperty('total');
  });

  it('PATCH /api/leads/:id/status updates lead status', async () => {
    const { getPrisma } = await import('../../src/core/db/index.js');
    const lead = await getPrisma().lead.create({
      data: { businessName: 'TestCo', contactEmail: 'test@testco.com', status: 'discovered' },
    });

    const token = await getToken();
    const res = await fetch(`${baseUrl}/api/leads/${lead.id}/status`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ status: 'nurture' })
    });
    expect(res.status).toBe(200);

    const row = await getPrisma().lead.findUnique({ where: { id: lead.id } });
    expect(row.status).toBe('nurture');
  });

  it('GET /api/leads/:id returns lead detail', async () => {
    const { getPrisma } = await import('../../src/core/db/index.js');
    const lead = await getPrisma().lead.create({
      data: { businessName: 'LookupCo', contactEmail: 'lookup@lookupco.com', status: 'discovered' },
    });

    const token = await getToken();
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
    const token = await getToken();
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

describe('GET /api/niches', () => {
  it('returns seeded niches ordered by sort_order', async () => {
    const token = await getToken();
    const res = await fetch(`${baseUrl}/api/niches`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.items)).toBe(true);
    expect(data.items.length).toBe(6);
    expect(data.items[0].day_of_week).toBe(1); // Monday first
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
    expect(data.ok).toBe(true);
    expect(data.data.label).toBe('Test Niche');
    expect(data.data.id).toBeDefined();
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
    const listRes = await fetch(`${baseUrl}/api/niches`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const { items: niches } = await listRes.json();
    const mondayNiches = niches.filter(n => n.day_of_week === 1);
    expect(mondayNiches.length).toBe(1);
    expect(mondayNiches[0].label).toBe('New Monday');
  });
});

describe('PUT /api/niches/:id', () => {
  it('updates a niche', async () => {
    const token = await getToken();
    const listRes = await fetch(`${baseUrl}/api/niches`, { headers: { Authorization: `Bearer ${token}` } });
    const { items: niches } = await listRes.json();
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
    const createRes = await fetch(`${baseUrl}/api/niches`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'To Delete', query: 'to be deleted query', day_of_week: null, enabled: 1 })
    });
    const { data: niche } = await createRes.json();

    const res = await fetch(`${baseUrl}/api/niches/${niche.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(200);

    const listRes = await fetch(`${baseUrl}/api/niches`, { headers: { Authorization: `Bearer ${token}` } });
    const { items: niches } = await listRes.json();
    expect(niches.find(n => n.id === niche.id)).toBeUndefined();
  });
});

describe('PUT /api/config icp_weights validation', () => {
  it('rejects icp_weights with negative values (even if sum is 100)', async () => {
    const token = await getToken();
    const r = await fetch(`${baseUrl}/api/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ icp_weights: JSON.stringify({ firmographic: -50, problem: 150, intent: 0, tech: 0, economic: 0, buying: 0 }) })
    });
    expect(r.status).toBe(400);
  });

  it('PUT /api/config rejects icp_weights with NaN values', async () => {
    const token = await getToken();
    const r = await fetch(`${baseUrl}/api/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ icp_weights: '{"firmographic":"NaN","problem":20,"intent":15,"tech":15,"economic":15,"buying":15}' })
    });
    expect(r.status).toBe(400);
  });
});
