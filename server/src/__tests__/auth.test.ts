import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import jwt from 'jsonwebtoken';
import request from 'supertest';

import { createApp } from '../app.js';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { env } from '../config/env.js';
import { UserModel } from '../models/user.model.js';
import { comparePassword } from '../utils/password.js';

let mongoServer: MongoMemoryServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await connectDatabase(mongoServer.getUri('devpilot-auth-test'));
  await UserModel.syncIndexes();
});

afterAll(async () => {
  await disconnectDatabase();
  await mongoServer.stop();
});

beforeEach(async () => {
  await UserModel.deleteMany({});
});

async function register(email = 'user@example.com', password = 'password123') {
  return request(createApp()).post('/api/v1/auth/register').send({ email, password });
}

async function login(email = 'user@example.com', password = 'password123') {
  return request(createApp()).post('/api/v1/auth/login').send({ email, password });
}

function cookieFrom(response: request.Response): string {
  return setCookieHeader(response).split(';', 1)[0];
}

function setCookieHeader(response: request.Response): string {
  const header = response.headers['set-cookie'];
  return Array.isArray(header) ? String(header[0]) : header;
}

describe('authentication API', () => {
  it('registers a normalized email with a password hash and a safe response', async () => {
    const response = await register('  DEV@Example.com  ');
    const savedUser = await UserModel.findOne({ email: 'dev@example.com' });

    expect(response.status).toBe(201);
    expect(response.body.data.user).toMatchObject({
      id: expect.any(String),
      email: 'dev@example.com',
      createdAt: expect.any(String),
    });
    expect(savedUser).not.toBeNull();
    expect(savedUser?.passwordHash).not.toBe('password123');
    expect(await comparePassword('password123', savedUser!.passwordHash)).toBe(true);
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
    expect(JSON.stringify(response.body)).not.toContain('password123');
    expect(JSON.stringify(response.body)).not.toContain(env.JWT_SECRET);
  });

  it('rejects duplicate email addresses with a conflict response', async () => {
    await register();

    const response = await register();

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('EMAIL_ALREADY_EXISTS');
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
  });

  it.each([
    ['invalid email', 'not-an-email', 'password123'],
    ['short password', 'user@example.com', 'short'],
    ['oversized password', 'user@example.com', 'p'.repeat(73)],
  ])('rejects registration with %s', async (_caseName, email, password) => {
    const response = await register(email, password);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(await UserModel.countDocuments()).toBe(0);
  });

  it('logs in with valid credentials and returns the token only in an HttpOnly cookie', async () => {
    await register();

    const response = await login();
    const cookie = cookieFrom(response);
    const cookieHeader = setCookieHeader(response);

    expect(response.status).toBe(200);
    expect(response.body.data.user.email).toBe('user@example.com');
    expect(response.body.data).not.toHaveProperty('token');
    expect(JSON.stringify(response.body)).not.toContain(cookie.split('=')[1]);
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
    expect(JSON.stringify(response.body)).not.toContain(env.JWT_SECRET);
    expect(cookieHeader).toContain('HttpOnly');
    expect(cookieHeader).toContain('SameSite=Lax');
    expect(cookieHeader).toContain('Max-Age=86400');
  });

  it('uses the same generic credential failure for a wrong password and unknown account', async () => {
    await register();

    const wrongPassword = await login('user@example.com', 'incorrect-password');
    const unknownEmail = await login('unknown@example.com', 'incorrect-password');

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body.error).toEqual(unknownEmail.body.error);
    expect(wrongPassword.body.error.message).toBe('Invalid email or password');
  });

  it('returns the authenticated user from a valid cookie', async () => {
    await register();
    const authenticated = await login();

    const response = await request(createApp()).get('/api/v1/auth/me').set('Cookie', cookieFrom(authenticated));

    expect(response.status).toBe(200);
    expect(response.body.data.user.email).toBe('user@example.com');
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
    expect(JSON.stringify(response.body)).not.toContain(env.JWT_SECRET);
  });

  it('rejects requests without a cookie, with a malformed token, or with an invalid user ID', async () => {
    const app = createApp();
    const missing = await request(app).get('/api/v1/auth/me');
    const malformed = await request(app).get('/api/v1/auth/me').set('Cookie', `${env.COOKIE_NAME}=not-a-jwt`);
    const invalidSubjectToken = jwt.sign({ sub: 'not-an-object-id' }, env.JWT_SECRET, { expiresIn: 60 });
    const invalidSubject = await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', `${env.COOKIE_NAME}=${invalidSubjectToken}`);

    expect(missing.status).toBe(401);
    expect(malformed.status).toBe(401);
    expect(invalidSubject.status).toBe(401);
    expect(missing.body.error).toEqual(malformed.body.error);
    expect(missing.body.error).toEqual(invalidSubject.body.error);
  });

  it('rejects expired tokens', async () => {
    const expiredToken = jwt.sign({ sub: '507f1f77bcf86cd799439011' }, env.JWT_SECRET, { expiresIn: -1 });

    const response = await request(createApp())
      .get('/api/v1/auth/me')
      .set('Cookie', `${env.COOKIE_NAME}=${expiredToken}`);

    expect(response.status).toBe(401);
    expect(response.body.error.message).toBe('Authentication required');
  });

  it('rejects a valid token after its user is deleted', async () => {
    await register();
    const authenticated = await login();
    await UserModel.deleteOne({ email: 'user@example.com' });

    const response = await request(createApp()).get('/api/v1/auth/me').set('Cookie', cookieFrom(authenticated));

    expect(response.status).toBe(401);
  });

  it('clears the cookie on logout and is safe without an existing session', async () => {
    const response = await request(createApp()).post('/api/v1/auth/logout');
    const setCookie = setCookieHeader(response);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, data: { message: 'Logged out' } });
    expect(setCookie).toContain(`${env.COOKIE_NAME}=`);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Expires=Thu, 01 Jan 1970');
  });

  it('uses Secure and SameSite=None cookies in production configuration', async () => {
    await register();
    const productionApp = createApp({
      env: {
        NODE_ENV: 'production',
        JWT_SECRET: 'production-test-secret-with-at-least-32-characters',
        FRONTEND_URL: 'https://frontend.example.com',
        MONGODB_URI: 'mongodb://localhost:27017/devpilot-auth-test',
      },
    });

    const response = await request(productionApp).post('/api/v1/auth/login').send({
      email: 'user@example.com',
      password: 'password123',
    });
    const setCookie = setCookieHeader(response);

    expect(response.status).toBe(200);
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=None');
  });
});