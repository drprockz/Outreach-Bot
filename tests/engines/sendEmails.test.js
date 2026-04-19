import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

vi.mock('../../src/core/email/mailer.js', () => ({
  verifyConnections: vi.fn(async () => {}),
  sendMail: vi.fn(async () => ({ messageId: '<abc@test.com>' }))
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
  // Override with test-friendly values
  const cfgDb = getDb();
  cfgDb.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('daily_send_limit', '10');
  cfgDb.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('send_emails_enabled', '1');
  cfgDb.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('bounce_rate_hard_stop', '0.02');
  cfgDb.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('send_window_start', '0');
  cfgDb.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('send_window_end', '23');
  cfgDb.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('send_delay_min_ms', '1');
  cfgDb.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('send_delay_max_ms', '2');
  // Insert a ready lead with a corresponding pre-generated email in the emails table
  getDb().prepare(`
    INSERT INTO leads (id, business_name, contact_email, contact_name, icp_priority, icp_score, status)
    VALUES (1, 'Acme', 'john@acme.com', 'John', 'A', 80, 'ready')
  `).run();
  getDb().prepare(`
    INSERT INTO emails (lead_id, sequence_step, subject, body, word_count, hook, status)
    VALUES (1, 0, 'Quick question', 'Hi John I noticed your website has not been updated in a few years. I help businesses like yours modernize their web presence quickly. Would you be open to a quick chat about this? Reply to this email and we can find a time. Best regards Darshan', 54, 'Your site looks dated.', 'pending')
  `).run();
});

afterEach(async () => {
  const { resetDb } = await import('../../src/core/db/index.js');
  resetDb();
  rmSync(tmpDir, { recursive: true });
});

describe('sendEmails', () => {
  it('sends emails to ready leads and updates status', async () => {
    const sendEmails = (await import('../../src/engines/sendEmails.js')).default;
    await sendEmails();
    const { getDb } = await import('../../src/core/db/index.js');
    const emails = getDb().prepare(`SELECT * FROM emails WHERE status='sent'`).all();
    expect(emails.length).toBeGreaterThan(0);
    expect(emails[0].message_id).toBe('<abc@test.com>');
    expect(emails[0].sequence_step).toBe(0);
    const lead = getDb().prepare(`SELECT status FROM leads WHERE contact_email='john@acme.com'`).get();
    expect(lead.status).toBe('sent');
  });

  it('initialises sequence_state after sending', async () => {
    const sendEmails = (await import('../../src/engines/sendEmails.js')).default;
    await sendEmails();
    const { getDb } = await import('../../src/core/db/index.js');
    const seq = getDb().prepare(`SELECT * FROM sequence_state`).get();
    expect(seq).toBeTruthy();
    expect(seq.current_step).toBe(0);
    expect(seq.status).toBe('active');
    expect(seq.last_message_id).toBe('<abc@test.com>');
  });

  it('skips when DAILY_SEND_LIMIT is 0', async () => {
    const { getDb } = await import('../../src/core/db/index.js');
    getDb().prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('daily_send_limit', '0');
    const sendEmails = (await import('../../src/engines/sendEmails.js')).default;
    await sendEmails();
    const emails = getDb().prepare(`SELECT * FROM emails WHERE status='sent'`).all();
    expect(emails.length).toBe(0);
  });

  it('skips leads in reject list', async () => {
    const { addToRejectList } = await import('../../src/core/db/index.js');
    addToRejectList('john@acme.com', 'unsubscribe');
    const sendEmails = (await import('../../src/engines/sendEmails.js')).default;
    await sendEmails();
    const { getDb } = await import('../../src/core/db/index.js');
    const emails = getDb().prepare(`SELECT * FROM emails WHERE status='sent'`).all();
    expect(emails.length).toBe(0);
  });

  it('respects daily send limit', async () => {
    // Insert a second ready lead
    const { getDb } = await import('../../src/core/db/index.js');
    getDb().prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('daily_send_limit', '1');
    getDb().prepare(`
      INSERT INTO leads (id, business_name, contact_email, contact_name, icp_priority, icp_score, status)
      VALUES (2, 'Beta', 'jane@beta.com', 'Jane', 'A', 90, 'ready')
    `).run();
    getDb().prepare(`
      INSERT INTO emails (lead_id, sequence_step, subject, body, word_count, hook, status)
      VALUES (2, 0, 'Your website', 'Hi Jane I noticed your website has not been updated in a few years. I help businesses like yours modernize their web presence quickly. Would you be open to a quick chat about this? Reply to this email and we can find a time. Best regards Darshan', 54, 'Your site looks old.', 'pending')
    `).run();

    const sendEmails = (await import('../../src/engines/sendEmails.js')).default;
    await sendEmails();
    const emails = getDb().prepare(`SELECT * FROM emails WHERE status='sent'`).all();
    expect(emails.length).toBe(1);
  });

  it('round-robins between inboxes', async () => {
    const { getDb } = await import('../../src/core/db/index.js');
    getDb().prepare(`
      INSERT INTO leads (id, business_name, contact_email, contact_name, icp_priority, icp_score, status)
      VALUES (2, 'Beta', 'jane@beta.com', 'Jane', 'B', 70, 'ready')
    `).run();
    getDb().prepare(`
      INSERT INTO emails (lead_id, sequence_step, subject, body, word_count, hook, status)
      VALUES (2, 0, 'Your website', 'Hi Jane I noticed your website has not been updated in a few years. I help businesses like yours modernize their web presence quickly. Would you be open to a quick chat about this? Reply to this email and we can find a time. Best regards Darshan', 54, 'Your site looks old.', 'pending')
    `).run();

    const sendEmails = (await import('../../src/engines/sendEmails.js')).default;
    await sendEmails();
    const emails = getDb().prepare(`SELECT * FROM emails ORDER BY id`).all();
    expect(emails.length).toBe(2);
    // Should use different inboxes
    expect(emails[0].inbox_used).not.toBe(emails[1].inbox_used);
  });

  it('logs to cron_log', async () => {
    const sendEmails = (await import('../../src/engines/sendEmails.js')).default;
    await sendEmails();
    const { getDb } = await import('../../src/core/db/index.js');
    const cronEntries = getDb().prepare(`SELECT * FROM cron_log WHERE job_name='sendEmails'`).all();
    expect(cronEntries.length).toBe(1);
    expect(cronEntries[0].status).toBe('success');
    expect(cronEntries[0].records_processed).toBe(1);
  });

  it('bumps daily_metrics emails_sent', async () => {
    const sendEmails = (await import('../../src/engines/sendEmails.js')).default;
    await sendEmails();
    const { getDb, today } = await import('../../src/core/db/index.js');
    const metrics = getDb().prepare(`SELECT * FROM daily_metrics WHERE date=?`).get(today());
    expect(metrics).toBeTruthy();
    expect(metrics.emails_sent).toBe(1);
  });
});
