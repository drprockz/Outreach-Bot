import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { truncateAll, closeTestPrisma } from '../../helpers/testDb.js';
import {
  resetDb, today, logError, isRejected, addToRejectList,
  bumpMetric, bumpCostMetric, todaySentCount, todayBounceRate,
  getConfigMap, seedConfigDefaults, seedNichesAndDefaults, getPrisma,
} from '../../../src/core/db/index.js';

beforeEach(async () => { await truncateAll(); await resetDb(); });
afterAll(async () => { await resetDb(); await closeTestPrisma(); });

describe('db helpers (prisma)', () => {
  it('today() returns YYYY-MM-DD', () => {
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('logError inserts into error_log', async () => {
    await logError('test-source', new Error('boom'));
    const rows = await getPrisma().errorLog.findMany({ where: { source: 'test-source' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].errorMessage).toBe('boom');
  });

  it('isRejected returns false for unknown email', async () => {
    expect(await isRejected('nobody@example.com')).toBe(false);
  });

  it('addToRejectList + isRejected roundtrip', async () => {
    await addToRejectList('test@spam.com', 'unsubscribe');
    expect(await isRejected('test@spam.com')).toBe(true);
  });

  it('bumpMetric creates row and increments field', async () => {
    await bumpMetric('emailsSent', 5);
    expect(await todaySentCount()).toBe(5);
    await bumpMetric('emailsSent', 3);
    expect(await todaySentCount()).toBe(8);
  });

  it('bumpCostMetric bumps named field AND totalApiCostUsd', async () => {
    await bumpCostMetric('sonnetCostUsd', 0.05);
    const row = await getPrisma().dailyMetrics.findUnique({ where: { date: today() } });
    expect(Number(row.sonnetCostUsd)).toBeCloseTo(0.05);
    expect(Number(row.totalApiCostUsd)).toBeCloseTo(0.05);
  });

  it('todayBounceRate returns 0 with no sends', async () => {
    expect(await todayBounceRate()).toBe(0);
  });

  it('seedConfigDefaults is idempotent + flips old thresholds', async () => {
    const prisma = getPrisma();
    // Simulate legacy state
    await prisma.config.create({ data: { key: 'icp_threshold_a', value: '7' } });
    await prisma.config.create({ data: { key: 'icp_threshold_b', value: '4' } });
    await seedConfigDefaults();
    const cfg = await getConfigMap();
    expect(cfg['daily_send_limit']).toBe('0');
    expect(cfg['icp_threshold_a']).toBe('70');
    expect(cfg['icp_threshold_b']).toBe('40');
    expect(cfg['icp_weights']).toContain('firmographic');
  });

  it('seedNichesAndDefaults seeds 6 niches + offer + icp_profile singletons', async () => {
    await seedNichesAndDefaults();
    expect(await getPrisma().niche.count()).toBe(6);
    expect(await getPrisma().offer.count()).toBe(1);
    expect(await getPrisma().icpProfile.count()).toBe(1);
  });
});
