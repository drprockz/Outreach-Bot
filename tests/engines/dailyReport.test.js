import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

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

let tmpDir;
beforeEach(async () => {
  vi.clearAllMocks();
  tmpDir = mkdtempSync(join(tmpdir(), 'radar-test-'));
  process.env.DB_PATH = join(tmpDir, 'radar.sqlite');
  process.env.OUTREACH_DOMAIN = 'trysimpleinc.com';
  process.env.INBOX_1_USER = 'darshan@trysimpleinc.com';
  process.env.INBOX_1_PASS = 'test';
  const { resetDb, initSchema, getDb, today } = await import('../../src/core/db/index.js');
  resetDb();
  initSchema();
  // Seed some metrics
  const d = today();
  getDb().prepare(`INSERT INTO daily_metrics (date, leads_discovered, emails_sent, replies_total, replies_hot, emails_hard_bounced, total_api_cost_usd) VALUES (?, 25, 10, 3, 1, 0, 0.15)`).run(d);
});

afterEach(async () => {
  const { resetDb } = await import('../../src/core/db/index.js');
  resetDb();
  rmSync(tmpDir, { recursive: true });
});

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
    const { getDb } = await import('../../src/core/db/index.js');
    const cronEntries = getDb().prepare(`SELECT * FROM cron_log WHERE job_name='dailyReport'`).all();
    expect(cronEntries.length).toBe(1);
    expect(cronEntries[0].status).toBe('success');
  });

  it('handles missing metrics gracefully', async () => {
    const { getDb, today } = await import('../../src/core/db/index.js');
    // Delete the seeded metrics to test empty state
    getDb().prepare(`DELETE FROM daily_metrics WHERE date=?`).run(today());
    const dailyReport = (await import('../../src/engines/dailyReport.js')).default;
    await dailyReport();
    // Should still succeed — just report zeros
    const { sendAlert } = await import('../../src/core/integrations/telegram.js');
    expect(sendAlert).toHaveBeenCalled();
    const msg = sendAlert.mock.calls[0][0];
    expect(msg).toContain('Found: 0');
  });
});
