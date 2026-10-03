import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import type { EmbeddingProvider } from '../ai/embedding-provider.js';
import type { GithubContentEntry, GithubRepositoryClient, GithubRepositoryFile } from '../clients/github.client.js';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { RepositoryChunkModel } from '../models/repository-chunk.model.js';
import { RepositoryModel } from '../models/repository.model.js';
import { UserModel } from '../models/user.model.js';
import { chunkSource } from '../services/repository-chunking.service.js';
import { indexUserRepository } from '../services/repository-indexing.service.js';
import { buildRepositoryVectorSearchPipeline, limitRetrievedChunks } from '../services/repository-retrieval.service.js';

let mongoServer: MongoMemoryServer;

class StubGithub implements GithubRepositoryClient {
  readonly directories = new Map<string, GithubContentEntry[]>();
  readonly files = new Map<string, GithubRepositoryFile>();
  fail = false;
  readonly fileCalls: string[] = [];

  async getRepository(): Promise<never> {
    throw new Error('Not used by repository indexing');
  }

  async getRepositoryContents(_owner: string, _repo: string, path: string): Promise<GithubContentEntry[]> {
    if (this.fail) throw new Error('Upstream details must not escape');
    return this.directories.get(path) ?? [];
  }

  async getRepositoryFile(_owner: string, _repo: string, path: string): Promise<GithubRepositoryFile> {
    this.fileCalls.push(path);
    if (this.fail) throw new Error('Upstream details must not escape');
    const file = this.files.get(path);
    if (!file) throw new Error('Missing test fixture');
    return file;
  }
}

function sourceFile(path: string, text: string, size = Buffer.byteLength(text)): GithubRepositoryFile {
  return {
    name: path.split('/').at(-1) ?? path,
    path,
    type: 'file',
    size,
    content: Buffer.from(text).toString('base64'),
    encoding: 'base64',
  };
}

async function fixtureRepository() {
  const user = await UserModel.create({ email: 'index@example.com', passwordHash: 'test-hash' });
  const repository = await RepositoryModel.create({
    userId: user._id,
    githubOwner: 'octo-org',
    githubRepo: 'devpilot',
    githubFullName: 'octo-org/devpilot',
    defaultBranch: 'main',
    description: '',
    htmlUrl: 'https://github.com/octo-org/devpilot',
  });
  return { userId: String(user._id), repositoryId: String(repository._id) };
}

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await connectDatabase(mongoServer.getUri('devpilot-index-test'));
  await Promise.all([UserModel.syncIndexes(), RepositoryModel.syncIndexes(), RepositoryChunkModel.syncIndexes()]);
});

afterAll(async () => {
  await disconnectDatabase();
  await mongoServer.stop();
});

beforeEach(async () => {
  await Promise.all([RepositoryChunkModel.deleteMany({}), RepositoryModel.deleteMany({}), UserModel.deleteMany({})]);
});

describe('repository source chunking', () => {
  it('creates deterministic bounded chunks with positions and overlap', () => {
    const source = 'alpha\nbeta\ngamma\ndelta\nepsilon\n';
    const first = chunkSource(source, 14, 4);
    const second = chunkSource(source, 14, 4);

    expect(first).toEqual(second);
    expect(first.map((chunk) => chunk.chunkIndex)).toEqual([0, 1, 2, 3]);
    expect(first.every((chunk) => chunk.content.length <= 14)).toBe(true);
    expect(first[0]?.content.slice(-4)).toBe(first[1]?.content.slice(0, 4));
    expect(first[0]?.startLine).toBe(1);
    expect(first[1]?.startLine).toBeGreaterThan(1);
  });

  it('preserves Unicode and rejects invalid chunk limits', () => {
    expect(chunkSource('a🙂bc', 2, 0).map((chunk) => chunk.content).join('')).toBe('a🙂bc');
    expect(() => chunkSource('text', 2, 2)).toThrow(RangeError);
  });
});

