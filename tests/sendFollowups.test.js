import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

vi.mock('../utils/mailer.js', () => ({
  verifyConnections: vi.fn(async () => {}),
  sendMail: vi.fn(async () => ({ messageId: '<followup-123@test.com>' }))
}));
vi.mock('../utils/claude.js', () => ({
  callClaude: vi.fn(async () => ({
    text: 'Hey just wanted to check if my last email landed in your inbox. Would love to chat about your website if you have a few minutes this week. Let me know either way and I will stop bugging you.',
    costUsd: 0.001,
    inputTokens: 50,
    outputTokens: 30
  }))
}));
vi.mock('../utils/telegram.js', () => ({ sendAlert: vi.fn(async () => {}) }));
vi.mock('../utils/contentValidator.js', () => ({ validate: vi.fn(() => ({ valid: true })) }));
vi.mock('../utils/sleep.js', () => ({ sleep: vi.fn(async () => {}) }));

let tmpDir;
beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'radar-test-'));
  process.env.DB_PATH = join(tmpDir, 'radar.sqlite');
  process.env.DAILY_SEND_LIMIT = '10';
  process.env.OUTREACH_DOMAIN = 'trysimpleinc.com';
  process.env.BOUNCE_RATE_HARD_STOP = '0.02';
  process.env.INBOX_1_USER = 'darshan@trysimpleinc.com';
  process.env.INBOX_2_USER = 'hello@trysimpleinc.com';
  const { resetDb, initSchema, getDb } = await import('../utils/db.js');
  resetDb();
  initSchema();
  // Insert a contacted lead with active sequence due today
  getDb().prepare(`
    INSERT INTO leads (id, company, contact_email, contact_name, niche, icp_priority, icp_score, email_subject, email_body, hook, status)
    VALUES (1, 'Acme', 'john@acme.com', 'John', 'restaurant', 'A', 8, 'Quick question', 'Hi John...', 'Your site looks dated.', 'contacted')
  `).run();
  getDb().prepare(`
    INSERT INTO sequence_state (lead_id, current_step, next_send_at, last_message_id, status)
    VALUES (1, 0, date('now'), '<original@test.com>', 'active')
  `).run();
});

afterEach(async () => {
  const { resetDb } = await import('../utils/db.js');
  resetDb();
  rmSync(tmpDir, { recursive: true });
});

describe('sendFollowups', () => {
  it('sends follow-up for due sequences and advances step', async () => {
    const sendFollowups = (await import('../sendFollowups.js')).default;
    await sendFollowups();
    const { getDb } = await import('../utils/db.js');

    // Email should be sent
    const emails = getDb().prepare(`SELECT * FROM emails WHERE sequence_step=1`).all();
    expect(emails.length).toBe(1);
    expect(emails[0].status).toBe('sent');
    expect(emails[0].subject).toBe('Re: Quick question');
    expect(emails[0].message_id).toBe('<followup-123@test.com>');

    // Sequence state should advance
    const seq = getDb().prepare(`SELECT * FROM sequence_state WHERE lead_id=1`).get();
    expect(seq.current_step).toBe(1);
    expect(seq.status).toBe('active');
    expect(seq.last_message_id).toBe('<followup-123@test.com>');
  });

  it('skips when DAILY_SEND_LIMIT is 0', async () => {
    process.env.DAILY_SEND_LIMIT = '0';
    const sendFollowups = (await import('../sendFollowups.js')).default;
    await sendFollowups();
    const { getDb } = await import('../utils/db.js');
    const emails = getDb().prepare(`SELECT * FROM emails`).all();
    expect(emails.length).toBe(0);
  });

  it('skips rejected leads and marks sequence as unsubscribed', async () => {
    const { addToRejectList } = await import('../utils/db.js');
    addToRejectList('john@acme.com', 'unsubscribe');
    const sendFollowups = (await import('../sendFollowups.js')).default;
    await sendFollowups();
    const { getDb } = await import('../utils/db.js');
    const seq = getDb().prepare(`SELECT * FROM sequence_state WHERE lead_id=1`).get();
    expect(seq.status).toBe('unsubscribed');
    const emails = getDb().prepare(`SELECT * FROM emails`).all();
    expect(emails.length).toBe(0);
  });

  it('does not send follow-ups for future sequences', async () => {
    const { getDb } = await import('../utils/db.js');
    getDb().prepare(`UPDATE sequence_state SET next_send_at = date('now', '+10 days') WHERE lead_id=1`).run();
    const sendFollowups = (await import('../sendFollowups.js')).default;
    await sendFollowups();
    const emails = getDb().prepare(`SELECT * FROM emails`).all();
    expect(emails.length).toBe(0);
  });

  it('uses threading headers for steps 1-3', async () => {
    const { sendMail } = await import('../utils/mailer.js');
    const sendFollowups = (await import('../sendFollowups.js')).default;
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
    const sendFollowups = (await import('../sendFollowups.js')).default;
    await sendFollowups();
    const { getDb } = await import('../utils/db.js');
    const cronEntries = getDb().prepare(`SELECT * FROM cron_log WHERE job_name='sendFollowups'`).all();
    expect(cronEntries.length).toBe(1);
    expect(cronEntries[0].status).toBe('ok');
  });
});
