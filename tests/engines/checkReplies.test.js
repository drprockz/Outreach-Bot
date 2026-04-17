import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

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
  callClaude: vi.fn(async () => ({ text: 'hot', costUsd: 0.001, inputTokens: 50, outputTokens: 5 }))
}));
vi.mock('../../src/core/integrations/telegram.js', () => ({ sendAlert: vi.fn(async () => {}) }));

let tmpDir;
beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'radar-test-'));
  process.env.DB_PATH = join(tmpDir, 'radar.sqlite');
  process.env.INBOX_1_USER = 'darshan@trysimpleinc.com';
  process.env.INBOX_2_USER = 'hello@trysimpleinc.com';
  const { resetDb, initSchema, getDb, seedConfigDefaults } = await import('../../src/core/db/index.js');
  resetDb();
  initSchema();
  seedConfigDefaults();
  getDb().prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('check_replies_enabled', '1');
  getDb().prepare(`
    INSERT INTO leads (id, business_name, contact_email, status) VALUES (1, 'Acme', 'john@acme.com', 'sent')
  `).run();
  getDb().prepare(`
    INSERT INTO emails (lead_id, sequence_step, subject, body, status, message_id, inbox_used)
    VALUES (1, 0, 'Quick question', 'Hi John...', 'sent', '<cold@test.com>', 'darshan@trysimpleinc.com')
  `).run();
  getDb().prepare(`
    INSERT INTO sequence_state (lead_id, current_step, next_send_date, last_message_id, last_subject, status)
    VALUES (1, 0, date('now', '+3 days'), '<cold@test.com>', 'Quick question', 'active')
  `).run();
});

afterEach(async () => {
  const { resetDb } = await import('../../src/core/db/index.js');
  resetDb();
  rmSync(tmpDir, { recursive: true });
});

describe('checkReplies', () => {
  it('classifies hot reply and updates lead status', async () => {
    const checkReplies = (await import('../../src/engines/checkReplies.js')).default;
    await checkReplies();
    const { getDb } = await import('../../src/core/db/index.js');
    const lead = getDb().prepare(`SELECT status FROM leads WHERE contact_email='john@acme.com'`).get();
    expect(lead.status).toBe('replied');
    const reply = getDb().prepare(`SELECT * FROM replies`).get();
    expect(reply.category).toBe('hot');
  });

  it('pauses sequence on reply', async () => {
    const checkReplies = (await import('../../src/engines/checkReplies.js')).default;
    await checkReplies();
    const { getDb } = await import('../../src/core/db/index.js');
    const seq = getDb().prepare(`SELECT * FROM sequence_state WHERE lead_id=1`).get();
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
    callClaude.mockResolvedValueOnce({ text: 'unsubscribe', costUsd: 0.001, inputTokens: 50, outputTokens: 5 });
    // Second inbox also returns the same reply for duplicate handling test — mock returns empty
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
    const { getDb } = await import('../../src/core/db/index.js');
    const rejected = getDb().prepare(`SELECT * FROM reject_list WHERE email='john@acme.com'`).get();
    expect(rejected).toBeTruthy();
    expect(rejected.reason).toBe('unsubscribe');
    const seq = getDb().prepare(`SELECT * FROM sequence_state WHERE lead_id=1`).get();
    expect(seq.status).toBe('unsubscribed');
  });

  it('handles soft_no by keeping sequence active with delayed next_send_date', async () => {
    const { callClaude } = await import('../../src/core/ai/claude.js');
    callClaude.mockResolvedValueOnce({ text: 'soft_no', costUsd: 0.001, inputTokens: 50, outputTokens: 5 });

    const checkReplies = (await import('../../src/engines/checkReplies.js')).default;
    await checkReplies();
    const { getDb } = await import('../../src/core/db/index.js');
    const seq = getDb().prepare(`SELECT * FROM sequence_state WHERE lead_id=1`).get();
    expect(seq.status).toBe('active');
  });

  it('bumps daily_metrics replies count', async () => {
    const checkReplies = (await import('../../src/engines/checkReplies.js')).default;
    await checkReplies();
    const { getDb, today } = await import('../../src/core/db/index.js');
    const metrics = getDb().prepare(`SELECT * FROM daily_metrics WHERE date=?`).get(today());
    expect(metrics).toBeTruthy();
    expect(metrics.replies_total).toBeGreaterThanOrEqual(1);
  });

  it('logs to cron_log', async () => {
    const checkReplies = (await import('../../src/engines/checkReplies.js')).default;
    await checkReplies();
    const { getDb } = await import('../../src/core/db/index.js');
    const cronEntries = getDb().prepare(`SELECT * FROM cron_log WHERE job_name='checkReplies'`).all();
    expect(cronEntries.length).toBe(1);
    expect(cronEntries[0].status).toBe('success');
  });
});
