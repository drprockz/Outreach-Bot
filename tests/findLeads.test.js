import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Mock all external dependencies before any imports that use them
vi.mock('../utils/gemini.js', () => ({
  callGemini: vi.fn(async (prompt) => {
    if (prompt.includes('discover')) {
      return {
        text: JSON.stringify([
          { company: 'Acme Restaurant', website: 'https://acme-restaurant.com', city: 'Mumbai', niche: 'restaurant' },
          { company: 'Beta Salon', website: 'https://betasalon.in', city: 'Pune', niche: 'salon' }
        ]),
        costUsd: 0.001,
        inputTokens: 100,
        outputTokens: 50
      };
    }
    if (prompt.includes('Analyze this business')) {
      // Stages 2-6 extraction response
      return {
        text: JSON.stringify({
          contact_name: 'John Doe',
          contact_email: prompt.includes('acme-restaurant')
            ? 'john@acme-restaurant.com'
            : 'info@betasalon.in',
          cms: 'WordPress',
          business_signals: 'low reviews,no booking,dated design',
          quality_score: 8
        }),
        costUsd: 0.001,
        inputTokens: 100,
        outputTokens: 50
      };
    }
    if (prompt.includes('Score this lead')) {
      // Stage 9 ICP scoring
      return {
        text: JSON.stringify({ icp_score: 7, icp_priority: 'A' }),
        costUsd: 0.001,
        inputTokens: 50,
        outputTokens: 20
      };
    }
    return { text: '{}', costUsd: 0, inputTokens: 0, outputTokens: 0 };
  })
}));

vi.mock('../utils/claude.js', () => ({
  callClaude: vi.fn(async (model, prompt) => {
    if (prompt.includes('ONE sentence')) {
      // Stage 10: hook generation
      return { text: 'Your site looks dated and lacks online booking.', costUsd: 0.002, inputTokens: 200, outputTokens: 30 };
    }
    if (prompt.includes('cold email from Darshan')) {
      // Stage 11: email body
      return {
        text: 'Hi John,\n\nI noticed your website still runs on an older WordPress theme with no online booking. For a busy Mumbai restaurant, that means lost reservations every day.\n\nI build modern, fast websites for food businesses. Would it make sense to chat for ten minutes this week?\n\nBest,\nDarshan',
        costUsd: 0.001,
        inputTokens: 150,
        outputTokens: 60
      };
    }
    if (prompt.includes('subject line')) {
      // Stage 11: subject generation
      return { text: 'quick thought on your website', costUsd: 0.0005, inputTokens: 50, outputTokens: 10 };
    }
    return { text: 'mock response', costUsd: 0, inputTokens: 0, outputTokens: 0 };
  })
}));

vi.mock('../utils/mev.js', () => ({
  verifyEmail: vi.fn(async () => ({ status: 'valid', confidence: 0.9 }))
}));

vi.mock('../utils/telegram.js', () => ({
  sendAlert: vi.fn(async () => {})
}));

let tmpDir;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'radar-test-'));
  process.env.DB_PATH = join(tmpDir, 'radar.sqlite');
  const { resetDb, initSchema } = await import('../utils/db.js');
  resetDb();
  initSchema();
});

afterEach(async () => {
  const { resetDb } = await import('../utils/db.js');
  resetDb();
  rmSync(tmpDir, { recursive: true });
});

