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
  const { resetDb, seedConfigDefaults, seedNichesAndDefaults } = await import('../../src/core/db/index.js');
  await resetDb();
  await seedConfigDefaults();
  await seedNichesAndDefaults();
  token = await login();
});

afterAll(async () => { server.close(); await closeTestPrisma(); });

describe('saved views CRUD', () => {
  it('full lifecycle: create → list → patch → delete', async () => {
    const c = await fetch(`${baseUrl}/api/saved-views`, { method: 'POST', headers: h(),
      body: JSON.stringify({ name: 'A-tier hot', filtersJson: { icp_priority: 'A', has_signals: '1' }, sort: 'icp_score:desc' }) });
    expect(c.status).toBe(201);
    const created = (await c.json()).view;
    expect(created.name).toBe('A-tier hot');
    expect(created.id).toBeGreaterThan(0);

    const list = await fetch(`${baseUrl}/api/saved-views`, { headers: h() }).then(r => r.json());
    expect(list.views.length).toBe(1);

    const u = await fetch(`${baseUrl}/api/saved-views/${created.id}`, { method: 'PATCH', headers: h(),
      body: JSON.stringify({ name: 'A-tier renamed' }) });
    expect((await u.json()).view.name).toBe('A-tier renamed');

    const d = await fetch(`${baseUrl}/api/saved-views/${created.id}`, { method: 'DELETE', headers: h() });
    expect(d.status).toBe(204);

    const after = await fetch(`${baseUrl}/api/saved-views`, { headers: h() }).then(r => r.json());
    expect(after.views.length).toBe(0);
  });

  it('rejects POST without name', async () => {
    const r = await fetch(`${baseUrl}/api/saved-views`, { method: 'POST', headers: h(),
      body: JSON.stringify({ filtersJson: { x: 1 } }) });
    expect(r.status).toBe(400);
  });

  it('rejects POST without filtersJson', async () => {
    const r = await fetch(`${baseUrl}/api/saved-views`, { method: 'POST', headers: h(),
      body: JSON.stringify({ name: 'x' }) });
    expect(r.status).toBe(400);
  });

  it('requires auth', async () => {
    const r = await fetch(`${baseUrl}/api/saved-views`);
    expect(r.status).toBe(401);
  });
});
