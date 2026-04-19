import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { truncateAll, closeTestPrisma, getTestPrisma } from '../helpers/testDb.js';

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

beforeEach(async () => {
  await truncateAll();
  const prisma = getTestPrisma();
  // Seed minimally valid offer + icp_profile so loadScoringContext passes
  await prisma.offer.upsert({
    where: { id: 1 },
    create: { id: 1, problem: 'x' },
    update: { problem: 'x' },
  });
  await prisma.icpProfile.upsert({
    where: { id: 1 },
    create: { id: 1, industries: ['r'] },
    update: { industries: ['r'] },
  });
  const { callGemini } = await import('../../src/core/ai/gemini.js');
  callGemini.mockReset();
  callGemini.mockImplementation(async () => ({
    text: JSON.stringify({
      score: 75,
      breakdown: { firmographic: 18, problem: 17, intent: 10, tech: 12, economic: 10, buying: 8 },
      key_matches: [],
      key_gaps: [],
      disqualifiers: []
    }),
    costUsd: 0.001,
  }));
});

afterAll(async () => { await closeTestPrisma(); });

describe('rescoreLeads', () => {
  it('updates all scoreable leads with 0-100 scores', async () => {
    const prisma = getTestPrisma();
    await prisma.lead.create({
      data: {
        businessName: 'A', websiteUrl: 'https://a.com', category: 'restaurant',
        city: 'Mumbai', contactEmail: 'a@a.com', icpScore: 7, icpPriority: 'A', status: 'sent',
      },
    });
    await prisma.lead.create({
      data: {
        businessName: 'B', websiteUrl: 'https://b.com', category: 'restaurant',
        city: 'Mumbai', contactEmail: 'b@b.com', icpScore: 5, icpPriority: 'B', status: 'nurture',
      },
    });

    const { default: rescore } = await import('../../scripts/rescoreLeads.js');
    await rescore({ legacy: false });

    const rows = await prisma.lead.findMany({
      orderBy: { id: 'asc' },
      select: { businessName: true, icpScore: true, icpPriority: true },
    });
    expect(rows[0].icpScore).toBe(75);
    expect(rows[0].icpPriority).toBe('A');
    expect(rows[1].icpScore).toBe(75);
  });

  it('exits with error if offer.problem is empty', async () => {
    const prisma = getTestPrisma();
    await prisma.offer.update({ where: { id: 1 }, data: { problem: null } });
    const { default: rescore } = await import('../../scripts/rescoreLeads.js');
    await expect(rescore({ legacy: false })).rejects.toThrow(/offer\.problem/);
  });

  it('moves ready leads with disqualifiers to disqualified and deletes pending emails', async () => {
    const { callGemini } = await import('../../src/core/ai/gemini.js');
    callGemini.mockReset();
    callGemini.mockResolvedValueOnce({
      text: JSON.stringify({ score: 80, breakdown: {}, key_matches: [], key_gaps: [], disqualifiers: ['DQ1'] }),
      costUsd: 0.001,
    });
    const prisma = getTestPrisma();
    const lead = await prisma.lead.create({
      data: {
        businessName: 'A', websiteUrl: 'https://a.com', category: 'restaurant',
        city: 'Mumbai', contactEmail: 'a@a.com', icpScore: 7, icpPriority: 'A', status: 'ready',
      },
    });
    await prisma.email.create({
      data: { leadId: lead.id, sequenceStep: 0, subject: 'hi', body: 'body', status: 'pending' },
    });

    const { default: rescore } = await import('../../scripts/rescoreLeads.js');
    await rescore({ legacy: false });

    const updated = await prisma.lead.findUnique({ where: { id: lead.id } });
    expect(updated.status).toBe('disqualified');
    const pending = await prisma.email.findMany({ where: { leadId: lead.id, status: 'pending' } });
    expect(pending.length).toBe(0);
  });

  it('preserves status for sent/replied/nurture leads even with disqualifiers', async () => {
    const { callGemini } = await import('../../src/core/ai/gemini.js');
    callGemini.mockReset();
    callGemini.mockImplementation(async () => ({
      text: JSON.stringify({ score: 80, breakdown: {}, key_matches: [], key_gaps: [], disqualifiers: ['DQ1'] }),
      costUsd: 0.001,
    }));
    const prisma = getTestPrisma();
    await prisma.lead.create({
      data: {
        businessName: 'S', websiteUrl: 'https://s.com', category: 'r',
        city: 'M', contactEmail: 's@s.com', status: 'sent',
      },
    });
    await prisma.lead.create({
      data: {
        businessName: 'N', websiteUrl: 'https://n.com', category: 'r',
        city: 'M', contactEmail: 'n@n.com', status: 'nurture',
      },
    });

    const { default: rescore } = await import('../../scripts/rescoreLeads.js');
    await rescore({ legacy: false });

    const statuses = await prisma.lead.findMany({
      orderBy: { businessName: 'asc' },
      select: { businessName: true, status: true },
    });
    expect(statuses.find(s => s.businessName === 'S').status).toBe('sent');
    expect(statuses.find(s => s.businessName === 'N').status).toBe('nurture');
  });
});