describe('findLeads', () => {
  it('runs pipeline and inserts ready leads', async () => {
    const { default: findLeads } = await import('../findLeads.js');
    await findLeads();

    const { getDb } = await import('../utils/db.js');
    const leads = getDb().prepare(`SELECT * FROM leads WHERE status='ready'`).all();

    expect(leads.length).toBeGreaterThan(0);
    expect(leads[0].hook).toBeTruthy();
    expect(leads[0].email_body).toBeTruthy();
    expect(leads[0].email_subject).toBeTruthy();
    expect(leads[0].icp_priority).toBe('A');
    expect(leads[0].contact_email).toBeTruthy();
    expect(leads[0].company).toBeTruthy();
  });

  it('skips leads with invalid emails', async () => {
    const { verifyEmail } = await import('../utils/mev.js');
    verifyEmail.mockResolvedValueOnce({ status: 'invalid', confidence: 0 });
    verifyEmail.mockResolvedValueOnce({ status: 'invalid', confidence: 0 });

    const { default: findLeads } = await import('../findLeads.js');
    await findLeads();

    const { getDb } = await import('../utils/db.js');
    const leads = getDb().prepare(`SELECT * FROM leads`).all();
    expect(leads.length).toBe(0);
  });

  it('sets C-priority leads to nurture status', async () => {
    const { callGemini } = await import('../utils/gemini.js');

    // Override ICP scoring to return C priority
    const originalImpl = callGemini.getMockImplementation();
    callGemini.mockImplementation(async (prompt, opts) => {
      if (prompt.includes('Score this lead')) {
        return {
          text: JSON.stringify({ icp_score: 2, icp_priority: 'C' }),
          costUsd: 0.001,
          inputTokens: 50,
          outputTokens: 20
        };
      }
      // Use default mock for other calls
      return originalImpl(prompt, opts);
    });

    const { default: findLeads } = await import('../findLeads.js');
    await findLeads();

    const { getDb } = await import('../utils/db.js');
    const nurtureLeads = getDb().prepare(`SELECT * FROM leads WHERE status='nurture'`).all();
    expect(nurtureLeads.length).toBeGreaterThan(0);
    // C-priority leads should NOT have hook or email_body (skipped stages 10-11)
    expect(nurtureLeads[0].hook).toBeNull();
    expect(nurtureLeads[0].email_body).toBeNull();
  });

  it('deduplicates leads already in database', async () => {
    // Insert a lead with the same email first
    const { getDb } = await import('../utils/db.js');
    getDb().prepare(`INSERT INTO leads (company, contact_email, status) VALUES (?, ?, ?)`).run(
      'Existing Company', 'john@acme-restaurant.com', 'sent'
    );

    const { default: findLeads } = await import('../findLeads.js');
    await findLeads();

    // Should only have 2 leads: the pre-existing one + the non-duplicate
    const leads = getDb().prepare(`SELECT * FROM leads`).all();
    expect(leads.length).toBe(2); // pre-existing + betasalon (acme is deduplicated)
  });

  it('skips leads in reject list', async () => {
    const { addToRejectList, getDb } = await import('../utils/db.js');
    addToRejectList('john@acme-restaurant.com', 'unsubscribe');
    addToRejectList('info@betasalon.in', 'hard_bounce');

    const { default: findLeads } = await import('../findLeads.js');
    await findLeads();

    const leads = getDb().prepare(`SELECT * FROM leads`).all();
    expect(leads.length).toBe(0);
  });

  it('writes cron_log entries', async () => {
    const { default: findLeads } = await import('../findLeads.js');
    await findLeads();

    const { getDb } = await import('../utils/db.js');
    const cronEntries = getDb().prepare(`SELECT * FROM cron_log WHERE job_name='findLeads'`).all();
    expect(cronEntries.length).toBe(1);
    expect(cronEntries[0].status).toBe('ok');
  });

  it('sends telegram alert on completion', async () => {
    const { sendAlert } = await import('../utils/telegram.js');

    const { default: findLeads } = await import('../findLeads.js');
    await findLeads();

    expect(sendAlert).toHaveBeenCalled();
    const lastCall = sendAlert.mock.calls[sendAlert.mock.calls.length - 1][0];
    expect(lastCall).toContain('findLeads');
  });

  it('logs to daily_metrics', async () => {
    const { default: findLeads } = await import('../findLeads.js');
    await findLeads();

    const { getDb, today } = await import('../utils/db.js');
    const metrics = getDb().prepare(`SELECT * FROM daily_metrics WHERE date=?`).get(today());
    expect(metrics).toBeTruthy();
    expect(metrics.leads_found).toBeGreaterThan(0);
  });
});
