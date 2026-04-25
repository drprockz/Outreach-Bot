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
  await prisma.lead.createMany({ data: [
    { businessName: 'Alpha', status: 'ready', icpScore: 80, city: 'Mumbai', category: 'd2c', techStack: ['WP', 'PHP'] },
    { businessName: 'Beta',  status: 'queued', icpScore: 50, city: 'Bangalore', category: 'd2c' },
  ] });
  token = await login();
});

afterAll(async () => { server.close(); await closeTestPrisma(); });

describe('GET /api/leads/export.csv', () => {
  it('streams CSV with header + filtered rows', async () => {
    const r = await fetch(`${baseUrl}/api/leads/export.csv?status=ready&columns=visible`, { headers: h() });
    expect(r.headers.get('content-type')).toMatch(/text\/csv/);
    const text = await r.text();
    const lines = text.trim().split('\n');
    expect(lines[0]).toContain('business_name');
    expect(lines.length).toBe(2); // header + 1 ready lead
    expect(text).toContain('Alpha');
    expect(text).not.toContain('Beta');
  });

  it('columns=all includes Lead fields beyond the visible set', async () => {
    const r = await fetch(`${baseUrl}/api/leads/export.csv?columns=all`, { headers: h() });
    const text = await r.text();
    const headerLine = text.split('\n')[0];
    expect(headerLine).toContain('icp_breakdown');
    expect(headerLine).toContain('discovered_at');
  });

  it('escapes commas and quotes in cell values', async () => {
    const { prisma } = await import('../../src/core/db/index.js');
    await prisma.lead.create({ data: { businessName: 'Has, "comma"', status: 'ready', icpScore: 70 } });
    const r = await fetch(`${baseUrl}/api/leads/export.csv?columns=visible`, { headers: h() });
    const text = await r.text();
    expect(text).toContain('"Has, ""comma"""');
  });
});
