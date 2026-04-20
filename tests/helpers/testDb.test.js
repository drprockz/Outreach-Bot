import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestPrisma, truncateAll, closeTestPrisma } from './testDb.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closeTestPrisma(); });

describe('testDb helper', () => {
  it('truncates + isolates state between tests', async () => {
    const prisma = getTestPrisma();
    await prisma.rejectList.create({ data: { email: 'a@b.com', domain: 'b.com', reason: 'test' } });
    expect(await prisma.rejectList.count()).toBe(1);
  });

  it('second test sees zero rows (truncate ran)', async () => {
    const prisma = getTestPrisma();
    expect(await prisma.rejectList.count()).toBe(0);
  });

  it('truncate covers offer + icp_profile singletons', async () => {
    const prisma = getTestPrisma();
    await prisma.offer.upsert({ where: { id: 1 }, create: { id: 1, problem: 'x' }, update: {} });
    expect(await prisma.offer.count()).toBe(1);
    await truncateAll();
    expect(await prisma.offer.count()).toBe(0);
  });

  it('can write + read JSON array fields without manual stringify', async () => {
    const prisma = getTestPrisma();
    await prisma.icpProfile.upsert({
      where: { id: 1 },
      create: { id: 1, industries: ['restaurants', 'salons'], hardDisqualifiers: ['locked-in contract'] },
      update: {},
    });
    const row = await prisma.icpProfile.findUnique({ where: { id: 1 } });
    expect(row.industries).toEqual(['restaurants', 'salons']);
    expect(row.hardDisqualifiers).toEqual(['locked-in contract']);
  });
});
