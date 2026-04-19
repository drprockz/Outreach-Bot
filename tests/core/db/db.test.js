import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let tmpDir;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'radar-test-'));
  process.env.DB_PATH = join(tmpDir, 'radar.sqlite');
  const { resetDb, initSchema } = await import('../../../src/core/db/index.js');
  resetDb(); // close any prior singleton so DB_PATH change takes effect
  initSchema();
});

afterEach(async () => {
  const { resetDb } = await import('../../../src/core/db/index.js');
  resetDb();
  rmSync(tmpDir, { recursive: true });
});

describe('db helpers', () => {
  it('today() returns YYYY-MM-DD', async () => {
    const { today } = await import('../../../src/core/db/index.js');
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('logError inserts into error_log', async () => {
    const { logError, getDb } = await import('../../../src/core/db/index.js');
    logError('test-source', new Error('boom'));
    const row = getDb().prepare('SELECT * FROM error_log WHERE source=?').get('test-source');
    expect(row).toBeTruthy();
    expect(row.error_message).toBe('boom');
  });

  it('isRejected returns false for unknown email', async () => {
    const { isRejected } = await import('../../../src/core/db/index.js');
    expect(isRejected('nobody@example.com')).toBe(false);
  });

  it('addToRejectList + isRejected roundtrip', async () => {
    const { addToRejectList, isRejected } = await import('../../../src/core/db/index.js');
    addToRejectList('test@spam.com', 'unsubscribe');
    expect(isRejected('test@spam.com')).toBe(true);
  });

  it('initSchema creates config table', async () => {
    const { getDb } = await import('../../../src/core/db/index.js');
    const row = getDb().prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='config'`).get();
    expect(row).toBeTruthy();
  });

  it('initSchema creates niches table', async () => {
    const { getDb } = await import('../../../src/core/db/index.js');
    const row = getDb().prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='niches'`).get();
    expect(row).toBeTruthy();
  });

  it('initSchema creates icp_rules table', async () => {
    const { getDb } = await import('../../../src/core/db/index.js');
    const row = getDb().prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='icp_rules'`).get();
    expect(row).toBeTruthy();
  });

  it('initSchema creates offer table as singleton with empty row seeded', async () => {
    await import('../../../src/core/db/index.js').then(m => m.initSchema());
    const db = (await import('../../../src/core/db/index.js')).getDb();
    const tblRow = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='offer'`).get();
    expect(tblRow).toBeTruthy();
    const seeded = db.prepare('SELECT * FROM offer WHERE id = 1').get();
    expect(seeded).toBeTruthy();
    expect(seeded.problem).toBeNull();
  });

  it('initSchema creates icp_profile table as singleton with empty row seeded', async () => {
    await import('../../../src/core/db/index.js').then(m => m.initSchema());
    const db = (await import('../../../src/core/db/index.js')).getDb();
    const tblRow = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='icp_profile'`).get();
    expect(tblRow).toBeTruthy();
    const seeded = db.prepare('SELECT * FROM icp_profile WHERE id = 1').get();
    expect(seeded).toBeTruthy();
    expect(seeded.industries).toBeNull();
  });

  it('initSchema adds new leads columns idempotently', async () => {
    const { initSchema, getDb } = await import('../../../src/core/db/index.js');
    initSchema();
    initSchema();  // second call must not throw
    const cols = getDb().prepare(`PRAGMA table_info(leads)`).all().map(c => c.name);
    expect(cols).toContain('icp_breakdown');
    expect(cols).toContain('icp_key_matches');
    expect(cols).toContain('icp_key_gaps');
    expect(cols).toContain('icp_disqualifiers');
    expect(cols).toContain('employees_estimate');
    expect(cols).toContain('business_stage');
  });

  it('seedConfigDefaults includes icp_weights and upgrades thresholds to 0-100', async () => {
    const { initSchema, seedConfigDefaults, getDb } = await import('../../../src/core/db/index.js');
    initSchema();
    seedConfigDefaults();
    const row = (k) => getDb().prepare('SELECT value FROM config WHERE key = ?').get(k)?.value;
    expect(Number(row('icp_threshold_a'))).toBe(70);
    expect(Number(row('icp_threshold_b'))).toBe(40);
    const weights = JSON.parse(row('icp_weights'));
    expect(weights).toEqual({ firmographic: 20, problem: 20, intent: 15, tech: 15, economic: 15, buying: 15 });
  });

  it('seedConfigDefaults upgrades pre-existing 0-10 thresholds to 0-100', async () => {
    const { initSchema, seedConfigDefaults, getDb } = await import('../../../src/core/db/index.js');
    initSchema();
    getDb().prepare(`INSERT OR REPLACE INTO config (key, value) VALUES ('icp_threshold_a', '7')`).run();
    getDb().prepare(`INSERT OR REPLACE INTO config (key, value) VALUES ('icp_threshold_b', '4')`).run();
    seedConfigDefaults();
    expect(Number(getDb().prepare(`SELECT value FROM config WHERE key='icp_threshold_a'`).get().value)).toBe(70);
    expect(Number(getDb().prepare(`SELECT value FROM config WHERE key='icp_threshold_b'`).get().value)).toBe(40);
  });

  it('getConfigMap returns empty object when config table is empty', async () => {
    const { getConfigMap } = await import('../../../src/core/db/index.js');
    const cfg = getConfigMap();
    expect(cfg).toEqual({});
  });

  it('getConfigMap returns inserted rows', async () => {
    const { getDb, getConfigMap } = await import('../../../src/core/db/index.js');
    getDb().prepare('INSERT INTO config (key, value) VALUES (?, ?)').run('test_key', '42');
    const cfg = getConfigMap();
    expect(cfg.test_key).toBe('42');
  });

  it('getConfigInt parses integer from map', async () => {
    const { getConfigInt } = await import('../../../src/core/db/index.js');
    expect(getConfigInt({ daily_send_limit: '10' }, 'daily_send_limit', 0)).toBe(10);
  });

  it('getConfigInt returns fallback for missing key', async () => {
    const { getConfigInt } = await import('../../../src/core/db/index.js');
    expect(getConfigInt({}, 'missing', 99)).toBe(99);
  });

  it('getConfigFloat parses float from map', async () => {
    const { getConfigFloat } = await import('../../../src/core/db/index.js');
    expect(getConfigFloat({ bounce_rate: '0.02' }, 'bounce_rate', 0)).toBeCloseTo(0.02);
  });

  it('getConfigStr returns string value', async () => {
    const { getConfigStr } = await import('../../../src/core/db/index.js');
    expect(getConfigStr({ persona_name: 'Darshan' }, 'persona_name', '')).toBe('Darshan');
  });

  it('getConfigStr returns fallback for missing key', async () => {
    const { getConfigStr } = await import('../../../src/core/db/index.js');
    expect(getConfigStr({}, 'missing', 'default')).toBe('default');
  });

  it('getConfigMap returns {} gracefully when config table missing', async () => {
    const { getDb, getConfigMap } = await import('../../../src/core/db/index.js');
    getDb().prepare('DROP TABLE IF EXISTS config').run();
    const cfg = getConfigMap();
    expect(cfg).toEqual({});
  });
});
