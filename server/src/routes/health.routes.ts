import { Router } from 'express';

import { getDatabaseStatus } from '../config/database.js';
import { env } from '../config/env.js';

export const healthRouter = Router();

healthRouter.get('/health', (_req, res) => {
  res.status(200).json({
    success: true,
    status: 'ok',
    service: 'devpilot-server',
    database: getDatabaseStatus(),
    timestamp: new Date().toISOString(),
    environment: env.NODE_ENV,
  });
});
