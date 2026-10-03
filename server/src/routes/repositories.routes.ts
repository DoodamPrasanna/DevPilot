import { Router } from 'express';

import type { GithubRepositoryClient } from '../clients/github.client.js';
import { githubRepositoryClient } from '../clients/github.client.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { createRateLimitMiddleware } from '../middleware/rate-limit.middleware.js';
import { createRepositoriesController } from '../controllers/repositories.controller.js';
import { env, type AppEnv } from '../config/env.js';
import type { EmbeddingProvider } from '../ai/embedding-provider.js';

export function createRepositoriesRouter(
  configuration: AppEnv = env,
  githubClient: GithubRepositoryClient = githubRepositoryClient,
  embeddingProvider?: EmbeddingProvider,
) {
  const router = Router();
  const controller = createRepositoriesController(githubClient, embeddingProvider);
  const indexingRateLimit = createRateLimitMiddleware({
    bucket: 'repository-indexing',
    limit: 5,
    windowMilliseconds: 60 * 60 * 1000,
  });

  router.use(authMiddleware(configuration));
  router.post('/', controller.create);
  router.get('/', controller.list);
  router.get('/:repositoryId/tree', controller.tree);
  router.get('/:repositoryId/file', controller.file);
  router.post('/:id/index', indexingRateLimit, controller.index);
  router.get('/:id', controller.detail);
  router.delete('/:id', controller.remove);

  return router;
}