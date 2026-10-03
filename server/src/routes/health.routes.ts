import { Router } from 'express';

import { env } from '../config/env.js';

export const healthRouter = Router();

healthRouter.get('/health', (_req, res) => {
  res.status(200).json({
    success: true,
    status: 'ok',
    service: 'devpilot-server',
    timestamp: new Date().toISOString(),
    environment: env.NODE_ENV,
  });
});
