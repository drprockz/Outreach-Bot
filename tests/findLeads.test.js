import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Mock all external dependencies before any imports that use them
vi.mock('../utils/gemini.js', () => ({
  callGemini: vi.fn(async (prompt) => {
    if (prompt.toLowerCase().includes('discover')) {
      return {
        text: JSON.stringify([
          { business_name: 'Acme Restaurant', website_url: 'https://acme-restaurant.com', city: 'Mumbai', category: 'restaurant' },
          { business_name: 'Beta Salon', website_url: 'https://betasalon.in', city: 'Pune', category: 'salon' }
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
          owner_name: 'John Doe',
          owner_role: 'Founder',
          contact_email: prompt.includes('acme-restaurant')
            ? 'john@acme-restaurant.com'
            : 'info@betasalon.in',
          contact_confidence: 'medium',
          contact_source: 'pattern guess',
          tech_stack: ['WordPress', 'jQuery'],
          website_problems: ['outdated design', 'no online booking'],
          last_updated: '2022',
          has_ssl: 1,
          has_analytics: 0,
          business_signals: ['low reviews', 'no booking', 'dated design'],
          social_active: 1,
          website_quality_score: 4,
          judge_reason: 'Outdated WordPress site with no booking system'
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
  const { seedConfigDefaults, seedNichesAndIcpRules, getDb } = await import('../utils/db.js');
  seedConfigDefaults();
  seedNichesAndIcpRules();
  // Override: set enough batches/seeds for the test mock
  getDb().prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('find_leads_batches', '1');
  getDb().prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('find_leads_per_batch', '2');
  getDb().prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('find_leads_enabled', '1');
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
    expect(leads[0].icp_priority).toBe('A');
    expect(leads[0].contact_email).toBeTruthy();
    expect(leads[0].business_name).toBeTruthy();

    // Hook, subject, body are now on the emails table, not leads
    const emails = getDb().prepare(`SELECT * FROM emails WHERE lead_id=?`).all(leads[0].id);
    expect(emails.length).toBeGreaterThan(0);
    expect(emails[0].hook).toBeTruthy();
    expect(emails[0].body).toBeTruthy();
    expect(emails[0].subject).toBeTruthy();
  });

  it('skips leads with invalid emails', async () => {
    const { verifyEmail } = await import('../utils/mev.js');
    verifyEmail.mockResolvedValueOnce({ status: 'invalid', confidence: 0 });
    verifyEmail.mockResolvedValueOnce({ status: 'invalid', confidence: 0 });

    const { default: findLeads } = await import('../findLeads.js');
    await findLeads();

    const { getDb } = await import('../utils/db.js');
    // Invalid email leads are still inserted with status='email_invalid' for tracking
    const readyLeads = getDb().prepare(`SELECT * FROM leads WHERE status='ready'`).all();
    expect(readyLeads.length).toBe(0);
    // All leads should be marked as email_invalid
    const allLeads = getDb().prepare(`SELECT * FROM leads`).all();
    expect(allLeads.every(l => l.status === 'email_invalid')).toBe(true);
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
    // C-priority leads should NOT have emails generated (skipped stages 10-11)
    const emails = getDb().prepare(`SELECT * FROM emails WHERE lead_id=?`).all(nurtureLeads[0].id);
    expect(emails.length).toBe(0);
  });

  it('deduplicates leads already in database', async () => {
    // Insert a lead with the same email first
    const { getDb } = await import('../utils/db.js');
    getDb().prepare(`INSERT INTO leads (business_name, contact_email, status) VALUES (?, ?, ?)`).run(
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
    expect(cronEntries[0].status).toBe('success');
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
    expect(metrics.leads_discovered).toBeGreaterThan(0);
  });
});
