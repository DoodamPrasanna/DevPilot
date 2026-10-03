import { Router } from 'express';

import type { AIProvider } from '../ai/ai-provider.js';
import { createGeminiAIProvider } from '../ai/gemini.provider.js';
import type { GithubRepositoryClient } from '../clients/github.client.js';
import type { EmbeddingProvider } from '../ai/embedding-provider.js';
import { githubRepositoryClient } from '../clients/github.client.js';
import { env, type AppEnv } from '../config/env.js';
import { createConversationsController } from '../controllers/conversations.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { createRateLimitMiddleware } from '../middleware/rate-limit.middleware.js';

export function createConversationsRouter(
  configuration: AppEnv = env,
  provider: AIProvider = createGeminiAIProvider({
    apiKey: configuration.GEMINI_API_KEY,
    model: configuration.GEMINI_MODEL,
  }),
  githubClient: GithubRepositoryClient = githubRepositoryClient,
  embeddingProvider?: EmbeddingProvider,
) {
  const router = Router();
  const controller = createConversationsController(provider, githubClient, embeddingProvider);

  router.use(authMiddleware(configuration));
  const aiRateLimit = createRateLimitMiddleware({
    bucket: 'ai',
    limit: 12,
    windowMilliseconds: 15 * 60 * 1000,
  });
  router.post('/', controller.create);
  router.get('/', controller.list);
  router.post('/:conversationId/messages', aiRateLimit, controller.sendMessage);
  router.post('/:conversationId/analyze', aiRateLimit, controller.analyze);
  router.post('/:conversationId/tests', aiRateLimit, controller.generateTests);
  router.get('/:conversationId', controller.detail);

  return router;
}