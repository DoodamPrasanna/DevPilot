import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { Types } from 'mongoose';

import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { ConversationModel } from '../models/conversation.model.js';
import { MessageModel, type MessageRole } from '../models/message.model.js';
import { RepositoryModel } from '../models/repository.model.js';
import { UserModel } from '../models/user.model.js';

let mongoServer: MongoMemoryServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await connectDatabase(mongoServer.getUri('devpilot-test'));
  await Promise.all([
    UserModel.syncIndexes(),
    RepositoryModel.syncIndexes(),
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
    UserModel.deleteMany({}),
    RepositoryModel.deleteMany({}),
    ConversationModel.deleteMany({}),
    MessageModel.deleteMany({}),
  ]);
});

async function createUser(email = 'dev@example.com') {
  return UserModel.create({ email, passwordHash: 'test-hash-only' });
}

async function createRepository(userId: Types.ObjectId) {
  return RepositoryModel.create({
    userId,
    githubOwner: 'octo-org',
    githubRepo: 'devpilot',
    githubFullName: 'octo-org/devpilot',
    defaultBranch: 'main',
    description: 'DevPilot repository',
    htmlUrl: 'https://github.com/octo-org/devpilot',
  });
}

describe('database models', () => {
  it('creates users with normalized email and safe JSON serialization', async () => {
    const user = await createUser('  DEv@Example.com  ');
    const serialized = user.toJSON();

    expect(user.email).toBe('dev@example.com');
    expect(user.passwordHash).toBe('test-hash-only');
    expect(serialized).toHaveProperty('id');
    expect(serialized).not.toHaveProperty('_id');
    expect(serialized).not.toHaveProperty('__v');
    expect(serialized).not.toHaveProperty('passwordHash');
  });

  it('rejects duplicate user email addresses', async () => {
    await createUser();

    await expect(createUser()).rejects.toMatchObject({ code: 11000 });
  });

  it('creates an owned repository and rejects duplicate identity for the same user', async () => {
    const user = await createUser();
    const repository = await createRepository(user._id);
    const ownedRepository = await RepositoryModel.findOne({ _id: repository._id, userId: user._id });

    expect(ownedRepository?.githubFullName).toBe('octo-org/devpilot');
    await expect(createRepository(user._id)).rejects.toMatchObject({ code: 11000 });
  });

  it('allows the same repository identity for a different user', async () => {
    const firstUser = await createUser('first@example.com');
    const secondUser = await createUser('second@example.com');

    await createRepository(firstUser._id);
    const repository = await createRepository(secondUser._id);

    expect(repository.userId.toString()).toBe(secondUser._id.toString());
  });

  it('creates a conversation linked to its user and repository', async () => {
    const user = await createUser();
    const repository = await createRepository(user._id);
    const conversation = await ConversationModel.create({
      userId: user._id,
      repositoryId: repository._id,
      title: 'Review the project structure',
    });

    expect(conversation.userId.toString()).toBe(user._id.toString());
    expect(conversation.repositoryId?.toString()).toBe(repository._id.toString());
    expect(conversation.createdAt).toBeInstanceOf(Date);
    expect(conversation.updatedAt).toBeInstanceOf(Date);
  });

  it('creates a general conversation without a repository association', async () => {
    const user = await createUser();
    const conversation = await ConversationModel.create({ userId: user._id, title: 'General chat' });

    expect(conversation.userId.toString()).toBe(user._id.toString());
    expect(conversation.repositoryId).toBeUndefined();
  });

  it('creates messages for each supported role and rejects unsupported roles', async () => {
    const user = await createUser();
    const repository = await createRepository(user._id);
    const conversation = await ConversationModel.create({
      userId: user._id,
      repositoryId: repository._id,
      title: 'A conversation',
    });
    const roles: MessageRole[] = ['user', 'assistant', 'system'];
    const messages = await Promise.all(
      roles.map((role) => MessageModel.create({ conversationId: conversation._id, role, content: `${role} content` })),
    );

    expect(messages.map((message) => message.role)).toEqual(roles);
    expect(messages.every((message) => message.conversationId.equals(conversation._id))).toBe(true);
    expect(messages[0].createdAt).toBeInstanceOf(Date);

    await expect(
      MessageModel.create({
        conversationId: conversation._id,
        role: 'moderator' as MessageRole,
        content: 'Not an allowed role',
      }),
    ).rejects.toMatchObject({ name: 'ValidationError' });
  });
});
