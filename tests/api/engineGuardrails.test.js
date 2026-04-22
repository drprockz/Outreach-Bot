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

describe('/api/engines/:engineName/guardrails', () => {
  it('GET sendEmails returns keyed object with 4 guardrail keys', async () => {
    const res = await fetch(`${baseUrl}/api/engines/sendEmails/guardrails`, {
      headers: authHeader(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('email_min_words');
    expect(body).toHaveProperty('email_max_words');
    expect(body).toHaveProperty('spam_words');
    expect(body).toHaveProperty('send_holidays');
    expect(typeof body.email_min_words).toBe('number');
    expect(Array.isArray(body.spam_words)).toBe(true);
    expect(Array.isArray(body.send_holidays)).toBe(true);
  });

  it('GET findLeads returns findleads_size_prompts', async () => {
    const res = await fetch(`${baseUrl}/api/engines/findLeads/guardrails`, {
      headers: authHeader(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.findleads_size_prompts).toBeDefined();
    expect(body.findleads_size_prompts.msme).toBeDefined();
  });

  it('GET healthCheck (no guardrails) returns 200 with empty object', async () => {
    const res = await fetch(`${baseUrl}/api/engines/healthCheck/guardrails`, {
      headers: authHeader(),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
  });

  it('PUT rejects min >= max with 400 and field name', async () => {
    const res = await fetch(`${baseUrl}/api/engines/sendEmails/guardrails`, {
      method: 'PUT',
      headers: { ...authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ email_min_words: 90, email_max_words: 40 }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/min.*max/i);
    expect(body.field).toBe('email_min_words');
  });

  it('PUT persists valid update and returns { ok: true, data }', async () => {
    const res = await fetch(`${baseUrl}/api/engines/sendEmails/guardrails`, {
      method: 'PUT',
      headers: { ...authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ email_min_words: 30 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.email_min_words).toBe(30);

    const stored = await getTestPrisma().config.findUnique({ where: { key: 'email_min_words' } });
    expect(stored.value).toBe('30');
  });

  it('PUT rejects a key that does not belong to the engine', async () => {
    const res = await fetch(`${baseUrl}/api/engines/sendEmails/guardrails`, {
      method: 'PUT',
      headers: { ...authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ findleads_size_prompts: { msme: 'x', sme: 'y', both: 'z' } }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.field).toBe('findleads_size_prompts');
  });

  it('PUT persists array + object values round-trippable through GET', async () => {
    const newSpam = ['aa', 'bb', 'cc'];
    const put = await fetch(`${baseUrl}/api/engines/sendEmails/guardrails`, {
      method: 'PUT',
      headers: { ...authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ spam_words: newSpam }),
    });
    expect(put.status).toBe(200);

    const get = await fetch(`${baseUrl}/api/engines/sendEmails/guardrails`, {
      headers: authHeader(),
    });
    const body = await get.json();
    expect(body.spam_words).toEqual(newSpam);
  });
});
