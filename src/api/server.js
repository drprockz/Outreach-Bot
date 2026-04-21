import express from 'express';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import 'dotenv/config';

import { seedConfigDefaults, seedNichesAndDefaults } from '../core/db/index.js';
import { requireAuth } from './middleware/auth.js';

import authRoutes from './routes/auth.js';
import configRoutes from './routes/config.js';
import nichesRoutes from './routes/niches.js';
import overviewRoutes from './routes/overview.js';
import leadsRoutes from './routes/leads.js';
import funnelRoutes from './routes/funnel.js';
import sendLogRoutes from './routes/sendLog.js';
import repliesRoutes from './routes/replies.js';
import sequencesRoutes from './routes/sequences.js';
import cronStatusRoutes from './routes/cronStatus.js';
import healthRoutes from './routes/health.js';
import costsRoutes from './routes/costs.js';
import errorsRoutes from './routes/errors.js';
import offerRoutes from './routes/offer.js';
import icpProfileRoutes from './routes/icpProfile.js';
import runEngineRoutes from './routes/runEngine.js';
import enginesRoutes from './routes/engines.js';
import engineGuardrailsRoutes from './routes/engineGuardrails.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');

const app = express();
app.use(express.json());

// Schema is applied via prisma migrations; seeds are idempotent (createMany skipDuplicates
// + upserts) and safe to run on every boot. In the test environment we skip seeding so
// tests can control their own seed state via tests/helpers/testDb.js.
// Probes each config consumer and warns which keys are still falling back to
// .env / hardcoded values. Goal: once every fallback set is empty for 7 days,
// the .env duplicates can be deleted safely (spec §5.2, §10 risk row).
export async function reportConfigFallbacks() {
  const fallbacks = [];
  try {
    const { validate, getFellBackKeys } = await import('../core/email/contentValidator.js');
    // Fire a probe to populate the fallback set
    await validate('probe', 'one two three four five six', 0).catch(() => {});
    fallbacks.push(...getFellBackKeys());
  } catch { /* probe failed — treat as inconclusive */ }
  try {
    const { loadHolidays, didFallbackHolidays } = await import('../engines/sendEmails.js');
    if (loadHolidays) await loadHolidays().catch(() => {});
    if (typeof didFallbackHolidays === 'function' && didFallbackHolidays()) fallbacks.push('send_holidays');
  } catch { /* sendEmails import failed — ignore */ }
  try {
    const { loadSizePrompts, didFallbackSizePrompts } = await import('../engines/findLeads.js');
    if (loadSizePrompts) await loadSizePrompts().catch(() => {});
    if (typeof didFallbackSizePrompts === 'function' && didFallbackSizePrompts()) fallbacks.push('findleads_size_prompts');
  } catch { /* findLeads import failed — ignore */ }
  try {
    const { buildCheckRepliesSchedule, didFallbackCheckRepliesInterval } = await import('../scheduler/cron.js');
    if (buildCheckRepliesSchedule) await buildCheckRepliesSchedule().catch(() => {});
    if (typeof didFallbackCheckRepliesInterval === 'function' && didFallbackCheckRepliesInterval()) {
      fallbacks.push('check_replies_interval_minutes');
    }
  } catch { /* cron import is side-effectful — skip if it fails */ }
  if (fallbacks.length > 0) {
    console.warn(`[config fallback] Still reading from .env/hardcoded for: ${fallbacks.join(', ')}`);
  }
  return fallbacks;
}

if (process.env.NODE_ENV !== 'test') {
  (async () => {
    try {
      await seedConfigDefaults();
      await seedNichesAndDefaults();
      await reportConfigFallbacks();
    } catch (err) {
      console.error('seed failed:', err);
    }
  })();
}

// Auth-free routes
app.use('/api/auth', authRoutes);

// All routes below require a valid JWT
app.use('/api', requireAuth);

app.use('/api/config', configRoutes);
app.use('/api/niches', nichesRoutes);
app.use('/api/overview', overviewRoutes);
app.use('/api/leads', leadsRoutes);
app.use('/api/funnel', funnelRoutes);
app.use('/api/send-log', sendLogRoutes);
app.use('/api/replies', repliesRoutes);
app.use('/api/sequences', sequencesRoutes);
app.use('/api/cron-status', cronStatusRoutes);
app.use('/api/health', healthRoutes);
app.use('/api/costs', costsRoutes);
app.use('/api/errors', errorsRoutes);
app.use('/api/offer', offerRoutes);
app.use('/api/icp-profile', icpProfileRoutes);
app.use('/api/run-engine', runEngineRoutes);
// Aggregate list first so GET /api/engines matches; guardrails router handles
// /api/engines/:engineName/guardrails (non-overlapping path, falls through).
app.use('/api/engines', enginesRoutes);
app.use('/api/engines', engineGuardrailsRoutes);

// Serve the built web SPA (web/dist) if it exists
const distPath = join(repoRoot, 'web/dist');
if (existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(join(distPath, 'index.html'));
  });
}

if (process.env.NODE_ENV !== 'test') {
  const port = parseInt(process.env.DASHBOARD_PORT || '3001');
  app.listen(port, () => {
    console.log(`Radar dashboard running on port ${port}`);
  });
}

export { app };
