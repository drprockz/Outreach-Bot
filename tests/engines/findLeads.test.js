import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { truncateAll, closeTestPrisma, getTestPrisma } from '../helpers/testDb.js';

// Mock all external dependencies before any imports that use them
vi.mock('../../src/core/ai/gemini.js', () => ({
  callGemini: vi.fn(async (prompt) => {
    if (prompt.toLowerCase().includes('discover')) {
      return {
        text: JSON.stringify([
          { business_name: 'Acme Restaurant', website_url: 'https://acme-restaurant.com', city: 'Mumbai', category: 'restaurant' },
          { business_name: 'Beta Salon', website_url: 'https://betasalon.in', city: 'Pune', category: 'salon' }
        ]),
        costUsd: 0.001,
        inputTokens: 100,
        outputTokens: 50
      };
    }
    if (prompt.includes('Analyze this business')) {
      // Stages 2-6 extraction response
      return {
        text: JSON.stringify({
          owner_name: 'John Doe',
          owner_role: 'Founder',
          contact_email: prompt.includes('acme-restaurant')
            ? 'john@acme-restaurant.com'
            : 'info@betasalon.in',
          contact_confidence: 'medium',
          contact_source: 'pattern guess',
          tech_stack: ['WordPress', 'jQuery'],
          website_problems: ['outdated design', 'no online booking'],
          last_updated: '2022',
          has_ssl: 1,
          has_analytics: 0,
          business_signals: ['low reviews', 'no booking', 'dated design'],
          social_active: 1,
          website_quality_score: 4,
          judge_reason: 'Outdated WordPress site with no booking system',
          employees_estimate: '1-10',
          business_stage: 'owner-operated'
        }),
        costUsd: 0.001,
        inputTokens: 100,
        outputTokens: 50
      };
    }
    if (prompt.includes('You are an ICP scoring engine')) {
      return {
        text: JSON.stringify({
          score: 75,
          breakdown: { firmographic: 18, problem: 17, intent: 10, tech: 12, economic: 10, buying: 8 },
          key_matches: ['industry match', 'geo match'],
          key_gaps: [],
          disqualifiers: []
        }),
        costUsd: 0.001,
        inputTokens: 50,
        outputTokens: 20,
      };
    }
    return { text: '{}', costUsd: 0, inputTokens: 0, outputTokens: 0 };
  })
}));

vi.mock('../../src/core/ai/claude.js', () => ({
  callClaude: vi.fn(async (model, prompt) => {
    if (prompt.includes('ONE sentence')) {
      // Stage 10: hook generation
      return { text: 'Your site looks dated and lacks online booking.', costUsd: 0.002, inputTokens: 200, outputTokens: 30 };
    }
    if (prompt.includes('cold email from Darshan')) {
      // Stage 11: email body
      return {
        text: 'Hi John,\n\nI noticed your website still runs on an older WordPress theme with no online booking. For a busy Mumbai restaurant, that means lost reservations every day.\n\nI build modern, fast websites for food businesses. Would it make sense to chat for ten minutes this week?\n\nBest,\nDarshan',
        costUsd: 0.001,
        inputTokens: 150,
        outputTokens: 60
      };
    }
    if (prompt.includes('subject line')) {
      // Stage 11: subject generation
      return { text: 'quick thought on your website', costUsd: 0.0005, inputTokens: 50, outputTokens: 10 };
    }
    return { text: 'mock response', costUsd: 0, inputTokens: 0, outputTokens: 0 };
  })
}));

vi.mock('../../src/core/integrations/mev.js', () => ({
  verifyEmail: vi.fn(async () => ({ status: 'valid', confidence: 0.9 }))
}));

vi.mock('../../src/core/integrations/telegram.js', () => ({
  sendAlert: vi.fn(async () => {})
}));

beforeEach(async () => {
  await truncateAll();
  const { resetDb, seedConfigDefaults, seedNichesAndIcpRules } = await import('../../src/core/db/index.js');
  await resetDb();
  await seedConfigDefaults();
  await seedNichesAndIcpRules();

  const prisma = getTestPrisma();
  // Override: 50 leads / 50 per batch = 1 batch (50 is the Math.max floor in findLeads.js)
  await prisma.config.update({ where: { key: 'find_leads_count' }, data: { value: '50' } });
  await prisma.config.update({ where: { key: 'find_leads_per_batch' }, data: { value: '50' } });
  await prisma.config.update({ where: { key: 'find_leads_enabled' }, data: { value: '1' } });
  // Configure offer + icp_profile so loadScoringContext passes
  await prisma.offer.update({ where: { id: 1 }, data: { problem: 'outdated sites' } });
  await prisma.icpProfile.update({ where: { id: 1 }, data: { industries: ['restaurants', 'salons'] } });
});

