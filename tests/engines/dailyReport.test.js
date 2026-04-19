import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { truncateAll, closeTestPrisma, getTestPrisma } from '../helpers/testDb.js';

vi.mock('../../src/core/email/mailer.js', () => ({
  sendMail: vi.fn(async () => ({ messageId: '<report@test.com>' }))
}));
vi.mock('../../src/core/integrations/telegram.js', () => ({ sendAlert: vi.fn(async () => {}) }));

const mockSendMail = vi.fn(async () => ({ messageId: '<report@test.com>' }));
vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: mockSendMail
    }))
  }
}));

beforeEach(async () => {
  vi.clearAllMocks();
  await truncateAll();
  process.env.OUTREACH_DOMAIN = 'trysimpleinc.com';
  process.env.INBOX_1_USER = 'darshan@trysimpleinc.com';
  process.env.INBOX_1_PASS = 'test';
  const { resetDb, today } = await import('../../src/core/db/index.js');
  await resetDb();
  // Seed some metrics
  const d = today();
  const prisma = getTestPrisma();
  await prisma.dailyMetrics.create({
    data: {
      date: d,
      leadsDiscovered: 25,
      emailsSent: 10,
      repliesTotal: 3,
      repliesHot: 1,
      emailsHardBounced: 0,
      totalApiCostUsd: 0.15,
    },
  });
});

afterEach(async () => {
  const { resetDb } = await import('../../src/core/db/index.js');
  await resetDb();
});

afterAll(async () => { await closeTestPrisma(); });

describe('dailyReport', () => {
  it('sends telegram summary', async () => {
    const { sendAlert } = await import('../../src/core/integrations/telegram.js');
    const dailyReport = (await import('../../src/engines/dailyReport.js')).default;
    await dailyReport();
    expect(sendAlert).toHaveBeenCalled();
    const msg = sendAlert.mock.calls[0][0];
    expect(msg).toContain('Found: 25');
    expect(msg).toContain('Sent: 10');
    expect(msg).toContain('Replied: 3');
  });

  it('attempts to send email digest', async () => {
    const dailyReport = (await import('../../src/engines/dailyReport.js')).default;
    await dailyReport();
    expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'darshan@simpleinc.in',
      subject: expect.stringContaining('Radar Report')
    }));
  });

  it('logs to cron_log', async () => {
    const dailyReport = (await import('../../src/engines/dailyReport.js')).default;
    await dailyReport();
    const prisma = getTestPrisma();
    const cronEntries = await prisma.cronLog.findMany({ where: { jobName: 'dailyReport' } });
    expect(cronEntries.length).toBe(1);
    expect(cronEntries[0].status).toBe('success');
  });

  it('handles missing metrics gracefully', async () => {
    const { today } = await import('../../src/core/db/index.js');
    const prisma = getTestPrisma();
    // Delete the seeded metrics to test empty state
    await prisma.dailyMetrics.delete({ where: { date: today() } });
    const dailyReport = (await import('../../src/engines/dailyReport.js')).default;
    await dailyReport();
    // Should still succeed — just report zeros
    const { sendAlert } = await import('../../src/core/integrations/telegram.js');
    expect(sendAlert).toHaveBeenCalled();
    const msg = sendAlert.mock.calls[0][0];
    expect(msg).toContain('Found: 0');
  });
});
