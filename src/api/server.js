import express from 'express';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import 'dotenv/config';

import { initSchema, seedConfigDefaults, seedNichesAndIcpRules } from '../core/db/index.js';
import { requireAuth } from './middleware/auth.js';

import authRoutes from './routes/auth.js';
import configRoutes from './routes/config.js';
import nichesRoutes from './routes/niches.js';
import icpRulesRoutes from './routes/icpRules.js';
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');

const app = express();
app.use(express.json());

initSchema();
seedConfigDefaults();
seedNichesAndIcpRules();

// Auth-free routes
app.use('/api/auth', authRoutes);

// All routes below require a valid JWT
app.use('/api', requireAuth);

app.use('/api/config', configRoutes);
app.use('/api/niches', nichesRoutes);
app.use('/api/icp-rules', icpRulesRoutes);
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
