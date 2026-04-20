import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { truncateAll, closeTestPrisma, getTestPrisma } from '../helpers/testDb.js';

vi.mock('../../src/core/email/imap.js', () => ({
  fetchUnseen: vi.fn(async () => [{
    uid: 1,
    from: 'john@acme.com',
    subject: 'Re: your email',
    text: 'Sounds interesting, let me know your rate',
    date: new Date(),
    messageId: '<reply@test.com>'
  }])
}));
vi.mock('../../src/core/ai/claude.js', () => ({
  callClaude: vi.fn(async () => ({ text: '{"category":"hot","sentiment":5}', costUsd: 0.001, inputTokens: 50, outputTokens: 5, model: 'claude-haiku-4-5-20251001' }))
}));
// Gemini fallback path (ANTHROPIC_DISABLED=true) — mirror the callClaude shape minus the `model` field
vi.mock('../../src/core/ai/gemini.js', () => ({
  callGemini: vi.fn(async () => ({ text: '{"category":"hot","sentiment":5}', costUsd: 0.001, inputTokens: 50, outputTokens: 5 }))
}));
vi.mock('../../src/core/integrations/telegram.js', () => ({ sendAlert: vi.fn(async () => {}) }));

beforeEach(async () => {
  vi.clearAllMocks();
  await truncateAll();
  process.env.INBOX_1_USER = 'darshan@trysimpleinc.com';
  process.env.INBOX_2_USER = 'hello@trysimpleinc.com';
  const { resetDb, seedConfigDefaults } = await import('../../src/core/db/index.js');
  await resetDb();
  await seedConfigDefaults();

  const prisma = getTestPrisma();
  await prisma.config.update({ where: { key: 'check_replies_enabled' }, data: { value: '1' } });

  // Seed lead + email + sequence_state
  await prisma.lead.create({
    data: {
      id: 1,
      businessName: 'Acme',
      contactEmail: 'john@acme.com',
      status: 'sent',
      emails: {
        create: {
          sequenceStep: 0,
          subject: 'Quick question',
          body: 'Hi John...',
          status: 'sent',
          messageId: '<cold@test.com>',
          inboxUsed: 'darshan@trysimpleinc.com',
          sentAt: new Date(),
        },
      },
      sequenceState: {
        create: {
          currentStep: 0,
          nextSendDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
          lastMessageId: '<cold@test.com>',
          lastSubject: 'Quick question',
          status: 'active',
        },
      },
    },
  });
});

afterEach(async () => {
  const { resetDb } = await import('../../src/core/db/index.js');
  await resetDb();
});

afterAll(async () => { await closeTestPrisma(); });

describe('checkReplies', () => {
  it('classifies hot reply and updates lead status', async () => {
    const checkReplies = (await import('../../src/engines/checkReplies.js')).default;
    await checkReplies();
    const prisma = getTestPrisma();
    const lead = await prisma.lead.findFirst({ where: { contactEmail: 'john@acme.com' } });
    expect(lead.status).toBe('replied');
    const reply = await prisma.reply.findFirst();
    expect(reply.category).toBe('hot');
  });

  it('pauses sequence on reply', async () => {
    const checkReplies = (await import('../../src/engines/checkReplies.js')).default;
    await checkReplies();
    const prisma = getTestPrisma();
    const seq = await prisma.sequenceState.findFirst({ where: { leadId: 1 } });
    expect(seq.status).toBe('replied');
  });

  it('sends telegram alert for hot leads', async () => {
    const { sendAlert } = await import('../../src/core/integrations/telegram.js');
    const checkReplies = (await import('../../src/engines/checkReplies.js')).default;
    await checkReplies();
    expect(sendAlert).toHaveBeenCalled();
    const calls = sendAlert.mock.calls.map(c => c[0]);
    const hotAlert = calls.find(c => c.includes('Hot lead') || c.includes('hot'));
    expect(hotAlert).toBeTruthy();
  });

  it('handles unsubscribe replies by adding to reject list', async () => {
    const { callClaude } = await import('../../src/core/ai/claude.js');
    const { callGemini } = await import('../../src/core/ai/gemini.js');
    callClaude.mockResolvedValueOnce({ text: '{"category":"unsubscribe","sentiment":1}', costUsd: 0.001, inputTokens: 50, outputTokens: 5, model: 'claude-haiku-4-5-20251001' });
    callGemini.mockResolvedValueOnce({ text: '{"category":"unsubscribe","sentiment":1}', costUsd: 0.001, inputTokens: 50, outputTokens: 5 });
    const { fetchUnseen } = await import('../../src/core/email/imap.js');
    fetchUnseen.mockResolvedValueOnce([{
      uid: 1,
      from: 'john@acme.com',
      subject: 'Re: stop',
      text: 'Please remove me from your list',
      date: new Date(),
      messageId: '<unsub@test.com>'
    }]);
    fetchUnseen.mockResolvedValueOnce([]);

    const checkReplies = (await import('../../src/engines/checkReplies.js')).default;
    await checkReplies();
    const prisma = getTestPrisma();
    const rejected = await prisma.rejectList.findFirst({ where: { email: 'john@acme.com' } });
    expect(rejected).toBeTruthy();
    expect(rejected.reason).toBe('unsubscribe');
    const seq = await prisma.sequenceState.findFirst({ where: { leadId: 1 } });
    expect(seq.status).toBe('unsubscribed');
  });

  it('handles soft_no by keeping sequence active with delayed next_send_date', async () => {
    const { callClaude } = await import('../../src/core/ai/claude.js');
    const { callGemini } = await import('../../src/core/ai/gemini.js');
    callClaude.mockResolvedValueOnce({ text: '{"category":"soft_no","sentiment":3}', costUsd: 0.001, inputTokens: 50, outputTokens: 5, model: 'claude-haiku-4-5-20251001' });
    callGemini.mockResolvedValueOnce({ text: '{"category":"soft_no","sentiment":3}', costUsd: 0.001, inputTokens: 50, outputTokens: 5 });

    const checkReplies = (await import('../../src/engines/checkReplies.js')).default;
    await checkReplies();
    const prisma = getTestPrisma();
    const seq = await prisma.sequenceState.findFirst({ where: { leadId: 1 } });
    expect(seq.status).toBe('active');
  });

  it('bumps daily_metrics replies count', async () => {
    const checkReplies = (await import('../../src/engines/checkReplies.js')).default;
    await checkReplies();
    const { today } = await import('../../src/core/db/index.js');
    const prisma = getTestPrisma();
    const metrics = await prisma.dailyMetrics.findUnique({ where: { date: today() } });
    expect(metrics).toBeTruthy();
    expect(metrics.repliesTotal).toBeGreaterThanOrEqual(1);
  });

  it('logs to cron_log', async () => {
    const checkReplies = (await import('../../src/engines/checkReplies.js')).default;
    await checkReplies();
    const prisma = getTestPrisma();
    const cronEntries = await prisma.cronLog.findMany({ where: { jobName: 'checkReplies' } });
    expect(cronEntries.length).toBe(1);
    expect(cronEntries[0].status).toBe('success');
  });
});
