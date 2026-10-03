import type { Request, RequestHandler } from 'express';

import type { GithubRepositoryClient } from '../clients/github.client.js';
import type { EmbeddingProvider } from '../ai/embedding-provider.js';
import type { AuthenticatedUser } from '../types/authenticated-user.js';
import { AppError } from '../utils/app-error.js';
import { validateRequest } from '../utils/validate.js';
import {
  createRepositorySchema,
  repositoryExplorerParamsSchema,
  repositoryFileQuerySchema,
  repositoryIdSchema,
  repositoryTreeQuerySchema,
} from '../validation/repository.schemas.js';
import {
  connectRepository,
  deleteUserRepository,
  getUserRepository,
  getUserRepositoryFile,
  getUserRepositoryTree,
  listUserRepositories,
} from '../services/repository.service.js';
import { indexUserRepository } from '../services/repository-indexing.service.js';

function authenticatedUser(request: Request): AuthenticatedUser {
  if (!request.user) {
    throw new AppError('Authentication required', { statusCode: 401, code: 'UNAUTHORIZED' });
  }

  return request.user;
}

export function createRepositoriesController(githubClient: GithubRepositoryClient, embeddingProvider?: EmbeddingProvider) {
  const create: RequestHandler = async (request, response, next) => {
    try {
      const user = authenticatedUser(request);
      const input = validateRequest(createRepositorySchema, request.body, 'request body');
      const repository = await connectRepository(user.id, input.githubOwner, input.githubRepo, githubClient);

      response.status(201).json({ success: true, data: { repository } });
    } catch (error) {
      next(error);
    }
  };

  const list: RequestHandler = async (request, response, next) => {
    try {
      const user = authenticatedUser(request);
      const repositories = await listUserRepositories(user.id);

      response.status(200).json({ success: true, data: { repositories } });
    } catch (error) {
      next(error);
    }
  };

  const detail: RequestHandler = async (request, response, next) => {
    try {
      const user = authenticatedUser(request);
      const { id } = validateRequest(repositoryIdSchema, request.params, 'repository ID');
      const repository = await getUserRepository(user.id, id);

      response.status(200).json({ success: true, data: { repository } });
    } catch (error) {
      next(error);
    }
  };

  const remove: RequestHandler = async (request, response, next) => {
    try {
      const user = authenticatedUser(request);
      const { id } = validateRequest(repositoryIdSchema, request.params, 'repository ID');
      await deleteUserRepository(user.id, id);

      response.status(200).json({ success: true, data: { message: 'Repository disconnected' } });
    } catch (error) {
      next(error);
    }
  };

  const tree: RequestHandler = async (request, response, next) => {
    try {
      const user = authenticatedUser(request);
      const { repositoryId } = validateRequest(repositoryExplorerParamsSchema, request.params, 'repository ID');
      const { path } = validateRequest(repositoryTreeQuerySchema, request.query, 'query parameters');
      const entries = await getUserRepositoryTree(user.id, repositoryId, path ?? '', githubClient);

      response.status(200).json({ success: true, data: { entries } });
    } catch (error) {
      next(error);
    }
  };

  const file: RequestHandler = async (request, response, next) => {
    try {
      const user = authenticatedUser(request);
      const { repositoryId } = validateRequest(repositoryExplorerParamsSchema, request.params, 'repository ID');
      const { path } = validateRequest(repositoryFileQuerySchema, request.query, 'query parameters');
      const fileInfo = await getUserRepositoryFile(user.id, repositoryId, path, githubClient);

      response.status(200).json({ success: true, data: { file: fileInfo } });
    } catch (error) {
      next(error);
    }
  };

  const index: RequestHandler = async (request, response, next) => {
    try {
      const user = authenticatedUser(request);
      const { id } = validateRequest(repositoryIdSchema, request.params, 'repository ID');
      const result = await indexUserRepository(user.id, id, githubClient, embeddingProvider);
      response.status(200).json({ success: true, data: { indexing: result } });
    } catch (error) {
      next(error);
    }
  };

  return { create, list, detail, remove, tree, file, index };
}