describe('repository indexing and vector retrieval boundaries', () => {
  it('indexes supported files idempotently, stores embeddings, and excludes generated/lock/binary files', async () => {
    const { userId, repositoryId } = await fixtureRepository();
    const github = new StubGithub();
    github.directories.set('', [
      { name: 'src', path: 'src', type: 'directory' },
      { name: 'node_modules', path: 'node_modules', type: 'directory' },
      { name: 'package-lock.json', path: 'package-lock.json', type: 'file', size: 10 },
      { name: 'image.png', path: 'image.png', type: 'file', size: 3 },
    ]);
    github.directories.set('src', [{ name: 'app.ts', path: 'src/app.ts', type: 'file', size: 28 }]);
    github.files.set('src/app.ts', sourceFile('src/app.ts', 'export const app = true;\n'));
    github.files.set('package-lock.json', sourceFile('package-lock.json', 'lock'));
    github.files.set('image.png', sourceFile('image.png', '\0\0\0'));
    const embeddingProvider: EmbeddingProvider = {
      dimensions: 3,
      embedDocuments: vi.fn(async (texts: string[]) => texts.map((text) => [text.length, 0, 1])),
    };
    const limits = {
      maxFiles: 10,
      maxTreeEntries: 20,
      maxTreeRequests: 10,
      maxTotalCharacters: 100,
      maxFileSizeBytes: 100,
      maxChunkCharacters: 10,
    };

    const first = await indexUserRepository(userId, repositoryId, github, embeddingProvider, limits);
    const second = await indexUserRepository(userId, repositoryId, github, embeddingProvider, limits);
    const chunks = await RepositoryChunkModel.find({ repositoryId });
    const repository = await RepositoryModel.findById(repositoryId);

    expect(first.status).toBe('ready');
    expect(first.filesIndexed).toBe(1);
    expect(first.embeddingsCreated).toBe(true);
    expect(second.chunksIndexed).toBe(first.chunksIndexed);
    expect(chunks).toHaveLength(first.chunksIndexed);
    expect(chunks.every((chunk) => chunk.filePath === 'src/app.ts' && chunk.embedding?.length === 3)).toBe(true);
    expect(repository?.indexingStatus).toBe('ready');
    expect(github.fileCalls).not.toContain('package-lock.json');
    expect(github.fileCalls).not.toContain('image.png');
  });

  it('enforces indexing file, character, chunk and retrieval limits', async () => {
    const { userId, repositoryId } = await fixtureRepository();
    const github = new StubGithub();
    github.directories.set('', [
      { name: 'a.ts', path: 'a.ts', type: 'file', size: 50 },
      { name: 'b.ts', path: 'b.ts', type: 'file', size: 50 },
    ]);
    github.files.set('a.ts', sourceFile('a.ts', 'a'.repeat(40)));
    github.files.set('b.ts', sourceFile('b.ts', 'b'.repeat(40)));
    const result = await indexUserRepository(userId, repositoryId, github, undefined, {
      maxFiles: 1,
      maxTreeEntries: 10,
      maxTreeRequests: 1,
      maxTotalCharacters: 12,
      maxFileSizeBytes: 100,
      maxChunkCharacters: 5,
    });
    const chunks = await RepositoryChunkModel.find({ repositoryId });

    expect(result.filesIndexed).toBe(1);
    expect(result.charactersIndexed).toBe(12);
    expect(chunks.every((chunk) => chunk.content.length <= 5)).toBe(true);
    expect(chunks).toHaveLength(3);
    const retrieval = limitRetrievedChunks(
      chunks.map((chunk) => ({
        filePath: chunk.filePath,
        content: chunk.content,
        chunkIndex: chunk.chunkIndex,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        score: 1,
      })),
      'a.ts',
      2,
      7,
    );
    expect(retrieval.files).toHaveLength(2);
    expect(retrieval.totalCharacters).toBeLessThanOrEqual(7);
    expect(retrieval.files[0]?.path).toContain('a.ts#L');
  });

  it('scopes Atlas vector queries to the authenticated user and connected repository', () => {
    const repositoryId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();
    const pipeline = buildRepositoryVectorSearchPipeline(repositoryId, userId, 'version', [0.1, 0.2]);
    const stage = pipeline[0];

    expect(stage && '$vectorSearch' in stage).toBe(true);
    if (stage && '$vectorSearch' in stage) {
      expect(stage.$vectorSearch.filter).toEqual({
        repositoryId: { $eq: repositoryId },
        userId: { $eq: userId },
        indexVersion: { $eq: 'version' },
      });
      expect(stage.$vectorSearch.queryVector).toEqual([0.1, 0.2]);
    }
  });

  it('marks failed indexes safely without changing indexed data when GitHub fails', async () => {
    const { userId, repositoryId } = await fixtureRepository();
    const github = new StubGithub();
    github.fail = true;
    await expect(indexUserRepository(userId, repositoryId, github)).rejects.toMatchObject({
      code: 'REPOSITORY_INDEX_UNAVAILABLE',
      message: 'Repository indexing is temporarily unavailable',
    });
    const repository = await RepositoryModel.findById(repositoryId);

    expect(await RepositoryChunkModel.countDocuments({ repositoryId })).toBe(0);
    expect(repository?.indexingStatus).toBe('failed');
    expect(repository?.indexingError).not.toContain('Upstream details');
  });

  it('keeps the previously active index if a repeat indexing run fails', async () => {
    const { userId, repositoryId } = await fixtureRepository();
    const github = new StubGithub();
    github.directories.set('', [{ name: 'app.ts', path: 'app.ts', type: 'file', size: 5 }]);
    github.files.set('app.ts', sourceFile('app.ts', 'const app = true;'));
    await indexUserRepository(userId, repositoryId, github);
    const previousVersion = (await RepositoryModel.findById(repositoryId))?.activeIndexVersion;
    const previousChunks = await RepositoryChunkModel.find({ repositoryId, indexVersion: previousVersion });

    github.fail = true;
    await expect(indexUserRepository(userId, repositoryId, github)).rejects.toMatchObject({
      code: 'REPOSITORY_INDEX_UNAVAILABLE',
    });
    const repository = await RepositoryModel.findById(repositoryId);
    const activeChunks = await RepositoryChunkModel.find({ repositoryId, indexVersion: repository?.activeIndexVersion });

    expect(repository?.activeIndexVersion).toBe(previousVersion);
    expect(activeChunks.map((chunk) => chunk.content)).toEqual(previousChunks.map((chunk) => chunk.content));
  });

  it('rejects cross-user indexing and leaves another user repository untouched', async () => {
    const { repositoryId } = await fixtureRepository();
    const otherUser = await UserModel.create({ email: 'other@example.com', passwordHash: 'test-hash' });
    await expect(indexUserRepository(String(otherUser._id), repositoryId, new StubGithub())).rejects.toMatchObject({
      code: 'REPOSITORY_NOT_FOUND',
      statusCode: 404,
    });
    expect((await RepositoryModel.findById(repositoryId))?.indexingStatus).toBe('pending');
  });
});
