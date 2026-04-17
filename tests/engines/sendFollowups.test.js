import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

vi.mock('../../src/core/email/mailer.js', () => ({
  verifyConnections: vi.fn(async () => {}),
  sendMail: vi.fn(async () => ({ messageId: '<followup-123@test.com>' }))
}));
vi.mock('../../src/core/ai/claude.js', () => ({
  callClaude: vi.fn(async () => ({
    text: 'Hey just wanted to check if my last email landed in your inbox. Would love to chat about your website if you have a few minutes this week. Let me know either way and I will stop bugging you.',
    costUsd: 0.001,
    inputTokens: 50,
    outputTokens: 30
  }))
}));
vi.mock('../../src/core/integrations/telegram.js', () => ({ sendAlert: vi.fn(async () => {}) }));
vi.mock('../../src/core/email/contentValidator.js', () => ({ validate: vi.fn(() => ({ valid: true })) }));
vi.mock('../../src/core/lib/sleep.js', () => ({ sleep: vi.fn(async () => {}) }));

let tmpDir;
beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'radar-test-'));
  process.env.DB_PATH = join(tmpDir, 'radar.sqlite');
  process.env.OUTREACH_DOMAIN = 'trysimpleinc.com';
  process.env.INBOX_1_USER = 'darshan@trysimpleinc.com';
  process.env.INBOX_2_USER = 'hello@trysimpleinc.com';
  const { resetDb, initSchema, getDb, seedConfigDefaults } = await import('../../src/core/db/index.js');
  resetDb();
  initSchema();
  seedConfigDefaults();
  const cfgDb = getDb();
  cfgDb.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('daily_send_limit', '10');
  cfgDb.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('send_followups_enabled', '1');
  cfgDb.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('bounce_rate_hard_stop', '0.02');
  cfgDb.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('send_window_start', '0');
  cfgDb.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('send_window_end', '23');
  cfgDb.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('send_delay_min_ms', '1');
  cfgDb.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('send_delay_max_ms', '2');
  // Insert a sent lead with active sequence due today
  getDb().prepare(`
    INSERT INTO leads (id, business_name, contact_email, contact_name, category, icp_priority, icp_score, status)
    VALUES (1, 'Acme', 'john@acme.com', 'John', 'restaurant', 'A', 8, 'sent')
  `).run();
  getDb().prepare(`
    INSERT INTO emails (lead_id, sequence_step, subject, body, hook, status, message_id, inbox_used)
    VALUES (1, 0, 'Quick question', 'Hi John...', 'Your site looks dated.', 'sent', '<original@test.com>', 'darshan@trysimpleinc.com')
  `).run();
  getDb().prepare(`
    INSERT INTO sequence_state (lead_id, current_step, next_send_date, last_message_id, last_subject, status)
    VALUES (1, 0, date('now'), '<original@test.com>', 'Quick question', 'active')
  `).run();
});

afterEach(async () => {
  const { resetDb } = await import('../../src/core/db/index.js');
  resetDb();
  rmSync(tmpDir, { recursive: true });
});

describe('sendFollowups', () => {
  it('sends follow-up for due sequences and advances step', async () => {
    const sendFollowups = (await import('../../src/engines/sendFollowups.js')).default;
    await sendFollowups();
    const { getDb } = await import('../../src/core/db/index.js');

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
    const { getDb } = await import('../../src/core/db/index.js');
    getDb().prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('daily_send_limit', '0');
    const sendFollowups = (await import('../../src/engines/sendFollowups.js')).default;
    await sendFollowups();
    // Only the pre-seeded step-0 email should exist — no follow-ups sent
    const followups = getDb().prepare(`SELECT * FROM emails WHERE sequence_step > 0`).all();
    expect(followups.length).toBe(0);
  });

  it('skips rejected leads and marks sequence as unsubscribed', async () => {
    const { addToRejectList } = await import('../../src/core/db/index.js');
    addToRejectList('john@acme.com', 'unsubscribe');
    const sendFollowups = (await import('../../src/engines/sendFollowups.js')).default;
    await sendFollowups();
    const { getDb } = await import('../../src/core/db/index.js');
    const seq = getDb().prepare(`SELECT * FROM sequence_state WHERE lead_id=1`).get();
    expect(seq.status).toBe('unsubscribed');
    // Only the pre-seeded step-0 email should exist — no follow-ups sent
    const followups = getDb().prepare(`SELECT * FROM emails WHERE sequence_step > 0`).all();
    expect(followups.length).toBe(0);
  });

  it('does not send follow-ups for future sequences', async () => {
    const { getDb } = await import('../../src/core/db/index.js');
    getDb().prepare(`UPDATE sequence_state SET next_send_date = date('now', '+10 days') WHERE lead_id=1`).run();
    const sendFollowups = (await import('../../src/engines/sendFollowups.js')).default;
    await sendFollowups();
    // Only the pre-seeded step-0 email should exist — no follow-ups sent
    const followups = getDb().prepare(`SELECT * FROM emails WHERE sequence_step > 0`).all();
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
    const { getDb } = await import('../../src/core/db/index.js');
    const cronEntries = getDb().prepare(`SELECT * FROM cron_log WHERE job_name='sendFollowups'`).all();
    expect(cronEntries.length).toBe(1);
    expect(cronEntries[0].status).toBe('success');
  });
});
