import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

vi.mock('../../src/core/ai/gemini.js', () => ({
  callGemini: vi.fn(async () => ({
    text: JSON.stringify({
      score: 75,
      breakdown: { firmographic: 18, problem: 17, intent: 10, tech: 12, economic: 10, buying: 8 },
      key_matches: [],
      key_gaps: [],
      disqualifiers: []
    }),
    costUsd: 0.001,
  }))
}));

let tmpDir;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'radar-test-'));
  process.env.DB_PATH = join(tmpDir, 'radar.sqlite');
  const { resetDb, initSchema, getDb } = await import('../../src/core/db/index.js');
  resetDb();
  initSchema();
  // Seed minimally valid offer + icp_profile
  getDb().prepare(`UPDATE offer SET problem='x' WHERE id=1`).run();
  getDb().prepare(`UPDATE icp_profile SET industries=? WHERE id=1`).run(JSON.stringify(['r']));
});

afterEach(async () => {
  const { resetDb } = await import('../../src/core/db/index.js');
  resetDb();
  rmSync(tmpDir, { recursive: true });
});

describe('rescoreLeads', () => {
  it('updates all scoreable leads with 0-100 scores', async () => {
    const { getDb } = await import('../../src/core/db/index.js');
    const db = getDb();
    db.prepare(`INSERT INTO leads (business_name, website_url, category, city, contact_email, icp_score, icp_priority, status) VALUES (?,?,?,?,?,?,?,?)`)
      .run('A', 'https://a.com', 'restaurant', 'Mumbai', 'a@a.com', 7, 'A', 'sent');
    db.prepare(`INSERT INTO leads (business_name, website_url, category, city, contact_email, icp_score, icp_priority, status) VALUES (?,?,?,?,?,?,?,?)`)
      .run('B', 'https://b.com', 'restaurant', 'Mumbai', 'b@b.com', 5, 'B', 'nurture');

    const { default: rescore } = await import('../../scripts/rescoreLeads.js');
    await rescore({ legacy: false });

    const rows = db.prepare(`SELECT business_name, icp_score, icp_priority FROM leads ORDER BY id`).all();
    expect(rows[0].icp_score).toBe(75);
    expect(rows[0].icp_priority).toBe('A');
    expect(rows[1].icp_score).toBe(75);
  });

  it('exits with error if offer.problem is empty', async () => {
    const { getDb } = await import('../../src/core/db/index.js');
    const db = getDb();
    db.prepare(`UPDATE offer SET problem=NULL WHERE id=1`).run();
    const { default: rescore } = await import('../../scripts/rescoreLeads.js');
    await expect(rescore({ legacy: false })).rejects.toThrow(/offer\.problem/);
  });

  it('moves ready leads with disqualifiers to disqualified and deletes pending emails', async () => {
    const { callGemini } = await import('../../src/core/ai/gemini.js');
    callGemini.mockResolvedValueOnce({
      text: JSON.stringify({ score: 80, breakdown: {}, key_matches: [], key_gaps: [], disqualifiers: ['DQ1'] }),
      costUsd: 0.001,
    });
    const { getDb } = await import('../../src/core/db/index.js');
    const db = getDb();
    const info = db.prepare(`INSERT INTO leads (business_name, website_url, category, city, contact_email, icp_score, icp_priority, status) VALUES (?,?,?,?,?,?,?,?)`)
      .run('A', 'https://a.com', 'restaurant', 'Mumbai', 'a@a.com', 7, 'A', 'ready');
    db.prepare(`INSERT INTO emails (lead_id, sequence_step, subject, body, status) VALUES (?, 0, ?, ?, 'pending')`)
      .run(info.lastInsertRowid, 'hi', 'body');

    const { default: rescore } = await import('../../scripts/rescoreLeads.js');
    await rescore({ legacy: false });

    const lead = db.prepare(`SELECT * FROM leads WHERE id=?`).get(info.lastInsertRowid);
    expect(lead.status).toBe('disqualified');
    const pending = db.prepare(`SELECT * FROM emails WHERE lead_id=? AND status='pending'`).all(info.lastInsertRowid);
    expect(pending.length).toBe(0);
  });

  it('preserves status for sent/replied/nurture leads even with disqualifiers', async () => {
    const { callGemini } = await import('../../src/core/ai/gemini.js');
    callGemini.mockImplementation(async () => ({
      text: JSON.stringify({ score: 80, breakdown: {}, key_matches: [], key_gaps: [], disqualifiers: ['DQ1'] }),
      costUsd: 0.001,
    }));
    const { getDb } = await import('../../src/core/db/index.js');
    const db = getDb();
    db.prepare(`INSERT INTO leads (business_name, website_url, category, city, contact_email, status) VALUES (?,?,?,?,?,?)`)
      .run('S', 'https://s.com', 'r', 'M', 's@s.com', 'sent');
    db.prepare(`INSERT INTO leads (business_name, website_url, category, city, contact_email, status) VALUES (?,?,?,?,?,?)`)
      .run('N', 'https://n.com', 'r', 'M', 'n@n.com', 'nurture');

    const { default: rescore } = await import('../../scripts/rescoreLeads.js');
    await rescore({ legacy: false });

    const statuses = db.prepare(`SELECT business_name, status FROM leads ORDER BY business_name`).all();
    expect(statuses.find(s => s.business_name === 'S').status).toBe('sent');
    expect(statuses.find(s => s.business_name === 'N').status).toBe('nurture');
  });
});
