import { createHash, randomUUID } from 'node:crypto';
import mongoose from 'mongoose';

import type { EmbeddingProvider } from '../ai/embedding-provider.js';
import { env } from '../config/env.js';
import type { GithubContentEntry, GithubRepositoryClient } from '../clients/github.client.js';
import { RepositoryChunkModel } from '../models/repository-chunk.model.js';
import { RepositoryModel, type Repository } from '../models/repository.model.js';
import { AppError } from '../utils/app-error.js';
import { logger } from '../utils/logger.js';
import { repositoryFileQuerySchema } from '../validation/repository.schemas.js';
import { chunkSource } from './repository-chunking.service.js';

const allowedExtensions = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.java', '.go', '.rs', '.cpp', '.c', '.h', '.hpp',
  '.cs', '.html', '.css', '.scss', '.json', '.md', '.yml', '.yaml', '.toml', '.xml', '.sh', '.sql', '.vue', '.svelte',
]);
const excludedDirectories = new Set([
  '.git', 'node_modules', 'dist', 'build', 'coverage', 'vendor', 'target', '.next', '.nuxt', 'out',
  'generated', '__generated__', 'vendor_modules', 'bin', 'obj',
]);
const excludedFiles = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb', 'composer.lock', 'cargo.lock',
  'gemfile.lock', 'poetry.lock', 'pipfile.lock',
]);

export interface RepositoryIndexLimits {
  maxFiles: number;
  maxTreeEntries: number;
  maxTreeRequests: number;
  maxTotalCharacters: number;
  maxFileSizeBytes: number;
  maxChunkCharacters: number;
}

export const DEFAULT_REPOSITORY_INDEX_LIMITS: RepositoryIndexLimits = {
  maxFiles: env.MAX_REPOSITORY_INDEX_FILES,
  maxTreeEntries: env.MAX_REPOSITORY_INDEX_TREE_ENTRIES,
  maxTreeRequests: env.MAX_REPOSITORY_INDEX_TREE_REQUESTS,
  maxTotalCharacters: env.MAX_REPOSITORY_INDEX_TOTAL_CHARS,
  maxFileSizeBytes: env.MAX_REPOSITORY_FILE_SIZE_BYTES,
  maxChunkCharacters: env.MAX_REPOSITORY_CHUNK_CHARS,
};

export interface IndexRepositoryResult {
  status: 'ready';
  filesIndexed: number;
  chunksIndexed: number;
  charactersIndexed: number;
  embeddingsCreated: boolean;
  indexedAt: Date;
}

function isExcludedPath(path: string): boolean {
  const segments = path.toLowerCase().split('/');
  const filename = segments.at(-1) ?? '';
  return segments.some((segment) => excludedDirectories.has(segment)) ||
    excludedFiles.has(filename) ||
    filename.endsWith('.min.js') ||
    filename.endsWith('.min.css') ||
    filename.endsWith('.map');
}

function isSupportedFile(path: string): boolean {
  const filename = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  const extension = filename.slice(filename.lastIndexOf('.'));
  return allowedExtensions.has(extension) && !isExcludedPath(path);
}

function decodeTextFile(content: string | undefined, encoding: string | undefined): string | null {
  if (content === undefined || encoding !== 'base64') return null;
  const normalized = content.replace(/\s/g, '');
  if (!/^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/.test(normalized)) return null;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(normalized, 'base64'));
    return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text) ? null : text;
  } catch {
    return null;
  }
}

function contextError(): AppError {
  return new AppError('Repository indexing is temporarily unavailable', {
    statusCode: 503,
    code: 'REPOSITORY_INDEX_UNAVAILABLE',
  });
}

function sortedEntries(entries: GithubContentEntry[]): GithubContentEntry[] {
  return [...entries].sort((left, right) =>
    left.name.toLowerCase().localeCompare(right.name.toLowerCase()) || left.path.localeCompare(right.path),
  );
}

async function discoverFiles(
  repository: Repository,
  githubClient: GithubRepositoryClient,
  limits: RepositoryIndexLimits,
): Promise<string[]> {
  const queue: Array<{ path: string; depth: number }> = [{ path: '', depth: 0 }];
  const paths: string[] = [];
  let treeEntries = 0;
  let treeRequests = 0;
  while (
    queue.length > 0 &&
    paths.length < limits.maxFiles &&
    treeEntries < limits.maxTreeEntries &&
    treeRequests < limits.maxTreeRequests
  ) {
    const directory = queue.shift();
    if (!directory) break;
    const entries = await githubClient.getRepositoryContents(
      repository.githubOwner,
      repository.githubRepo,
      directory.path,
      repository.defaultBranch,
    );
    treeRequests += 1;
    for (const entry of sortedEntries(entries)) {
      if (treeEntries >= limits.maxTreeEntries || paths.length >= limits.maxFiles) break;
      treeEntries += 1;
      const parsed = repositoryFileQuerySchema.safeParse({ path: entry.path });
      if (!parsed.success || isExcludedPath(parsed.data.path)) continue;
      if (entry.type === 'directory') {
        if (directory.depth < 12) queue.push({ path: parsed.data.path, depth: directory.depth + 1 });
      } else if (entry.type === 'file' && isSupportedFile(parsed.data.path)) {
        paths.push(parsed.data.path);
      }
    }
  }
  return paths;
}

