import { PrismaClient } from '@prisma/client';
import 'dotenv/config';

let _prisma;

export function getPrisma() {
  if (!_prisma) {
    _prisma = new PrismaClient();
  }
  return _prisma;
}

// Convenience: `import { prisma } from '...'` — same instance as getPrisma()
export const prisma = new Proxy({}, {
  get(_t, prop) { return getPrisma()[prop]; },
});

/** For tests only */
export async function resetDb() {
  if (_prisma) { await _prisma.$disconnect(); _prisma = null; }
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

async function ensureDailyMetricsRow(date) {
  await getPrisma().dailyMetrics.upsert({
    where: { date },
    create: { date },
    update: {},
  });
}

export async function bumpMetric(field, amount = 1) {
  const d = today();
  await ensureDailyMetricsRow(d);
  await getPrisma().dailyMetrics.update({
    where: { date: d },
    data: { [field]: { increment: amount } },
  });
}

// Consolidated cost-metric helper — always bumps the named field AND totalApiCostUsd
export async function bumpCostMetric(field, amountUsd) {
  const d = today();
  await ensureDailyMetricsRow(d);
  await getPrisma().dailyMetrics.update({
    where: { date: d },
    data: {
      [field]: { increment: amountUsd },
      totalApiCostUsd: { increment: amountUsd },
    },
  });
}

export async function logError(source, err, { jobName, errorType, errorCode, leadId, emailId } = {}) {
  await getPrisma().errorLog.create({
    data: {
      source,
      jobName: jobName ?? null,
      errorType: errorType ?? null,
      errorCode: errorCode ?? null,
      errorMessage: err?.message || String(err),
      stackTrace: err?.stack ?? null,
      leadId: leadId ?? null,
      emailId: emailId ?? null,
    },
  });
}

export async function logCron(jobName) {
  const now = new Date();
  const row = await getPrisma().cronLog.create({
    data: { jobName, scheduledAt: now, startedAt: now, status: 'running' },
    select: { id: true },
  });
  return row.id;
}

export async function finishCron(id, { status = 'success', recordsProcessed = 0, recordsSkipped = 0, costUsd = 0, error = null } = {}) {
  const row = await getPrisma().cronLog.findUnique({ where: { id }, select: { startedAt: true } });
  const durationMs = row?.startedAt ? Date.now() - row.startedAt.getTime() : null;
  await getPrisma().cronLog.update({
    where: { id },
    data: {
      completedAt: new Date(),
      durationMs,
      status,
      recordsProcessed,
      recordsSkipped,
      costUsd,
      errorMessage: error,
    },
  });
}

export async function isRejected(email) {
  const domain = email.split('@')[1];
  const row = await getPrisma().rejectList.findFirst({
    where: { OR: [{ email }, { domain }] },
    select: { id: true },
  });
  return !!row;
}

export async function addToRejectList(email, reason) {
  const domain = email.split('@')[1];
  await getPrisma().rejectList.upsert({
    where: { email },
    create: { email, domain, reason },
    update: {},
  });
}

export async function todaySentCount() {
  const row = await getPrisma().dailyMetrics.findUnique({
    where: { date: today() },
    select: { emailsSent: true },
  });
  return row?.emailsSent || 0;
}

export async function todayBounceRate() {
  const row = await getPrisma().dailyMetrics.findUnique({
    where: { date: today() },
    select: { emailsSent: true, emailsHardBounced: true },
  });
  if (!row || row.emailsSent === 0) return 0;
  return row.emailsHardBounced / row.emailsSent;
}

export async function getConfigMap() {
  try {
    const rows = await getPrisma().config.findMany();
    return Object.fromEntries(rows.map(r => [r.key, r.value]));
  } catch {
    return {};
  }
}

export function getConfigInt(cfg, key, fallback) {
  const v = parseInt(cfg[key]);
  return isNaN(v) ? fallback : v;
}

export function getConfigFloat(cfg, key, fallback) {
  const v = parseFloat(cfg[key]);
  return isNaN(v) ? fallback : v;
}

export function getConfigStr(cfg, key, fallback) {
  return cfg[key] ?? fallback;
}

export async function seedConfigDefaults() {
  const defaults = [
    ['daily_send_limit', '0'],
    ['max_per_inbox', '17'],
    ['send_delay_min_ms', '180000'],
    ['send_delay_max_ms', '420000'],
    ['send_window_start', '9'],
    ['send_window_end', '17'],
    ['bounce_rate_hard_stop', '0.02'],
    ['claude_daily_spend_cap', '3.00'],
    ['find_leads_enabled', '1'],
    ['send_emails_enabled', '1'],
    ['send_followups_enabled', '1'],
    ['check_replies_enabled', '1'],
    ['icp_threshold_a', '70'],
    ['icp_threshold_b', '40'],
    ['icp_weights', JSON.stringify({ firmographic: 20, problem: 20, intent: 15, tech: 15, economic: 15, buying: 15 })],
    ['find_leads_per_batch', '30'],
    ['find_leads_cities', '["Mumbai","Bangalore","Delhi NCR","Pune"]'],
    ['find_leads_business_size', 'msme'],
    ['find_leads_count', '150'],
    ['persona_name', 'Darshan Parmar'],
    ['persona_role', 'Full-Stack Developer'],
    ['persona_company', 'Simple Inc'],
    ['persona_website', 'simpleinc.in'],
    ['persona_tone', 'professional but direct'],
    ['persona_services', 'Full-stack web development, redesigns, performance optimisation, custom React apps, API integrations'],

    // Orphan settings migrated from .env/hardcoded (spec §5.2)
    ['spam_words', JSON.stringify(
      (process.env.SPAM_WORDS || '').split(',').map(s => s.trim()).filter(Boolean)
    )],
    ['email_min_words', process.env.MIN_EMAIL_WORDS || '40'],
    ['email_max_words', process.env.MAX_EMAIL_WORDS || '90'],
    ['send_holidays', JSON.stringify([
      // MM-DD. Mirrors the prior hardcoded list in sendEmails.js.
      '01-26',
      '03-14', '03-15',
      '08-15',
      '10-02',
      '10-20', '10-21', '10-22', '10-23', '10-24', '10-25', '10-26',
    ])],
    ['findleads_size_prompts', JSON.stringify({
      msme:  'Target ONLY micro/small owner-operated businesses — 1–10 employees, turnover under ₹5cr. EXCLUDE listed companies, national brands, unicorns, VC-backed startups, companies with 50+ employees.',
      sme:   'Target ONLY small/medium regional businesses — 10–200 employees, ₹5cr–₹250cr turnover. EXCLUDE listed companies, unicorns, MNCs.',
      both:  'Target MSME/SME businesses only — owner-operated to regional scale, up to 200 employees, under ₹250cr turnover. EXCLUDE listed companies, unicorns, MNCs.',
    })],
    ['check_replies_interval_minutes', '120'],
  ];
  await getPrisma().config.createMany({
    data: defaults.map(([key, value]) => ({ key, value })),
    skipDuplicates: true,
  });

  // ICP v2 one-off upgrade: flip old 0-10 thresholds to 0-100
  const prisma = getPrisma();
  const threshA = await prisma.config.findUnique({ where: { key: 'icp_threshold_a' } });
  if (threshA && Number(threshA.value) <= 10) {
    await prisma.config.update({ where: { key: 'icp_threshold_a' }, data: { value: '70' } });
    await prisma.config.update({ where: { key: 'icp_threshold_b' }, data: { value: '40' } });
  }
}

export async function seedNichesAndDefaults() {
  const prisma = getPrisma();

  if ((await prisma.niche.count()) === 0) {
    await prisma.niche.createMany({
      data: [
        { dayOfWeek: 1, label: 'Shopify/D2C brands',     query: 'India D2C ecommerce brand Shopify outdated website',         sortOrder: 0 },
        { dayOfWeek: 2, label: 'Real estate agencies',   query: 'Mumbai real estate agency property portal outdated website', sortOrder: 1 },
        { dayOfWeek: 3, label: 'Funded startups',        query: 'India funded B2B startup outdated website developer needed', sortOrder: 2 },
        { dayOfWeek: 4, label: 'Restaurants/cafes',      query: 'Mumbai restaurant cafe outdated website no online booking',  sortOrder: 3 },
        { dayOfWeek: 5, label: 'Agencies/consultancies', query: 'Mumbai digital agency overflow web development outsource',   sortOrder: 4 },
        { dayOfWeek: 6, label: 'Healthcare/salons',      query: 'India healthcare salon clinic outdated website no booking',  sortOrder: 5 },
      ],
    });
  }

  // ICP v2 singletons — create empty row if missing
  await prisma.offer.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
  await prisma.icpProfile.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
}
