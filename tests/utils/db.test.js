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
});