export async function indexUserRepository(
  userId: string,
  repositoryId: string,
  githubClient: GithubRepositoryClient,
  embeddingProvider?: EmbeddingProvider,
  limits: RepositoryIndexLimits = DEFAULT_REPOSITORY_INDEX_LIMITS,
): Promise<IndexRepositoryResult> {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const repositoryObjectId = new mongoose.Types.ObjectId(repositoryId);
  const indexVersion = randomUUID();
  const repository = await RepositoryModel.findOneAndUpdate(
    { _id: repositoryObjectId, userId: userObjectId, indexingStatus: { $ne: 'indexing' } },
    { $set: { indexingStatus: 'indexing' }, $unset: { indexingError: 1 } },
    { returnDocument: 'after' },
  );
  if (!repository) {
    const owned = await RepositoryModel.exists({ _id: repositoryObjectId, userId: userObjectId });
    if (!owned) throw new AppError('Repository not found', { statusCode: 404, code: 'REPOSITORY_NOT_FOUND' });
    throw new AppError('Repository indexing is already in progress', { statusCode: 409, code: 'REPOSITORY_INDEX_IN_PROGRESS' });
  }

  try {
    const paths = await discoverFiles(repository, githubClient, limits);
    const sourceFiles: Array<{ path: string; hash: string; chunks: ReturnType<typeof chunkSource> }> = [];
    let totalCharacters = 0;

    for (const path of paths) {
      if (totalCharacters >= limits.maxTotalCharacters) break;
      const file = await githubClient.getRepositoryFile(
        repository.githubOwner,
        repository.githubRepo,
        path,
        repository.defaultBranch,
      );
      if (file.type !== 'file' || file.size === undefined || file.size > limits.maxFileSizeBytes) continue;
      const decoded = decodeTextFile(file.content, file.encoding);
      if (decoded === null || decoded.length === 0) continue;
      const text = decoded.slice(0, limits.maxTotalCharacters - totalCharacters);
      if (!text) continue;
      const chunks = chunkSource(text, limits.maxChunkCharacters);
      sourceFiles.push({ path: file.path, hash: createHash('sha256').update(text).digest('hex'), chunks });
      totalCharacters += text.length;
    }

    const allChunks = sourceFiles.flatMap((file) =>
      file.chunks.map((chunk) => ({ ...chunk, filePath: file.path, contentHash: file.hash })),
    );
    const embeddings = embeddingProvider
      ? await embeddingProvider.embedDocuments(allChunks.map((chunk) => chunk.content))
      : [];
    if (embeddingProvider && embeddings.length !== allChunks.length) throw contextError();

    const operations = allChunks.map((chunk, index) => ({
      replaceOne: {
        filter: {
          repositoryId: repositoryObjectId,
          userId: userObjectId,
          indexVersion,
          filePath: chunk.filePath,
          chunkIndex: chunk.chunkIndex,
        },
        replacement: {
          repositoryId: repositoryObjectId,
          userId: userObjectId,
          indexVersion,
          filePath: chunk.filePath,
          chunkIndex: chunk.chunkIndex,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          content: chunk.content,
          contentHash: chunk.contentHash,
          updatedAt: new Date(),
          ...(embeddingProvider ? { embedding: embeddings[index] } : {}),
        },
        upsert: true,
      },
    }));
    if (operations.length > 0) await RepositoryChunkModel.bulkWrite(operations);

    const indexedAt = new Date();
    const activated = await RepositoryModel.updateOne(
      { _id: repositoryObjectId, userId: userObjectId, indexingStatus: 'indexing' },
      {
        $set: { indexingStatus: 'ready', indexedAt, activeIndexVersion: indexVersion },
        $unset: { indexingError: 1 },
      },
    );
    if (activated.matchedCount !== 1) throw contextError();
    try {
      await RepositoryChunkModel.deleteMany({
        repositoryId: repositoryObjectId,
        userId: userObjectId,
        indexVersion: { $ne: indexVersion },
      });
    } catch (error) {
      logger.warn('stale repository chunks could not be cleaned up', {
        repositoryId,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
    }
    return {
      status: 'ready',
      filesIndexed: sourceFiles.length,
      chunksIndexed: allChunks.length,
      charactersIndexed: totalCharacters,
      embeddingsCreated: Boolean(embeddingProvider),
      indexedAt,
    };
  } catch (error) {
    try {
      await RepositoryChunkModel.deleteMany({ repositoryId: repositoryObjectId, userId: userObjectId, indexVersion });
    } catch (cleanupError) {
      logger.warn('failed repository indexing staging data could not be cleaned up', {
        repositoryId,
        errorName: cleanupError instanceof Error ? cleanupError.name : 'UnknownError',
      });
    }
    await RepositoryModel.updateOne(
      { _id: repositoryObjectId, userId: userObjectId, indexingStatus: 'indexing' },
      { $set: { indexingStatus: 'failed', indexingError: 'Indexing did not complete. Please try again.' } },
    );
    logger.warn('repository indexing failed', {
      repositoryId,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    throw error instanceof AppError ? error : contextError();
  }
}
