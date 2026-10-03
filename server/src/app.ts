import express from 'express';
import cors from 'cors';
import helmet from 'helmet';

import type { GithubRepositoryClient } from './clients/github.client.js';
import type { AIProvider } from './ai/ai-provider.js';
import type { EmbeddingProvider } from './ai/embedding-provider.js';
import { createGeminiEmbeddingProvider } from './ai/gemini-embedding.provider.js';
import { env, loadEnv, type AppEnv } from './config/env.js';
import { errorHandler } from './middleware/error.middleware.js';
import { csrfOriginMiddleware } from './middleware/csrf-origin.middleware.js';
import { notFoundHandler } from './middleware/not-found.middleware.js';
import { createAuthRouter } from './routes/auth.routes.js';
import { createConversationsRouter } from './routes/conversations.routes.js';
import { healthRouter } from './routes/health.routes.js';
import { createRepositoriesRouter } from './routes/repositories.routes.js';
import { logger } from './utils/logger.js';

type AppOptions = {
  env?: Partial<AppEnv>;
  githubClient?: GithubRepositoryClient;
  aiProvider?: AIProvider;
  embeddingProvider?: EmbeddingProvider;
};

export function createApp(options: AppOptions = {}) {
  const runtimeEnv = options.env ? loadEnv({ ...process.env, ...options.env }) : env;
  const app = express();
  if (
    runtimeEnv.NODE_ENV === 'production' &&
    (process.env.RENDER === 'true' || typeof process.env.RENDER_SERVICE_ID === 'string')
  ) {
    app.set('trust proxy', 1);
  }
  const embeddingProvider = options.embeddingProvider ?? createGeminiEmbeddingProvider(
    runtimeEnv.GEMINI_API_KEY,
    runtimeEnv.GEMINI_EMBEDDING_MODEL,
  );

  app.use((req, _res, next) => {
    logger.info('incoming request', { method: req.method, url: req.originalUrl });
    next();
  });

  app.use(
    helmet({
      contentSecurityPolicy: runtimeEnv.NODE_ENV === 'production' ? undefined : false,
    }),
  );

  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || origin === runtimeEnv.FRONTEND_URL) {
          callback(null, true);
          return;
        }

        callback(null, false);
      },
      credentials: true,
    }),
  );

  app.use(express.json({ limit: '1mb' }));

  app.use('/api/v1', csrfOriginMiddleware(runtimeEnv.FRONTEND_URL));
  app.use('/api/v1', healthRouter);
  app.use('/api/v1/auth', createAuthRouter(runtimeEnv));
  app.use('/api/v1/repositories', createRepositoriesRouter(runtimeEnv, options.githubClient, embeddingProvider));
  app.use('/api/v1/conversations', createConversationsRouter(runtimeEnv, options.aiProvider, options.githubClient, embeddingProvider));

  queueMicrotask(() => {
    app.use(notFoundHandler);
    app.use(errorHandler);
  });

  return app;
}

export default createApp();
