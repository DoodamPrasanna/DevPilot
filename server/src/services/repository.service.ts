import mongoose, { type Types } from 'mongoose';

import { GithubApiError, type GithubContentEntry, type GithubRepositoryClient } from '../clients/github.client.js';
import { env } from '../config/env.js';
import { RepositoryModel, type Repository } from '../models/repository.model.js';
import { RepositoryChunkModel } from '../models/repository-chunk.model.js';
import { AppError } from '../utils/app-error.js';

export interface SafeRepository {
  id: string;
  githubOwner: string;
  githubRepo: string;
  githubFullName: string;
  defaultBranch: string;
  description: string;
  htmlUrl: string;
  indexingStatus: Repository['indexingStatus'];
  indexedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

type RepositoryRecord = Pick<
  Repository,
  | 'githubOwner' | 'githubRepo' | 'githubFullName' | 'defaultBranch' | 'description' | 'htmlUrl'
  | 'indexingStatus' | 'indexedAt' | 'createdAt' | 'updatedAt'
> & { _id: Types.ObjectId };

function toSafeRepository(repository: RepositoryRecord): SafeRepository {
  return {
    id: String(repository._id),
    githubOwner: repository.githubOwner,
    githubRepo: repository.githubRepo,
    githubFullName: repository.githubFullName,
    defaultBranch: repository.defaultBranch,
    description: repository.description,
    htmlUrl: repository.htmlUrl,
    indexingStatus: repository.indexingStatus,
    ...(repository.indexedAt ? { indexedAt: repository.indexedAt } : {}),
    createdAt: repository.createdAt,
    updatedAt: repository.updatedAt,
  };
}

function githubErrorToAppError(error: GithubApiError): AppError {
  switch (error.kind) {
    case 'not_found':
      return new AppError('GitHub repository not found', { statusCode: 404, code: 'GITHUB_REPOSITORY_NOT_FOUND' });
    case 'rate_limited':
      return new AppError('GitHub is temporarily rate limiting requests', { statusCode: 503, code: 'GITHUB_RATE_LIMITED' });
    case 'authentication':
      return new AppError('GitHub rejected the API request', { statusCode: 502, code: 'GITHUB_API_AUTHENTICATION_FAILED' });
    case 'unavailable':
      return new AppError('GitHub is temporarily unavailable', { statusCode: 503, code: 'GITHUB_UNAVAILABLE' });
  }
}

function repositoryConflict(): AppError {
  return new AppError('Repository is already connected', { statusCode: 409, code: 'REPOSITORY_ALREADY_CONNECTED' });
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
}

export async function connectRepository(
  userId: string,
  owner: string,
  repository: string,
  githubClient: GithubRepositoryClient,
): Promise<SafeRepository> {
  let metadata;

  try {
    metadata = await githubClient.getRepository(owner, repository);
  } catch (error) {
    throw githubErrorToAppError(error instanceof GithubApiError ? error : new GithubApiError('unavailable'));
  }

  if (metadata.isPrivate || metadata.visibility?.toLowerCase() === 'private') {
    throw new AppError('Only public GitHub repositories can be connected', {
      statusCode: 400,
      code: 'PRIVATE_REPOSITORY_NOT_SUPPORTED',
    });
  }

  const userObjectId = new mongoose.Types.ObjectId(userId);
  const existingRepository = await RepositoryModel.exists({ userId: userObjectId, githubFullName: metadata.fullName });

  if (existingRepository) {
    throw repositoryConflict();
  }

  try {
    const savedRepository = await RepositoryModel.create({
      userId: userObjectId,
      githubOwner: metadata.owner,
      githubRepo: metadata.name,
      githubFullName: metadata.fullName,
      defaultBranch: metadata.defaultBranch,
      description: metadata.description,
      htmlUrl: metadata.htmlUrl,
    });

    return toSafeRepository(savedRepository);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw repositoryConflict();
    }

    throw error;
  }
}

export async function listUserRepositories(userId: string): Promise<SafeRepository[]> {
  const repositories = await RepositoryModel.find({ userId: new mongoose.Types.ObjectId(userId) }).sort({ createdAt: -1 });
  return repositories.map(toSafeRepository);
}

export async function getUserRepository(userId: string, repositoryId: string): Promise<SafeRepository> {
  const repository = await findOwnedRepository(userId, repositoryId);
  return toSafeRepository(repository);
}

