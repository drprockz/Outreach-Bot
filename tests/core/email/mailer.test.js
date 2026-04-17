import { describe, it, expect, vi } from 'vitest';

vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({
      verify: vi.fn(async () => true),
      sendMail: vi.fn(async (opts) => ({ messageId: '<test@test.com>' }))
    }))
  }
}));

describe('mailer', () => {
  it('sendMail returns messageId', async () => {
    process.env.INBOX_1_USER = 'darshan@trysimpleinc.com';
    process.env.INBOX_1_PASS = 'testpass';
    process.env.INBOX_2_USER = 'hello@trysimpleinc.com';
    process.env.INBOX_2_PASS = 'testpass2';
    process.env.SMTP_HOST = 'smtp.gmail.com';
    process.env.SMTP_PORT = '587';
    process.env.OUTREACH_DOMAIN = 'trysimpleinc.com';
    const { sendMail } = await import('../../utils/mailer.js');
    const result = await sendMail(1, {
      to: 'test@example.com',
      subject: 'Test subject',
      text: 'Test body'
    });
    expect(result.messageId).toBeTruthy();
  });

  it('verifyConnections resolves without throwing', async () => {
    const { verifyConnections } = await import('../../utils/mailer.js');
    await expect(verifyConnections()).resolves.not.toThrow();
  });
});
