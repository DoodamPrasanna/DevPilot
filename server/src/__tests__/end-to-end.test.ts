import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';

import type { AIMessage, AIProvider } from '../ai/ai-provider.js';
import {
  type GithubContentEntry,
  type GithubRepositoryClient,
  type GithubRepositoryFile,
  type GithubRepositoryMetadata,
} from '../clients/github.client.js';
import { createApp } from '../app.js';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { ConversationModel } from '../models/conversation.model.js';
import { MessageModel } from '../models/message.model.js';
import { RepositoryChunkModel } from '../models/repository-chunk.model.js';
import { RepositoryModel } from '../models/repository.model.js';
import { UserModel } from '../models/user.model.js';

let mongoServer: MongoMemoryServer;

class DemoGithubClient implements GithubRepositoryClient {
  readonly metadata: GithubRepositoryMetadata = {
    owner: 'octo-org',
    name: 'demo',
    fullName: 'octo-org/demo',
    defaultBranch: 'main',
    description: 'E2E demo repository',
    htmlUrl: 'https://github.com/octo-org/demo',
    isPrivate: false,
    visibility: 'public',
  };
  readonly source = 'export const add = (left: number, right: number) => left + right;';

  async getRepository(): Promise<GithubRepositoryMetadata> {
    return this.metadata;
  }

  async getRepositoryContents(_owner: string, _repository: string, path: string): Promise<GithubContentEntry[]> {
    return path === ''
      ? [{ name: 'src', path: 'src', type: 'directory' }]
      : path === 'src'
        ? [{ name: 'math.ts', path: 'src/math.ts', type: 'file', size: this.source.length }]
        : [];
  }

  async getRepositoryFile(_owner: string, _repository: string, path: string): Promise<GithubRepositoryFile> {
    if (path !== 'src/math.ts') throw Object.assign(new Error('not found'), { kind: 'not_found' });
    return {
      name: 'math.ts',
      path,
      type: 'file',
      size: Buffer.byteLength(this.source),
      content: Buffer.from(this.source).toString('base64'),
      encoding: 'base64',
    };
  }
}

class DemoAIProvider implements AIProvider {
  response = 'A general response';
  readonly calls: AIMessage[][] = [];

  async generateResponse(messages: AIMessage[]): Promise<string> {
    this.calls.push(messages);
    return this.response;
  }
}

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await connectDatabase(mongoServer.getUri('devpilot-e2e-test'));
  await Promise.all([
    UserModel.syncIndexes(),
    RepositoryModel.syncIndexes(),
    RepositoryChunkModel.syncIndexes(),
    ConversationModel.syncIndexes(),
    MessageModel.syncIndexes(),
  ]);
});

afterAll(async () => {
  await disconnectDatabase();
  await mongoServer.stop();
});

beforeEach(async () => {
  await Promise.all([
    MessageModel.deleteMany({}),
    ConversationModel.deleteMany({}),
    RepositoryChunkModel.deleteMany({}),
    RepositoryModel.deleteMany({}),
    UserModel.deleteMany({}),
  ]);
});

describe('DevPilot end-to-end API flow', () => {
  it('registers, authenticates, browses, chats, analyzes, generates tests, logs out, and rejects unauthenticated access', async () => {
    const github = new DemoGithubClient();
    const provider = new DemoAIProvider();
    const app = createApp({ githubClient: github, aiProvider: provider });
    const registered = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'e2e@example.com', password: 'secure-test-password-123' });
    expect(registered.status).toBe(201);

    const loggedIn = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'e2e@example.com', password: 'secure-test-password-123' });
    expect(loggedIn.status).toBe(200);
    const setCookie = loggedIn.headers['set-cookie'];
    const authCookie = Array.isArray(setCookie) ? setCookie[0]?.split(';')[0] : undefined;
    expect(authCookie).toContain('devpilot_token=');
    if (!authCookie) throw new Error('Expected the login response to set an authentication cookie');

    const connected = await request(app)
      .post('/api/v1/repositories')
      .set('Cookie', authCookie)
      .send({ githubOwner: 'octo-org', githubRepo: 'demo' });
    expect(connected.status).toBe(201);
    const repositoryId = connected.body.data.repository.id as string;

    const tree = await request(app)
      .get(`/api/v1/repositories/${repositoryId}/tree?path=src`)
      .set('Cookie', authCookie);
    const file = await request(app)
      .get(`/api/v1/repositories/${repositoryId}/file?path=src%2Fmath.ts`)
      .set('Cookie', authCookie);
    expect(tree.body.data.entries).toMatchObject([{ path: 'src/math.ts', type: 'file' }]);
    expect(file.body.data.file.content).toBe(github.source);

    const generalConversation = await request(app)
      .post('/api/v1/conversations')
      .set('Cookie', authCookie)
      .send({});
    provider.response = 'General response';
    const generalAnswer = await request(app)
      .post(`/api/v1/conversations/${generalConversation.body.data.conversation.id}/messages`)
      .set('Cookie', authCookie)
      .send({ content: 'Explain an API' });
    expect(generalAnswer.body.data.assistantMessage.content).toBe('General response');
    expect(generalAnswer.body.data.sources).toBeUndefined();

    const repositoryConversation = await request(app)
      .post('/api/v1/conversations')
      .set('Cookie', authCookie)
      .send({ repositoryId });
    const conversationId = repositoryConversation.body.data.conversation.id as string;
    provider.response = 'The add function returns the sum.';
    const repositoryAnswer = await request(app)
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set('Cookie', authCookie)
      .send({ content: 'Explain src/math.ts' });
    expect(repositoryAnswer.body.data.assistantMessage.sources).toEqual(['src/math.ts']);
    expect(provider.calls.at(-1)?.some((message) => message.role === 'context')).toBe(true);

    provider.response = JSON.stringify({
      factualFindings: [{ statement: 'The function adds two values.', confidence: 'high', sourcePaths: ['src/math.ts'] }],
      suggestions: [],
      uncertainties: ['No broader call sites were retrieved.'],
    });
    const analysis = await request(app)
      .post(`/api/v1/conversations/${conversationId}/analyze`)
      .set('Cookie', authCookie)
      .send({ question: 'Explain src/math.ts and the add function', analysisType: 'function' });
    expect(analysis.body.data.analysis.sources).toEqual(['src/math.ts']);

    provider.response = JSON.stringify({
      fileName: 'src/math.test.ts',
      code: "import { expect, it } from 'vitest';\nit('adds values', () => expect(add(1, 2)).toBe(3));",
      notes: ['Generated suggestion.'],
    });
    const generated = await request(app)
      .post(`/api/v1/conversations/${conversationId}/tests`)
      .set('Cookie', authCookie)
      .send({ question: 'Generate tests for src/math.ts' });
    expect(generated.body.data.tests).toMatchObject({
      framework: 'vitest',
      label: 'Generated suggestion; not executed or verified.',
      sources: ['src/math.ts'],
    });

    const loggedOut = await request(app).post('/api/v1/auth/logout').set('Cookie', authCookie);
    expect(loggedOut.status).toBe(200);
    const noCookie = await request(app).get('/api/v1/repositories');
    const unauthorizedChat = await request(app)
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .send({ content: 'This must not reach the provider' });
    expect(noCookie.status).toBe(401);
    expect(unauthorizedChat.status).toBe(401);
    expect(provider.calls).toHaveLength(4);
  }, 15_000);
});
