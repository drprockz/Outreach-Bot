import { Router } from 'express';
import { requireAuth } from './middleware.js';
import authRouter from './auth.js';
import overviewRouter from './overview.js';
import pipelineRouter from './pipeline.js';
import analyticsRouter from './analytics.js';
import costsRouter from './costs.js';
import reportsRouter from './reports.js';
import emailsRouter from './emails.js';

const api = Router();

// Public
api.use('/auth', authRouter);

// Protected
api.use('/overview', requireAuth, overviewRouter);
api.use('/pipeline', requireAuth, pipelineRouter);
api.use('/analytics', requireAuth, analyticsRouter);
api.use('/costs', requireAuth, costsRouter);
api.use('/reports', requireAuth, reportsRouter);
api.use('/emails', requireAuth, emailsRouter);

export default api;