afterEach(async () => {
  const { resetDb } = await import('../../src/core/db/index.js');
  await resetDb();
});

afterAll(async () => { await closeTestPrisma(); });

describe('findLeads', () => {
  it('runs pipeline and inserts ready leads', async () => {
    const { default: findLeads } = await import('../../src/engines/findLeads.js');
    await findLeads();

    const prisma = getTestPrisma();
    const leads = await prisma.lead.findMany({ where: { status: 'ready' } });

    expect(leads.length).toBeGreaterThan(0);
    expect(leads[0].icpPriority).toBe('A');
    expect(leads[0].contactEmail).toBeTruthy();
    expect(leads[0].businessName).toBeTruthy();

    // Hook, subject, body are now on the emails table, not leads
    const emails = await prisma.email.findMany({ where: { leadId: leads[0].id } });
    expect(emails.length).toBeGreaterThan(0);
    expect(emails[0].hook).toBeTruthy();
    expect(emails[0].body).toBeTruthy();
    expect(emails[0].subject).toBeTruthy();
  });

  it('skips leads with invalid emails', async () => {
    const { verifyEmail } = await import('../../src/core/integrations/mev.js');
    verifyEmail.mockResolvedValueOnce({ status: 'invalid', confidence: 0 });
    verifyEmail.mockResolvedValueOnce({ status: 'invalid', confidence: 0 });

    const { default: findLeads } = await import('../../src/engines/findLeads.js');
    await findLeads();

    const prisma = getTestPrisma();
    // Invalid email leads are still inserted with status='email_invalid' for tracking
    const readyLeads = await prisma.lead.findMany({ where: { status: 'ready' } });
    expect(readyLeads.length).toBe(0);
    // All leads should be marked as email_invalid
    const allLeads = await prisma.lead.findMany();
    expect(allLeads.every(l => l.status === 'email_invalid')).toBe(true);
  });

  it('sets C-priority leads to nurture status', async () => {
    const { callGemini } = await import('../../src/core/ai/gemini.js');

    // Override ICP scoring to return C priority
    const originalImpl = callGemini.getMockImplementation();
    callGemini.mockImplementation(async (prompt, opts) => {
      if (prompt.includes('You are an ICP scoring engine')) {
        return {
          text: JSON.stringify({
            score: 20,
            breakdown: {},
            key_matches: [],
            key_gaps: ['low quality'],
            disqualifiers: []
          }),
          costUsd: 0.001,
          inputTokens: 50,
          outputTokens: 20
        };
      }
      // Use default mock for other calls
      return originalImpl(prompt, opts);
    });

    const { default: findLeads } = await import('../../src/engines/findLeads.js');
    await findLeads();

    const prisma = getTestPrisma();
    const nurtureLeads = await prisma.lead.findMany({ where: { status: 'nurture' } });
    expect(nurtureLeads.length).toBeGreaterThan(0);
    // C-priority leads should NOT have emails generated (skipped stages 10-11)
    const emails = await prisma.email.findMany({ where: { leadId: nurtureLeads[0].id } });
    expect(emails.length).toBe(0);
  });

  it('deduplicates leads already in database', async () => {
    // Insert a lead with the same email first
    const prisma = getTestPrisma();
    await prisma.lead.create({
      data: { businessName: 'Existing Company', contactEmail: 'john@acme-restaurant.com', status: 'sent' },
    });

    const { default: findLeads } = await import('../../src/engines/findLeads.js');
    await findLeads();

    // Should only have 2 leads: the pre-existing one + the non-duplicate
    const leads = await prisma.lead.findMany();
    expect(leads.length).toBe(2); // pre-existing + betasalon (acme is deduplicated)
  });

  it('skips leads in reject list', async () => {
    const { addToRejectList } = await import('../../src/core/db/index.js');
    await addToRejectList('john@acme-restaurant.com', 'unsubscribe');
    await addToRejectList('info@betasalon.in', 'hard_bounce');

    const { default: findLeads } = await import('../../src/engines/findLeads.js');
    await findLeads();

    const prisma = getTestPrisma();
    const leads = await prisma.lead.findMany();
    expect(leads.length).toBe(0);
  });

  it('writes cron_log entries', async () => {
    const { default: findLeads } = await import('../../src/engines/findLeads.js');
    await findLeads();

    const prisma = getTestPrisma();
    const cronEntries = await prisma.cronLog.findMany({ where: { jobName: 'findLeads' } });
    expect(cronEntries.length).toBe(1);
    expect(cronEntries[0].status).toBe('success');
  });

  it('sends telegram alert on completion', async () => {
    const { sendAlert } = await import('../../src/core/integrations/telegram.js');

    const { default: findLeads } = await import('../../src/engines/findLeads.js');
    await findLeads();

    expect(sendAlert).toHaveBeenCalled();
    const lastCall = sendAlert.mock.calls[sendAlert.mock.calls.length - 1][0];
    expect(lastCall).toContain('findLeads');
  });

  it('logs to daily_metrics', async () => {
    const { default: findLeads } = await import('../../src/engines/findLeads.js');
    await findLeads();

    const { today } = await import('../../src/core/db/index.js');
    const prisma = getTestPrisma();
    const metrics = await prisma.dailyMetrics.findUnique({ where: { date: today() } });
    expect(metrics).toBeTruthy();
    expect(metrics.leadsDiscovered).toBeGreaterThan(0);
  });

  it('inserts lead with status=disqualified when scorer emits disqualifiers', async () => {
    const { callGemini } = await import('../../src/core/ai/gemini.js');
    callGemini.mockImplementation(async (prompt) => {
      if (prompt.toLowerCase().includes('discover')) {
        return { text: JSON.stringify([{ business_name: 'X', website_url: 'https://x.com', city: 'Mumbai', category: 'restaurant' }]), costUsd: 0, inputTokens: 0, outputTokens: 0 };
      }
      if (prompt.includes('Analyze this business')) {
        return { text: JSON.stringify({ owner_name: 'J', owner_role: 'F', contact_email: 'j@x.com', contact_confidence: 'medium', contact_source: 'guess', tech_stack: ['WP'], website_problems: [], last_updated: '2022', has_ssl: 1, has_analytics: 0, business_signals: [], social_active: 0, website_quality_score: 4, judge_reason: 'ok', employees_estimate: '1-10', business_stage: 'owner-operated' }), costUsd: 0, inputTokens: 0, outputTokens: 0 };
      }
      if (prompt.includes('You are an ICP scoring engine')) {
        return { text: JSON.stringify({ score: 80, breakdown: {}, key_matches: [], key_gaps: [], disqualifiers: ['locked-in 3yr contract'] }), costUsd: 0, inputTokens: 0, outputTokens: 0 };
      }
      return { text: '{}', costUsd: 0, inputTokens: 0, outputTokens: 0 };
    });

    const { default: findLeads } = await import('../../src/engines/findLeads.js');
    await findLeads();

    const prisma = getTestPrisma();
    const disqualified = await prisma.lead.findMany({ where: { status: 'disqualified' } });
    expect(disqualified.length).toBeGreaterThanOrEqual(1);
    expect(disqualified[0].icpDisqualifiers).toContain('locked-in 3yr contract');
    const ready = await prisma.lead.findMany({ where: { status: 'ready' } });
    expect(ready.length).toBe(0);  // hook/body stages should not have run
  });

  it('fails fast when offer.problem is empty', async () => {
    const prisma = getTestPrisma();
    // outer beforeEach seeded offer.problem + industries; clear them for this test
    await prisma.offer.update({ where: { id: 1 }, data: { problem: null } });
    await prisma.icpProfile.update({ where: { id: 1 }, data: { industries: null } });

    const { default: findLeads } = await import('../../src/engines/findLeads.js');
    await findLeads();  // must not throw (caught internally)

    const row = await prisma.cronLog.findFirst({ orderBy: { id: 'desc' } });
    expect(row.status).toBe('failed');
    expect(row.errorMessage).toMatch(/offer\.problem/);
  });
});
