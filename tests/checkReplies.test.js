import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

vi.mock('../utils/imap.js', () => ({
  fetchUnseen: vi.fn(async () => [{
    uid: 1,
    from: 'john@acme.com',
    subject: 'Re: your email',
    text: 'Sounds interesting, let me know your rate',
    date: new Date(),
    messageId: '<reply@test.com>'
  }])
}));
vi.mock('../utils/claude.js', () => ({
  callClaude: vi.fn(async () => ({ text: 'hot', costUsd: 0.001, inputTokens: 50, outputTokens: 5 }))
}));
vi.mock('../utils/telegram.js', () => ({ sendAlert: vi.fn(async () => {}) }));

let tmpDir;
beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'radar-test-'));
  process.env.DB_PATH = join(tmpDir, 'radar.sqlite');
  process.env.INBOX_1_USER = 'darshan@trysimpleinc.com';
  process.env.INBOX_2_USER = 'hello@trysimpleinc.com';
  const { resetDb, initSchema, getDb } = await import('../utils/db.js');
  resetDb();
  initSchema();
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
  const { resetDb } = await import('../utils/db.js');
  resetDb();
  rmSync(tmpDir, { recursive: true });
});

describe('checkReplies', () => {
  it('classifies hot reply and updates lead status', async () => {
    const checkReplies = (await import('../checkReplies.js')).default;
    await checkReplies();
    const { getDb } = await import('../utils/db.js');
    const lead = getDb().prepare(`SELECT status FROM leads WHERE contact_email='john@acme.com'`).get();
    expect(lead.status).toBe('replied');
    const reply = getDb().prepare(`SELECT * FROM replies`).get();
    expect(reply.category).toBe('hot');
  });

  it('pauses sequence on reply', async () => {
    const checkReplies = (await import('../checkReplies.js')).default;
    await checkReplies();
    const { getDb } = await import('../utils/db.js');
    const seq = getDb().prepare(`SELECT * FROM sequence_state WHERE lead_id=1`).get();
    expect(seq.status).toBe('replied');
  });

  it('sends telegram alert for hot leads', async () => {
    const { sendAlert } = await import('../utils/telegram.js');
    const checkReplies = (await import('../checkReplies.js')).default;
    await checkReplies();
    expect(sendAlert).toHaveBeenCalled();
    const calls = sendAlert.mock.calls.map(c => c[0]);
    const hotAlert = calls.find(c => c.includes('Hot lead') || c.includes('hot'));
    expect(hotAlert).toBeTruthy();
  });

  it('handles unsubscribe replies by adding to reject list', async () => {
    const { callClaude } = await import('../utils/claude.js');
    callClaude.mockResolvedValueOnce({ text: 'unsubscribe', costUsd: 0.001, inputTokens: 50, outputTokens: 5 });
    // Second inbox also returns the same reply for duplicate handling test — mock returns empty
    const { fetchUnseen } = await import('../utils/imap.js');
    fetchUnseen.mockResolvedValueOnce([{
      uid: 1,
      from: 'john@acme.com',
      subject: 'Re: stop',
      text: 'Please remove me from your list',
      date: new Date(),
      messageId: '<unsub@test.com>'
    }]);
    fetchUnseen.mockResolvedValueOnce([]);

    const checkReplies = (await import('../checkReplies.js')).default;
    await checkReplies();
    const { getDb } = await import('../utils/db.js');
    const rejected = getDb().prepare(`SELECT * FROM reject_list WHERE email='john@acme.com'`).get();
    expect(rejected).toBeTruthy();
    expect(rejected.reason).toBe('unsubscribe');
    const seq = getDb().prepare(`SELECT * FROM sequence_state WHERE lead_id=1`).get();
    expect(seq.status).toBe('unsubscribed');
  });

  it('handles soft_no by pausing sequence', async () => {
    const { callClaude } = await import('../utils/claude.js');
    callClaude.mockResolvedValueOnce({ text: 'soft_no', costUsd: 0.001, inputTokens: 50, outputTokens: 5 });

    const checkReplies = (await import('../checkReplies.js')).default;
    await checkReplies();
    const { getDb } = await import('../utils/db.js');
    const seq = getDb().prepare(`SELECT * FROM sequence_state WHERE lead_id=1`).get();
    expect(seq.status).toBe('paused');
  });

  it('bumps daily_metrics replies count', async () => {
    const checkReplies = (await import('../checkReplies.js')).default;
    await checkReplies();
    const { getDb, today } = await import('../utils/db.js');
    const metrics = getDb().prepare(`SELECT * FROM daily_metrics WHERE date=?`).get(today());
    expect(metrics).toBeTruthy();
    expect(metrics.replies_total).toBeGreaterThanOrEqual(1);
  });

  it('logs to cron_log', async () => {
    const checkReplies = (await import('../checkReplies.js')).default;
    await checkReplies();
    const { getDb } = await import('../utils/db.js');
    const cronEntries = getDb().prepare(`SELECT * FROM cron_log WHERE job_name='checkReplies'`).all();
    expect(cronEntries.length).toBe(1);
    expect(cronEntries[0].status).toBe('success');
  });
});
