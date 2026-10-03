import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from './app.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';

export async function startServer() {
  try {
    await connectDatabase();
  } catch {
    logger.warn('MongoDB is unavailable; starting HTTP server in degraded mode');
  }

  const app = createApp();

  const server = app.listen(env.PORT, () => {
    logger.info('server started', {
      port: env.PORT,
      environment: env.NODE_ENV,
    });
  });

  return server;
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMainModule) {
  void startServer()
    .then((server) => {
      let isShuttingDown = false;
      const shutdown = () => {
        if (isShuttingDown) {
          return;
        }

        isShuttingDown = true;
        server.close(() => {
          void disconnectDatabase().catch(() => {
            logger.error('database disconnect failed');
            process.exitCode = 1;
          });
        });
      };

      process.once('SIGINT', shutdown);
      process.once('SIGTERM', shutdown);
    })
    .catch((error: unknown) => {
      logger.error('server startup failed', {
        message: error instanceof Error ? error.message : 'Unknown startup error',
      });
      process.exitCode = 1;
    });
}