export async function getUserRepositoryTree(
  userId: string,
  repositoryId: string,
  path: string,
  githubClient: GithubRepositoryClient,
): Promise<GithubContentEntry[]> {
  const repository = await findOwnedRepository(userId, repositoryId);
  let entries: GithubContentEntry[];

  try {
    entries = await githubClient.getRepositoryContents(
      repository.githubOwner,
      repository.githubRepo,
      path,
      repository.defaultBranch,
    );
  } catch (error) {
    throw githubContentsErrorToAppError(error);
  }

  return [...entries].sort(compareContentEntries);
}

export async function getUserRepositoryFile(
  userId: string,
  repositoryId: string,
  path: string,
  githubClient: GithubRepositoryClient,
) {
  const repository = await findOwnedRepository(userId, repositoryId);
  let file;

  try {
    file = await githubClient.getRepositoryFile(
      repository.githubOwner,
      repository.githubRepo,
      path,
      repository.defaultBranch,
    );
  } catch (error) {
    throw githubContentsErrorToAppError(error);
  }

  if (file.type === 'directory') {
    throw new AppError('The requested path is a directory', { statusCode: 400, code: 'PATH_IS_DIRECTORY' });
  }

  if (file.type !== 'file') {
    throw new AppError('This repository entry does not contain a supported file', {
      statusCode: 415,
      code: 'UNSUPPORTED_FILE_CONTENT',
    });
  }

  if (file.size === undefined) {
    throw new AppError('GitHub did not provide file size metadata', { statusCode: 502, code: 'GITHUB_CONTENT_UNAVAILABLE' });
  }

  if (file.size > env.MAX_REPOSITORY_FILE_SIZE_BYTES) {
    throw new AppError('The requested file exceeds the maximum supported size', {
      statusCode: 413,
      code: 'FILE_TOO_LARGE',
    });
  }

  return {
    name: file.name,
    path: file.path,
    size: file.size,
    content: decodeTextContent(file.content ?? '', file.encoding),
  };
}

export async function deleteUserRepository(userId: string, repositoryId: string): Promise<void> {
  const deletedRepository = await RepositoryModel.findOneAndDelete({
    _id: new mongoose.Types.ObjectId(repositoryId),
    userId: new mongoose.Types.ObjectId(userId),
  });

  if (!deletedRepository) {
    throw new AppError('Repository not found', { statusCode: 404, code: 'REPOSITORY_NOT_FOUND' });
  }

  await RepositoryChunkModel.deleteMany({
    repositoryId: deletedRepository._id,
    userId: new mongoose.Types.ObjectId(userId),
  });
}

function githubContentsErrorToAppError(error: unknown): AppError {
  if (error instanceof GithubApiError && error.kind === 'not_found') {
    return new AppError('GitHub repository content not found', { statusCode: 404, code: 'GITHUB_CONTENT_NOT_FOUND' });
  }

  return githubErrorToAppError(error instanceof GithubApiError ? error : new GithubApiError('unavailable'));
}

async function findOwnedRepository(userId: string, repositoryId: string) {
  const repository = await RepositoryModel.findOne({
    _id: new mongoose.Types.ObjectId(repositoryId),
    userId: new mongoose.Types.ObjectId(userId),
  });

  if (!repository) {
    throw new AppError('Repository not found', { statusCode: 404, code: 'REPOSITORY_NOT_FOUND' });
  }

  return repository;
}

function compareContentEntries(left: GithubContentEntry, right: GithubContentEntry): number {
  const leftDirectory = left.type === 'directory' ? 0 : 1;
  const rightDirectory = right.type === 'directory' ? 0 : 1;
  return leftDirectory - rightDirectory || left.name.toLowerCase().localeCompare(right.name.toLowerCase()) || left.name.localeCompare(right.name);
}

function decodeTextContent(content: string, encoding: string | undefined): string {
  if (encoding !== 'base64') {
    throw new AppError('This file content format is not supported', { statusCode: 415, code: 'UNSUPPORTED_FILE_CONTENT' });
  }

  const decoded = Buffer.from(content.replace(/\s/g, ''), 'base64');

  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(decoded);

    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) {
      throw new Error('Binary content');
    }

    return text;
  } catch {
    throw new AppError('This file does not contain supported text content', {
      statusCode: 415,
      code: 'UNSUPPORTED_FILE_CONTENT',
    });
  }
}