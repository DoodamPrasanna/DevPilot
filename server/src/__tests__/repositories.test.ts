import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { type Types } from 'mongoose';
import request from 'supertest';

import {
  type GithubApiFailureKind,
  GithubApiError,
  type GithubContentEntry,
  type GithubRepositoryClient,
  type GithubRepositoryFile,
  type GithubRepositoryMetadata,
} from '../clients/github.client.js';
import { createApp } from '../app.js';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { env } from '../config/env.js';
import { RepositoryModel } from '../models/repository.model.js';
import { UserModel } from '../models/user.model.js';
import { signAuthToken } from '../utils/jwt.js';

let mongoServer: MongoMemoryServer;

class StubGithubClient implements GithubRepositoryClient {
  metadata: GithubRepositoryMetadata = {
    owner: 'facebook',
    name: 'react',
    fullName: 'facebook/react',
    defaultBranch: 'main',
    description: 'Trusted GitHub description',
    htmlUrl: 'https://github.com/facebook/react',
    isPrivate: false,
    visibility: 'public',
  };
  failure: Error | undefined;
  calls: Array<{ owner: string; repository: string }> = [];
  contentCalls: Array<{ owner: string; repository: string; path: string; branch: string }> = [];
  entries: GithubContentEntry[] = [];
  file: GithubRepositoryFile = {
    name: 'App.tsx',
    path: 'src/App.tsx',
    type: 'file',
    size: 5,
    content: 'aGVsbG8=',
    encoding: 'base64',
  };

  async getRepository(owner: string, repository: string): Promise<GithubRepositoryMetadata> {
    this.calls.push({ owner, repository });

    if (this.failure) {
      throw this.failure;
    }

    return this.metadata;
  }

  async getRepositoryContents(owner: string, repository: string, path: string, branch: string): Promise<GithubContentEntry[]> {
    this.contentCalls.push({ owner, repository, path, branch });
    if (this.failure) throw this.failure;
    return this.entries;
  }

  async getRepositoryFile(owner: string, repository: string, path: string, branch: string): Promise<GithubRepositoryFile> {
    this.contentCalls.push({ owner, repository, path, branch });
    if (this.failure) throw this.failure;
    return this.file;
  }
}

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await connectDatabase(mongoServer.getUri('devpilot-repositories-test'));
  await Promise.all([UserModel.syncIndexes(), RepositoryModel.syncIndexes()]);
});

afterAll(async () => {
  await disconnectDatabase();
  await mongoServer.stop();
});

beforeEach(async () => {
  await Promise.all([RepositoryModel.deleteMany({}), UserModel.deleteMany({})]);
});

async function createUser(email: string) {
  return UserModel.create({ email, passwordHash: 'test-hash-only' });
}

function authCookie(userId: string): string {
  return `${env.COOKIE_NAME}=${signAuthToken(userId)}`;
}

async function addRepository(userId: Types.ObjectId, githubFullName: string) {
  const [githubOwner, githubRepo] = githubFullName.split('/');

  return RepositoryModel.create({
    userId,
    githubOwner,
    githubRepo,
    githubFullName,
    defaultBranch: 'main',
    description: 'Stored repository',
    htmlUrl: `https://github.com/${githubFullName}`,
  });
}

