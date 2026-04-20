import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { truncateAll, closeTestPrisma, getTestPrisma } from '../helpers/testDb.js';

vi.mock('../../src/core/email/mailer.js', () => ({
  verifyConnections: vi.fn(async () => {}),
  sendMail: vi.fn(async () => ({ messageId: '<abc@test.com>' }))
}));
vi.mock('../../src/core/integrations/telegram.js', () => ({ sendAlert: vi.fn(async () => {}) }));
vi.mock('../../src/core/email/contentValidator.js', () => ({ validate: vi.fn(() => ({ valid: true })) }));
vi.mock('../../src/core/lib/sleep.js', () => ({ sleep: vi.fn(async () => {}) }));

// Pin system time to a Tuesday 12:00 IST — inSendWindow rejects Sundays + holidays,
// and `new Date()` naturally returns the real system date which is non-deterministic.
// Tue 2026-04-21 06:30 UTC = 12:00 IST, mid-window and not a Sunday/holiday.
beforeEach(async () => {
  // Pin Date only (not all timers — Prisma relies on real setTimeout)
  // Tue 2026-04-21 06:30 UTC = 12:00 IST, mid-window and not Sunday/holiday.
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
  // Override config with test-friendly values
  await prisma.config.update({ where: { key: 'daily_send_limit' }, data: { value: '10' } });
  await prisma.config.update({ where: { key: 'send_emails_enabled' }, data: { value: '1' } });
  await prisma.config.update({ where: { key: 'bounce_rate_hard_stop' }, data: { value: '0.02' } });
  await prisma.config.update({ where: { key: 'send_window_start' }, data: { value: '0' } });
  await prisma.config.update({ where: { key: 'send_window_end' }, data: { value: '23' } });
  await prisma.config.update({ where: { key: 'send_delay_min_ms' }, data: { value: '1' } });
  await prisma.config.update({ where: { key: 'send_delay_max_ms' }, data: { value: '2' } });

  // Insert a ready lead with a corresponding pre-generated email
  await prisma.lead.create({
    data: {
      businessName: 'Acme',
      contactEmail: 'john@acme.com',
      contactName: 'John',
      icpPriority: 'A',
      icpScore: 80,
      status: 'ready',
      emails: {
        create: {
          sequenceStep: 0,
          subject: 'Quick question',
          body: 'Hi John I noticed your website has not been updated in a few years. I help businesses like yours modernize their web presence quickly. Would you be open to a quick chat about this? Reply to this email and we can find a time. Best regards Darshan',
          wordCount: 54,
          hook: 'Your site looks dated.',
          status: 'pending',
        },
      },
    },
  });
});

afterEach(async () => {
  const { resetDb } = await import('../../src/core/db/index.js');
  await resetDb();
  vi.useRealTimers();
});

afterAll(async () => { await closeTestPrisma(); });

