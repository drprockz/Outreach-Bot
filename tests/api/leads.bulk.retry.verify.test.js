import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import { truncateAll, closeTestPrisma } from '../helpers/testDb.js';

// Hoisted — mock verifyEmail to simulate MEV "skipped" (e.g. missing API key) response.
vi.mock('../../src/core/pipeline/verifyEmailLib.js', () => ({
  verifyEmail: vi.fn(async () => ({ status: 'skipped' })),
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
    businessName: 'Alpha', status: 'ready', icpScore: 80,
    contactEmail: 'priya@alpha.test', emailStatus: 'valid',
    websiteUrl: 'https://alpha.test',
  }});
  token = await login();
});

afterAll(async () => { server.close(); await closeTestPrisma(); delete process.env.BULK_RETRY_ENABLED; });

describe('POST /api/leads/bulk/retry — verify_email failure handling', () => {
  it('verifyEmail returning {status: skipped} produces SSE error event and does NOT mutate emailStatus', async () => {
    const { prisma } = await import('../../src/core/db/index.js');
    const a = await prisma.lead.findFirst({ where: { businessName: 'Alpha' } });
    expect(a.emailStatus).toBe('valid');

    const r = await fetch(`${baseUrl}/api/leads/bulk/retry`, {
      method: 'POST', headers: h(),
      body: JSON.stringify({ leadIds: [a.id], stage: 'verify_email' }),
    });
    const text = await r.text();
    expect(text).toContain('"status":"error"');
    expect(text).toContain('verify_email_failed');

    // emailStatus must NOT have been overwritten with "skipped".
    const after = await prisma.lead.findUnique({ where: { id: a.id } });
    expect(after.emailStatus).toBe('valid');
  });
});
