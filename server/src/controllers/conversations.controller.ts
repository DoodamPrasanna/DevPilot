import type { Request, RequestHandler } from 'express';

import type { AIProvider } from '../ai/ai-provider.js';
import type { GithubRepositoryClient } from '../clients/github.client.js';
import type { EmbeddingProvider } from '../ai/embedding-provider.js';
import type { AuthenticatedUser } from '../types/authenticated-user.js';
import { AppError } from '../utils/app-error.js';
import { logger } from '../utils/logger.js';
import { validateRequest } from '../utils/validate.js';
import {
  createConversation,
  getUserConversation,
  listUserConversations,
  sendConversationMessage,
} from '../services/conversation.service.js';
import {
  conversationIdSchema,
  createConversationSchema,
  analyzeRepositorySchema,
  generateRepositoryTestsSchema,
  sendMessageSchema,
} from '../validation/conversation.schemas.js';
import { analyzeConversationRepository } from '../services/repository-ai.service.js';
import { generateRepositoryTests } from '../services/test-generation.service.js';

function authenticatedUser(request: Request): AuthenticatedUser {
  if (!request.user) {
    throw new AppError('Authentication required', { statusCode: 401, code: 'UNAUTHORIZED' });
  }

  return request.user;
}

export function createConversationsController(
  provider: AIProvider,
  githubClient: GithubRepositoryClient,
  embeddingProvider?: EmbeddingProvider,
) {
  const create: RequestHandler = async (request, response, next) => {
    try {
      const user = authenticatedUser(request);
      const input = validateRequest(createConversationSchema, request.body, 'request body');
      const conversation = await createConversation(user.id, input.title, input.repositoryId);

      response.status(201).json({ success: true, data: { conversation } });
    } catch (error) {
      next(error);
    }
  };

  const list: RequestHandler = async (request, response, next) => {
    try {
      const user = authenticatedUser(request);
      const conversations = await listUserConversations(user.id);

      response.status(200).json({ success: true, data: { conversations } });
    } catch (error) {
      next(error);
    }
  };

  const detail: RequestHandler = async (request, response, next) => {
    try {
      const user = authenticatedUser(request);
      const { conversationId } = validateRequest(conversationIdSchema, request.params, 'conversation ID');
      const result = await getUserConversation(user.id, conversationId);

      response.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };

  const sendMessage: RequestHandler = async (request, response, next) => {
    try {
      const user = authenticatedUser(request);
      const { conversationId } = validateRequest(conversationIdSchema, request.params, 'conversation ID');
      const { content } = validateRequest(sendMessageSchema, request.body, 'request body');
      logger.info('conversation message request received', {
        conversationIdPresent: Boolean(conversationId),
        messageCharacterCount: content.length,
      });
      const messages = await sendConversationMessage(user.id, conversationId, content, provider, githubClient, embeddingProvider);

      response.status(200).json({ success: true, data: messages });
      logger.info('conversation message response returned', {
        assistantMessageReturned: Boolean(messages.assistantMessage),
      });
    } catch (error) {
      const details = typeof error === 'object' && error !== null ? error as Record<string, unknown> : {};
      logger.warn('conversation message request failed', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
        ...(typeof details.statusCode === 'number' ? { httpStatus: details.statusCode } : {}),
        ...(typeof details.code === 'string' ? { errorCode: details.code } : {}),
      });
      next(error);
    }
  };

  const analyze: RequestHandler = async (request, response, next) => {
    try {
      const user = authenticatedUser(request);
      const { conversationId } = validateRequest(conversationIdSchema, request.params, 'conversation ID');
      const input = validateRequest(analyzeRepositorySchema, request.body, 'request body');
      const analysis = await analyzeConversationRepository(
        user.id,
        conversationId,
        input.question,
        input.analysisType ?? 'explain',
        provider,
        githubClient,
        embeddingProvider,
      );
      response.status(200).json({ success: true, data: { analysis } });
    } catch (error) {
      next(error);
    }
  };

  const generateTests: RequestHandler = async (request, response, next) => {
    try {
      const user = authenticatedUser(request);
      const { conversationId } = validateRequest(conversationIdSchema, request.params, 'conversation ID');
      const input = validateRequest(generateRepositoryTestsSchema, request.body, 'request body');
      const tests = await generateRepositoryTests(
        user.id,
        conversationId,
        input.question,
        provider,
        githubClient,
        embeddingProvider,
      );
      response.status(200).json({ success: true, data: { tests } });
    } catch (error) {
      next(error);
    }
  };

  return { create, list, detail, sendMessage, analyze, generateTests };
}