describe('sendEmails', () => {
  it('sends emails to ready leads and updates status', async () => {
    const sendEmails = (await import('../../src/engines/sendEmails.js')).default;
    await sendEmails();
    const prisma = getTestPrisma();
    const emails = await prisma.email.findMany({ where: { status: 'sent' } });
    expect(emails.length).toBeGreaterThan(0);
    expect(emails[0].messageId).toBe('<abc@test.com>');
    expect(emails[0].sequenceStep).toBe(0);
    const lead = await prisma.lead.findFirst({ where: { contactEmail: 'john@acme.com' } });
    expect(lead.status).toBe('sent');
  });

  it('initialises sequence_state after sending', async () => {
    const sendEmails = (await import('../../src/engines/sendEmails.js')).default;
    await sendEmails();
    const prisma = getTestPrisma();
    const seq = await prisma.sequenceState.findFirst();
    expect(seq).toBeTruthy();
    expect(seq.currentStep).toBe(0);
    expect(seq.status).toBe('active');
    expect(seq.lastMessageId).toBe('<abc@test.com>');
  });

  it('skips when DAILY_SEND_LIMIT is 0', async () => {
    const prisma = getTestPrisma();
    await prisma.config.update({ where: { key: 'daily_send_limit' }, data: { value: '0' } });
    const sendEmails = (await import('../../src/engines/sendEmails.js')).default;
    await sendEmails();
    const emails = await prisma.email.findMany({ where: { status: 'sent' } });
    expect(emails.length).toBe(0);
  });

  it('skips leads in reject list', async () => {
    const { addToRejectList } = await import('../../src/core/db/index.js');
    await addToRejectList('john@acme.com', 'unsubscribe');
    const sendEmails = (await import('../../src/engines/sendEmails.js')).default;
    await sendEmails();
    const prisma = getTestPrisma();
    const emails = await prisma.email.findMany({ where: { status: 'sent' } });
    expect(emails.length).toBe(0);
  });

  it('respects daily send limit', async () => {
    const prisma = getTestPrisma();
    await prisma.config.update({ where: { key: 'daily_send_limit' }, data: { value: '1' } });
    await prisma.lead.create({
      data: {
        businessName: 'Beta',
        contactEmail: 'jane@beta.com',
        contactName: 'Jane',
        icpPriority: 'A',
        icpScore: 90,
        status: 'ready',
        emails: {
          create: {
            sequenceStep: 0,
            subject: 'Your website',
            body: 'Hi Jane I noticed your website has not been updated in a few years. I help businesses like yours modernize their web presence quickly. Would you be open to a quick chat about this? Reply to this email and we can find a time. Best regards Darshan',
            wordCount: 54,
            hook: 'Your site looks old.',
            status: 'pending',
          },
        },
      },
    });

    const sendEmails = (await import('../../src/engines/sendEmails.js')).default;
    await sendEmails();
    const emails = await prisma.email.findMany({ where: { status: 'sent' } });
    expect(emails.length).toBe(1);
  });

  it('round-robins between inboxes', async () => {
    const prisma = getTestPrisma();
    await prisma.lead.create({
      data: {
        businessName: 'Beta',
        contactEmail: 'jane@beta.com',
        contactName: 'Jane',
        icpPriority: 'B',
        icpScore: 70,
        status: 'ready',
        emails: {
          create: {
            sequenceStep: 0,
            subject: 'Your website',
            body: 'Hi Jane I noticed your website has not been updated in a few years. I help businesses like yours modernize their web presence quickly. Would you be open to a quick chat about this? Reply to this email and we can find a time. Best regards Darshan',
            wordCount: 54,
            hook: 'Your site looks old.',
            status: 'pending',
          },
        },
      },
    });

    const sendEmails = (await import('../../src/engines/sendEmails.js')).default;
    await sendEmails();
    const emails = await prisma.email.findMany({ orderBy: { id: 'asc' } });
    expect(emails.length).toBe(2);
    // Should use different inboxes
    expect(emails[0].inboxUsed).not.toBe(emails[1].inboxUsed);
  });

  it('logs to cron_log', async () => {
    const sendEmails = (await import('../../src/engines/sendEmails.js')).default;
    await sendEmails();
    const prisma = getTestPrisma();
    const cronEntries = await prisma.cronLog.findMany({ where: { jobName: 'sendEmails' } });
    expect(cronEntries.length).toBe(1);
    expect(cronEntries[0].status).toBe('success');
    expect(cronEntries[0].recordsProcessed).toBe(1);
  });

  it('bumps daily_metrics emails_sent', async () => {
    const sendEmails = (await import('../../src/engines/sendEmails.js')).default;
    await sendEmails();
    const { today } = await import('../../src/core/db/index.js');
    const prisma = getTestPrisma();
    const metrics = await prisma.dailyMetrics.findUnique({ where: { date: today() } });
    expect(metrics).toBeTruthy();
    expect(metrics.emailsSent).toBe(1);
  });
});