describe('repository API authentication and ownership', () => {
  it('requires authentication for create, list, detail, delete, tree, and file', async () => {
    const app = createApp({ githubClient: new StubGithubClient() });
    const repositoryId = new mongoose.Types.ObjectId().toString();
    const responses = await Promise.all([
      request(app).post('/api/v1/repositories').send({ githubOwner: 'facebook', githubRepo: 'react' }),
      request(app).get('/api/v1/repositories'),
      request(app).get(`/api/v1/repositories/${repositoryId}`),
      request(app).delete(`/api/v1/repositories/${repositoryId}`),
      request(app).get(`/api/v1/repositories/${repositoryId}/tree`),
      request(app).get(`/api/v1/repositories/${repositoryId}/file?path=src/App.tsx`),
    ]);

    expect(responses.map((response) => response.status)).toEqual([401, 401, 401, 401, 401, 401]);
  });

  it('creates a public repository using only trusted GitHub metadata', async () => {
    const user = await createUser('owner@example.com');
    const githubClient = new StubGithubClient();
    const response = await request(createApp({ githubClient }))
      .post('/api/v1/repositories')
      .set('Cookie', authCookie(String(user._id)))
      .send({
        githubOwner: ' facebook ',
        githubRepo: ' react ',
        defaultBranch: 'attacker-branch',
        description: 'attacker description',
        htmlUrl: 'https://attacker.example/repo',
        visibility: 'private',
      });
    const storedRepository = await RepositoryModel.findById(response.body.data.repository.id);

    expect(response.status).toBe(201);
    expect(githubClient.calls).toEqual([{ owner: 'facebook', repository: 'react' }]);
    expect(response.body.data.repository).toMatchObject({
      id: expect.any(String),
      githubOwner: 'facebook',
      githubRepo: 'react',
      githubFullName: 'facebook/react',
      defaultBranch: 'main',
      description: 'Trusted GitHub description',
      htmlUrl: 'https://github.com/facebook/react',
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(response.body.data.repository).not.toHaveProperty('userId');
    expect(response.body.data.repository).not.toHaveProperty('_id');
    expect(storedRepository?.userId.toString()).toBe(String(user._id));
    expect(storedRepository?.toObject()).not.toHaveProperty('githubToken');
  });

  it.each([
    ['empty owner', '', 'react'],
    ['URL owner', 'https://github.com/facebook', 'react'],
    ['path owner', 'facebook/other', 'react'],
    ['oversized owner', 'a'.repeat(40), 'react'],
    ['empty repository', 'facebook', ''],
    ['URL repository', 'facebook', 'https://github.com/facebook/react'],
    ['path repository', 'facebook', '../react'],
    ['oversized repository', 'facebook', 'r'.repeat(101)],
  ])('rejects %s input before contacting GitHub', async (_caseName, githubOwner, githubRepo) => {
    const user = await createUser('validation@example.com');
    const githubClient = new StubGithubClient();
    const response = await request(createApp({ githubClient }))
      .post('/api/v1/repositories')
      .set('Cookie', authCookie(String(user._id)))
      .send({ githubOwner, githubRepo });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(githubClient.calls).toHaveLength(0);
  });

  it('maps GitHub 404 to a clean repository-not-found response', async () => {
    const user = await createUser('missing@example.com');
    const githubClient = new StubGithubClient();
    githubClient.failure = new GithubApiError('not_found');

    const response = await request(createApp({ githubClient }))
      .post('/api/v1/repositories')
      .set('Cookie', authCookie(String(user._id)))
      .send({ githubOwner: 'facebook', githubRepo: 'missing' });

    expect(response.status).toBe(404);
    expect(response.body.error).toMatchObject({ code: 'GITHUB_REPOSITORY_NOT_FOUND', message: 'GitHub repository not found' });
    expect(JSON.stringify(response.body)).not.toContain('GitHubApiError');
  });

  it('rejects a repository that GitHub identifies as private', async () => {
    const user = await createUser('private@example.com');
    const githubClient = new StubGithubClient();
    githubClient.metadata = { ...githubClient.metadata, isPrivate: true, visibility: 'private' };

    const response = await request(createApp({ githubClient }))
      .post('/api/v1/repositories')
      .set('Cookie', authCookie(String(user._id)))
      .send({ githubOwner: 'facebook', githubRepo: 'react' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('PRIVATE_REPOSITORY_NOT_SUPPORTED');
    expect(await RepositoryModel.countDocuments()).toBe(0);
  });

  it('rejects duplicate repositories for the same user with a conflict', async () => {
    const user = await createUser('duplicate@example.com');
    const app = createApp({ githubClient: new StubGithubClient() });
    const create = () =>
      request(app)
        .post('/api/v1/repositories')
        .set('Cookie', authCookie(String(user._id)))
        .send({ githubOwner: 'facebook', githubRepo: 'react' });

    expect((await create()).status).toBe(201);
    const duplicate = await create();

    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('REPOSITORY_ALREADY_CONNECTED');
  });

  it.each([
    ['rate limit', 'rate_limited' as GithubApiFailureKind, 503, 'GITHUB_RATE_LIMITED'],
    ['upstream authentication', 'authentication' as GithubApiFailureKind, 502, 'GITHUB_API_AUTHENTICATION_FAILED'],
    ['upstream failure', 'unavailable' as GithubApiFailureKind, 503, 'GITHUB_UNAVAILABLE'],
  ])('maps GitHub %s errors without exposing provider details', async (_label, kind, status, code) => {
    const user = await createUser(`failure-${kind}@example.com`);
    const githubClient = new StubGithubClient();
    githubClient.failure = new GithubApiError(kind);

    const response = await request(createApp({ githubClient }))
      .post('/api/v1/repositories')
      .set('Cookie', authCookie(String(user._id)))
      .send({ githubOwner: 'facebook', githubRepo: 'react' });

    expect(response.status).toBe(status);
    expect(response.body.error.code).toBe(code);
    expect(JSON.stringify(response.body)).not.toContain(env.JWT_SECRET);
  });

  it('sanitizes unexpected GitHub client failures', async () => {
    const user = await createUser('secret-error@example.com');
    const githubClient = new StubGithubClient();
    githubClient.failure = new Error('Authorization: Bearer github-secret-value; raw response body');

    const response = await request(createApp({ githubClient }))
      .post('/api/v1/repositories')
      .set('Cookie', authCookie(String(user._id)))
      .send({ githubOwner: 'facebook', githubRepo: 'react' });

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('GITHUB_UNAVAILABLE');
    expect(JSON.stringify(response.body)).not.toContain('github-secret-value');
    expect(JSON.stringify(response.body)).not.toContain('raw response body');
  });

  it('lists only the authenticated user repositories and returns safe fields', async () => {
    const firstUser = await createUser('first@example.com');
    const secondUser = await createUser('second@example.com');
    await addRepository(firstUser._id, 'facebook/react');
    await addRepository(secondUser._id, 'microsoft/typescript');

    const response = await request(createApp())
      .get('/api/v1/repositories')
      .set('Cookie', authCookie(String(firstUser._id)));

    expect(response.status).toBe(200);
    expect(response.body.data.repositories).toHaveLength(1);
    expect(response.body.data.repositories[0].githubFullName).toBe('facebook/react');
    expect(response.body.data.repositories[0]).not.toHaveProperty('userId');
    expect(response.body.data.repositories[0]).not.toHaveProperty('__v');
  });

  it('allows owners to retrieve details and hides another user repository as not found', async () => {
    const owner = await createUser('detail-owner@example.com');
    const otherUser = await createUser('detail-other@example.com');
    const repository = await addRepository(owner._id, 'facebook/react');
    const app = createApp();
    const ownedResponse = await request(app)
      .get(`/api/v1/repositories/${repository._id}`)
      .set('Cookie', authCookie(String(owner._id)));
    const otherResponse = await request(app)
      .get(`/api/v1/repositories/${repository._id}`)
      .set('Cookie', authCookie(String(otherUser._id)));

    expect(ownedResponse.status).toBe(200);
    expect(ownedResponse.body.data.repository.githubFullName).toBe('facebook/react');
    expect(otherResponse.status).toBe(404);
    expect(otherResponse.body.error.code).toBe('REPOSITORY_NOT_FOUND');
  });

  it('rejects malformed IDs and returns not found for valid nonexistent IDs', async () => {
    const user = await createUser('bad-id@example.com');
    const app = createApp();
    const malformed = await request(app)
      .get('/api/v1/repositories/not-an-object-id')
      .set('Cookie', authCookie(String(user._id)));
    const nonexistent = await request(app)
      .get(`/api/v1/repositories/${new mongoose.Types.ObjectId()}`)
      .set('Cookie', authCookie(String(user._id)));

    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('VALIDATION_ERROR');
    expect(nonexistent.status).toBe(404);
    expect(nonexistent.body.error.code).toBe('REPOSITORY_NOT_FOUND');
  });

  it('allows owners to delete and prevents deletion by another user', async () => {
    const owner = await createUser('delete-owner@example.com');
    const otherUser = await createUser('delete-other@example.com');
    const repository = await addRepository(owner._id, 'facebook/react');
    const app = createApp();
    const otherResponse = await request(app)
      .delete(`/api/v1/repositories/${repository._id}`)
      .set('Cookie', authCookie(String(otherUser._id)));

    expect(otherResponse.status).toBe(404);
    expect(await RepositoryModel.countDocuments({ _id: repository._id })).toBe(1);

    const ownerResponse = await request(app)
      .delete(`/api/v1/repositories/${repository._id}`)
      .set('Cookie', authCookie(String(owner._id)));

    expect(ownerResponse.status).toBe(200);
    expect(ownerResponse.body.data.message).toBe('Repository disconnected');
    expect(await RepositoryModel.countDocuments({ _id: repository._id })).toBe(0);
  });

  it('returns a sorted normalized root tree and uses the stored branch', async () => {
    const owner = await createUser('tree-owner@example.com');
    const repository = await addRepository(owner._id, 'facebook/react');
    repository.defaultBranch = 'release';
    await repository.save();
    const githubClient = new StubGithubClient();
    githubClient.entries = [
      { name: 'z.ts', path: 'z.ts', type: 'file', size: 2 },
      { name: 'src', path: 'src', type: 'directory' },
      { name: 'a.ts', path: 'a.ts', type: 'file', size: 1 },
    ];

    const response = await request(createApp({ githubClient }))
      .get(`/api/v1/repositories/${repository._id}/tree?branch=attacker`)
      .set('Cookie', authCookie(String(owner._id)));

    expect(response.status).toBe(200);
    expect(response.body.data.entries).toEqual([
      { name: 'src', path: 'src', type: 'directory' },
      { name: 'a.ts', path: 'a.ts', type: 'file', size: 1 },
      { name: 'z.ts', path: 'z.ts', type: 'file', size: 2 },
    ]);
    expect(githubClient.contentCalls).toEqual([{ owner: 'facebook', repository: 'react', path: '', branch: 'release' }]);
  });

  it('forwards nested tree paths and hides another user repository', async () => {
    const owner = await createUser('nested-owner@example.com');
    const otherUser = await createUser('nested-other@example.com');
    const repository = await addRepository(owner._id, 'facebook/react');
    const githubClient = new StubGithubClient();
    githubClient.entries = [{ name: 'App.tsx', path: 'src/App.tsx', type: 'file', size: 10 }];
    const app = createApp({ githubClient });

    const ownerResponse = await request(app)
      .get(`/api/v1/repositories/${repository._id}/tree?path=src`)
      .set('Cookie', authCookie(String(owner._id)));
    const otherResponse = await request(app)
      .get(`/api/v1/repositories/${repository._id}/tree?path=src`)
      .set('Cookie', authCookie(String(otherUser._id)));

    expect(ownerResponse.status).toBe(200);
    expect(githubClient.contentCalls).toEqual([{ owner: 'facebook', repository: 'react', path: 'src', branch: 'main' }]);
    expect(otherResponse.status).toBe(404);
    expect(otherResponse.body.error.code).toBe('REPOSITORY_NOT_FOUND');
    expect(githubClient.contentCalls).toHaveLength(1);
  });

  it.each(['../secret', '../../secret', 'src/../../secret', '/absolute/path', 'C:/absolute/path', 'src\\..\\secret'])
  ('rejects unsafe tree path %s', async (path) => {
    const owner = await createUser(`path-${encodeURIComponent(path)}@example.com`);
    const repository = await addRepository(owner._id, 'facebook/react');
    const githubClient = new StubGithubClient();
    const response = await request(createApp({ githubClient }))
      .get(`/api/v1/repositories/${repository._id}/tree`)
      .query({ path })
      .set('Cookie', authCookie(String(owner._id)));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(githubClient.contentCalls).toHaveLength(0);
  });

  it('rejects null bytes, malformed IDs, and missing file paths', async () => {
    const owner = await createUser('explorer-invalid@example.com');
    const githubClient = new StubGithubClient();
    const app = createApp();
    const malformed = await request(app)
      .get('/api/v1/repositories/not-an-object-id/tree')
      .set('Cookie', authCookie(String(owner._id)));
    const missingPath = await request(app)
      .get(`/api/v1/repositories/${new mongoose.Types.ObjectId()}/file`)
      .set('Cookie', authCookie(String(owner._id)));
    const nullByte = await request(app)
      .get(`/api/v1/repositories/${new mongoose.Types.ObjectId()}/tree?path=src%00secret`)
      .set('Cookie', authCookie(String(owner._id)));
    const traversal = await request(createApp({ githubClient }))
      .get(`/api/v1/repositories/${new mongoose.Types.ObjectId()}/file?path=src%2F..%2F..%2Fsecret`)
      .set('Cookie', authCookie(String(owner._id)));

    expect(malformed.status).toBe(400);
    expect(missingPath.status).toBe(400);
    expect(nullByte.status).toBe(400);
    expect(traversal.status).toBe(400);
    expect(githubClient.contentCalls).toHaveLength(0);
  });

  it('returns decoded text files only to their repository owner', async () => {
    const owner = await createUser('file-owner@example.com');
    const otherUser = await createUser('file-other@example.com');
    const repository = await addRepository(owner._id, 'facebook/react');
    const githubClient = new StubGithubClient();
    const app = createApp({ githubClient });

    const ownerResponse = await request(app)
      .get(`/api/v1/repositories/${repository._id}/file?path=src/App.tsx&branch=attacker`)
      .set('Cookie', authCookie(String(owner._id)));
    const otherResponse = await request(app)
      .get(`/api/v1/repositories/${repository._id}/file?path=src/App.tsx`)
      .set('Cookie', authCookie(String(otherUser._id)));

    expect(ownerResponse.status).toBe(200);
    expect(ownerResponse.body.data.file).toEqual({ name: 'App.tsx', path: 'src/App.tsx', size: 5, content: 'hello' });
    expect(githubClient.contentCalls).toEqual([{ owner: 'facebook', repository: 'react', path: 'src/App.tsx', branch: 'main' }]);
    expect(otherResponse.status).toBe(404);
    expect(otherResponse.body.error.code).toBe('REPOSITORY_NOT_FOUND');
    expect(githubClient.contentCalls).toHaveLength(1);
  });

  it('rejects directories, unsupported binary content, and oversized files', async () => {
    const owner = await createUser('file-limits@example.com');
    const repository = await addRepository(owner._id, 'facebook/react');
    const githubClient = new StubGithubClient();
    const app = createApp({ githubClient });

    githubClient.file = { name: 'src', path: 'src', type: 'directory' };
    const directory = await request(app)
      .get(`/api/v1/repositories/${repository._id}/file?path=src`)
      .set('Cookie', authCookie(String(owner._id)));
    expect(directory.status).toBe(400);
    expect(directory.body.error.code).toBe('PATH_IS_DIRECTORY');

    githubClient.file = { ...githubClient.file, type: 'file', size: 5, content: 'AAABAA==', encoding: 'base64' };
    const binary = await request(app)
      .get(`/api/v1/repositories/${repository._id}/file?path=src/App.tsx`)
      .set('Cookie', authCookie(String(owner._id)));
    expect(binary.status).toBe(415);
    expect(binary.body.error.code).toBe('UNSUPPORTED_FILE_CONTENT');

    githubClient.file = { ...githubClient.file, size: env.MAX_REPOSITORY_FILE_SIZE_BYTES + 1, content: 'c2VjcmV0' };
    const oversized = await request(app)
      .get(`/api/v1/repositories/${repository._id}/file?path=src/App.tsx`)
      .set('Cookie', authCookie(String(owner._id)));
    expect(oversized.status).toBe(413);
    expect(oversized.body.error.code).toBe('FILE_TOO_LARGE');
    expect(JSON.stringify(oversized.body)).not.toContain('secret');
  });

  it.each([
    ['not_found' as const, 404, 'GITHUB_CONTENT_NOT_FOUND'],
    ['rate_limited' as const, 503, 'GITHUB_RATE_LIMITED'],
    ['authentication' as const, 502, 'GITHUB_API_AUTHENTICATION_FAILED'],
    ['unavailable' as const, 503, 'GITHUB_UNAVAILABLE'],
  ])('maps upstream %s content errors safely', async (kind, status, code) => {
    const owner = await createUser(`content-error-${kind}@example.com`);
    const repository = await addRepository(owner._id, 'facebook/react');
    const githubClient = new StubGithubClient();
    githubClient.failure = new GithubApiError(kind);
    const response = await request(createApp({ githubClient }))
      .get(`/api/v1/repositories/${repository._id}/tree`)
      .set('Cookie', authCookie(String(owner._id)));

    expect(response.status).toBe(status);
    expect(response.body.error.code).toBe(code);
    expect(JSON.stringify(response.body)).not.toContain('GitHubApiError');
  });

  it('sanitizes network and timeout failures for explorer requests', async () => {
    const owner = await createUser('explorer-network@example.com');
    const repository = await addRepository(owner._id, 'facebook/react');
    const githubClient = new StubGithubClient();
    githubClient.failure = new Error('timeout; raw GitHub response token=secret');
    const response = await request(createApp({ githubClient }))
      .get(`/api/v1/repositories/${repository._id}/tree`)
      .set('Cookie', authCookie(String(owner._id)));

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('GITHUB_UNAVAILABLE');
    expect(JSON.stringify(response.body)).not.toContain('raw GitHub response');
    expect(JSON.stringify(response.body)).not.toContain('secret');
  });

  it('rejects malformed IDs for deletion', async () => {
    const user = await createUser('delete-id@example.com');

    const response = await request(createApp())
      .delete('/api/v1/repositories/malformed')
      .set('Cookie', authCookie(String(user._id)));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});