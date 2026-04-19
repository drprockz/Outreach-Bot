import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { truncateAll, closeTestPrisma, getTestPrisma } from '../helpers/testDb.js';

vi.mock('../../src/core/email/mailer.js', () => ({
  verifyConnections: vi.fn(async () => {}),
  sendMail: vi.fn(async () => ({ messageId: '<followup-123@test.com>' }))
}));
vi.mock('../../src/core/ai/claude.js', () => ({
  callClaude: vi.fn(async () => ({
    text: 'Hey just wanted to check if my last email landed in your inbox. Would love to chat about your website if you have a few minutes this week. Let me know either way and I will stop bugging you.',
    costUsd: 0.001,
    inputTokens: 50,
    outputTokens: 30,
    model: 'claude-haiku-4-5-20251001'
  }))
}));
vi.mock('../../src/core/integrations/telegram.js', () => ({ sendAlert: vi.fn(async () => {}) }));
vi.mock('../../src/core/email/contentValidator.js', () => ({ validate: vi.fn(() => ({ valid: true })) }));
vi.mock('../../src/core/lib/sleep.js', () => ({ sleep: vi.fn(async () => {}) }));

beforeEach(async () => {
  // Pin Date only — Prisma needs real setTimeout. Tuesday mid-window, not holiday.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-04-21T06:30:00Z'));
  await truncateAll();
  process.env.OUTREACH_DOMAIN = 'trysimpleinc.com';
  process.env.INBOX_1_USER = 'darshan@trysimpleinc.com';
  process.env.INBOX_2_USER = 'hello@trysimpleinc.com';
  const { resetDb, seedConfigDefaults } = await import('../../src/core/db/index.js');
  await resetDb();
  await seedConfigDefaults();

  const prisma = getTestPrisma();
  await prisma.config.update({ where: { key: 'daily_send_limit' }, data: { value: '10' } });
  await prisma.config.update({ where: { key: 'send_followups_enabled' }, data: { value: '1' } });
  await prisma.config.update({ where: { key: 'bounce_rate_hard_stop' }, data: { value: '0.02' } });
  await prisma.config.update({ where: { key: 'send_window_start' }, data: { value: '0' } });
  await prisma.config.update({ where: { key: 'send_window_end' }, data: { value: '23' } });
  await prisma.config.update({ where: { key: 'send_delay_min_ms' }, data: { value: '1' } });
  await prisma.config.update({ where: { key: 'send_delay_max_ms' }, data: { value: '2' } });

  // Insert a sent lead with active sequence due today
  await prisma.lead.create({
    data: {
      id: 1,
      businessName: 'Acme',
      contactEmail: 'john@acme.com',
      contactName: 'John',
      category: 'restaurant',
      icpPriority: 'A',
      icpScore: 80,
      status: 'sent',
      emails: {
        create: {
          sequenceStep: 0,
          subject: 'Quick question',
          body: 'Hi John...',
          hook: 'Your site looks dated.',
          status: 'sent',
          messageId: '<original@test.com>',
          inboxUsed: 'darshan@trysimpleinc.com',
        },
      },
    },
  });
  await prisma.sequenceState.create({
    data: {
      leadId: 1,
      currentStep: 0,
      nextSendDate: new Date(),
      lastMessageId: '<original@test.com>',
      lastSubject: 'Quick question',
      status: 'active',
    },
  });
});

afterEach(async () => {
  const { resetDb } = await import('../../src/core/db/index.js');
  await resetDb();
  vi.useRealTimers();
});

afterAll(async () => { await closeTestPrisma(); });

describe('sendFollowups', () => {
  it('sends follow-up for due sequences and advances step', async () => {
    const sendFollowups = (await import('../../src/engines/sendFollowups.js')).default;
    await sendFollowups();
    const prisma = getTestPrisma();

    const emails = await prisma.email.findMany({ where: { sequenceStep: 1 } });
    expect(emails.length).toBe(1);
    expect(emails[0].status).toBe('sent');
    expect(emails[0].subject).toBe('Re: Quick question');
    expect(emails[0].messageId).toBe('<followup-123@test.com>');

    const seq = await prisma.sequenceState.findUnique({ where: { leadId: 1 } });
    expect(seq.currentStep).toBe(1);
    expect(seq.status).toBe('active');
    expect(seq.lastMessageId).toBe('<followup-123@test.com>');
  });

  it('skips when DAILY_SEND_LIMIT is 0', async () => {
    const prisma = getTestPrisma();
    await prisma.config.update({ where: { key: 'daily_send_limit' }, data: { value: '0' } });
    const sendFollowups = (await import('../../src/engines/sendFollowups.js')).default;
    await sendFollowups();
    const followups = await prisma.email.findMany({ where: { sequenceStep: { gt: 0 } } });
    expect(followups.length).toBe(0);
  });

  it('skips rejected leads and marks sequence as unsubscribed', async () => {
    const { addToRejectList } = await import('../../src/core/db/index.js');
    await addToRejectList('john@acme.com', 'unsubscribe');
    const sendFollowups = (await import('../../src/engines/sendFollowups.js')).default;
    await sendFollowups();
    const prisma = getTestPrisma();
    const seq = await prisma.sequenceState.findUnique({ where: { leadId: 1 } });
    expect(seq.status).toBe('unsubscribed');
    const followups = await prisma.email.findMany({ where: { sequenceStep: { gt: 0 } } });
    expect(followups.length).toBe(0);
  });

  it('does not send follow-ups for future sequences', async () => {
    const prisma = getTestPrisma();
    const tenDaysOut = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    await prisma.sequenceState.update({ where: { leadId: 1 }, data: { nextSendDate: tenDaysOut } });
    const sendFollowups = (await import('../../src/engines/sendFollowups.js')).default;
    await sendFollowups();
    const followups = await prisma.email.findMany({ where: { sequenceStep: { gt: 0 } } });
    expect(followups.length).toBe(0);
  });

  it('uses threading headers for steps 1-3', async () => {
    const { sendMail } = await import('../../src/core/email/mailer.js');
    const sendFollowups = (await import('../../src/engines/sendFollowups.js')).default;
    await sendFollowups();
    expect(sendMail).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({
        inReplyTo: '<original@test.com>',
        references: '<original@test.com>'
      })
    );
  });

  it('logs to cron_log', async () => {
    const sendFollowups = (await import('../../src/engines/sendFollowups.js')).default;
    await sendFollowups();
    const prisma = getTestPrisma();
    const cronEntries = await prisma.cronLog.findMany({ where: { jobName: 'sendFollowups' } });
    expect(cronEntries.length).toBe(1);
    expect(cronEntries[0].status).toBe('success');
  });
});
