import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let tmpDir;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'radar-test-'));
  process.env.DB_PATH = join(tmpDir, 'radar.sqlite');
  const { resetDb, initSchema } = await import('../../utils/db.js');
  resetDb(); // close any prior singleton so DB_PATH change takes effect
  initSchema();
});

afterEach(async () => {
  const { resetDb } = await import('../../utils/db.js');
  resetDb();
  rmSync(tmpDir, { recursive: true });
});

describe('db helpers', () => {
  it('today() returns YYYY-MM-DD', async () => {
    const { today } = await import('../../utils/db.js');
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('logError inserts into error_log', async () => {
    const { logError, getDb } = await import('../../utils/db.js');
    logError('test-source', new Error('boom'));
    const row = getDb().prepare('SELECT * FROM error_log WHERE source=?').get('test-source');
    expect(row).toBeTruthy();
    expect(row.error_message).toBe('boom');
  });

  it('isRejected returns false for unknown email', async () => {
    const { isRejected } = await import('../../utils/db.js');
    expect(isRejected('nobody@example.com')).toBe(false);
  });

  it('addToRejectList + isRejected roundtrip', async () => {
    const { addToRejectList, isRejected } = await import('../../utils/db.js');
    addToRejectList('test@spam.com', 'unsubscribe');
    expect(isRejected('test@spam.com')).toBe(true);
  });

  it('initSchema creates config table', async () => {
    const { getDb } = await import('../../utils/db.js');
    const row = getDb().prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='config'`).get();
    expect(row).toBeTruthy();
  });

  it('initSchema creates niches table', async () => {
    const { getDb } = await import('../../utils/db.js');
    const row = getDb().prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='niches'`).get();
    expect(row).toBeTruthy();
  });

  it('initSchema creates icp_rules table', async () => {
    const { getDb } = await import('../../utils/db.js');
    const row = getDb().prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='icp_rules'`).get();
    expect(row).toBeTruthy();
  });

  it('getConfigMap returns empty object when config table is empty', async () => {
    const { getConfigMap } = await import('../../utils/db.js');
    const cfg = getConfigMap();
    expect(cfg).toEqual({});
  });

  it('getConfigMap returns inserted rows', async () => {
    const { getDb, getConfigMap } = await import('../../utils/db.js');
    getDb().prepare('INSERT INTO config (key, value) VALUES (?, ?)').run('test_key', '42');
    const cfg = getConfigMap();
    expect(cfg.test_key).toBe('42');
  });

  it('getConfigInt parses integer from map', async () => {
    const { getConfigInt } = await import('../../utils/db.js');
    expect(getConfigInt({ daily_send_limit: '10' }, 'daily_send_limit', 0)).toBe(10);
  });

  it('getConfigInt returns fallback for missing key', async () => {
    const { getConfigInt } = await import('../../utils/db.js');
    expect(getConfigInt({}, 'missing', 99)).toBe(99);
  });

  it('getConfigFloat parses float from map', async () => {
    const { getConfigFloat } = await import('../../utils/db.js');
    expect(getConfigFloat({ bounce_rate: '0.02' }, 'bounce_rate', 0)).toBeCloseTo(0.02);
  });

  it('getConfigStr returns string value', async () => {
    const { getConfigStr } = await import('../../utils/db.js');
    expect(getConfigStr({ persona_name: 'Darshan' }, 'persona_name', '')).toBe('Darshan');
  });

  it('getConfigStr returns fallback for missing key', async () => {
    const { getConfigStr } = await import('../../utils/db.js');
    expect(getConfigStr({}, 'missing', 'default')).toBe('default');
  });

  it('getConfigMap returns {} gracefully when config table missing', async () => {
    const { getDb, getConfigMap } = await import('../../utils/db.js');
    getDb().prepare('DROP TABLE IF EXISTS config').run();
    const cfg = getConfigMap();
    expect(cfg).toEqual({});
  });
});
