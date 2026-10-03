import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';

import { createApp } from '../app.js';
import { loadEnv } from '../config/env.js';

describe('DevPilot backend foundation', () => {
  it('returns healthy API status', async () => {
    const app = createApp();

    const response = await request(app).get('/api/v1/health');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      status: 'ok',
      service: 'devpilot-server',
      database: 'unavailable',
    });
  });

  it('rejects cross-origin state changes while allowing the configured frontend origin', async () => {
    const app = createApp({ env: { FRONTEND_URL: 'https://devpilot.example' } });
    const rejected = await request(app)
      .post('/api/v1/conversations')
      .set('Origin', 'https://attacker.example')
      .send({});
    const allowed = await request(app)
      .post('/api/v1/conversations')
      .set('Origin', 'https://devpilot.example')
      .send({});
    const fetchMetadataRejected = await request(app)
      .post('/api/v1/auth/logout')
      .set('Sec-Fetch-Site', 'cross-site');

    expect(rejected.status).toBe(403);
    expect(rejected.body.error.code).toBe('CSRF_ORIGIN_REJECTED');
    expect(allowed.status).toBe(401);
    expect(fetchMetadataRejected.status).toBe(403);
  });

  it('rate limits repeated authentication attempts and includes Retry-After', async () => {
    const app = createApp();
    const responses = [];
    for (let attempt = 0; attempt < 11; attempt += 1) {
      responses.push(await request(app).post('/api/v1/auth/login').send({}));
    }

    expect(responses.slice(0, 10).every((response) => response.status === 400)).toBe(true);
    expect(responses[10]?.status).toBe(429);
    expect(responses[10]?.headers['retry-after']).toBeDefined();
    expect(responses[10]?.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('uses the client IP appended by Render and ignores spoofed earlier forwarding entries', async () => {
    vi.stubEnv('RENDER', 'true');
    try {
      const app = createApp({
        env: {
          NODE_ENV: 'production',
          FRONTEND_URL: 'https://devpilot.example',
          JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long',
          MONGODB_URI: 'mongodb://localhost:27017/devpilot-test',
        },
      });
      expect(app.get('trust proxy')).toBe(1);

      for (let attempt = 0; attempt < 10; attempt += 1) {
        const response = await request(app)
          .post('/api/v1/auth/login')
          .set('X-Forwarded-For', `198.51.100.${attempt + 1}, 203.0.113.7`)
          .send({});
        expect(response.status).toBe(400);
      }

      const separateClient = await request(app)
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', '192.0.2.1, 203.0.113.8')
        .send({});
      const sameClientWithSpoofedPrefix = await request(app)
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', '192.0.2.99, 203.0.113.7')
        .send({});

      expect(separateClient.status).toBe(400);
      expect(sameClientWithSpoofedPrefix.status).toBe(429);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('does not trust forwarded IP headers in development', async () => {
    const app = createApp({ env: { NODE_ENV: 'development' } });
    expect(app.get('trust proxy')).toBe(false);

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', `203.0.113.${attempt + 1}`)
        .send({});
      expect(response.status).toBe(400);
    }

    const response = await request(app)
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', '192.0.2.200')
      .send({});
    expect(response.status).toBe(429);
  });

  it('returns a consistent 404 format for unknown API routes', async () => {
    const app = createApp();

    const response = await request(app).get('/api/v1/does-not-exist');

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Route not found',
      },
    });
  });

  it('returns a consistent 404 format for unknown non-API routes', async () => {
    const app = createApp();

    const response = await request(app).get('/random-route');

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Route not found',
      },
    });
  });

  it('returns a safe error shape for unexpected failures', async () => {
    const app = createApp();

    app.get('/api/v1/test-error', () => {
      throw new Error('boom');
    });

    const response = await request(app).get('/api/v1/test-error');

    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
      },
    });
    expect(response.body.error.message).toBeDefined();
  });

  it('maps duplicate database errors to a safe conflict response', async () => {
    const app = createApp();

    app.get('/api/v1/test-database-error', () => {
      throw Object.assign(new Error('Mongo duplicate key details'), { code: 11000 });
    });

    const response = await request(app).get('/api/v1/test-database-error');

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: 'DUPLICATE_RESOURCE',
        message: 'A record with this value already exists',
      },
    });
    expect(JSON.stringify(response.body)).not.toContain('Mongo duplicate key details');
  });

  it('does not expose internal database error details', async () => {
    const app = createApp();

    app.get('/api/v1/test-database-failure', () => {
      const error = Object.assign(new Error('mongodb://private-user:private-password@database.example'), {
        name: 'MongoServerError',
      });
      throw error;
    });

    const response = await request(app).get('/api/v1/test-database-failure');

    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: 'A database error occurred',
      },
    });
    expect(JSON.stringify(response.body)).not.toContain('private-password');
  });

  it('validates required environment values and rejects invalid config', () => {
    expect(() =>
      loadEnv({
        NODE_ENV: 'development',
        PORT: 'bad-port',
        FRONTEND_URL: 'not-a-url',
      }),
    ).toThrow();

    expect(() =>
      loadEnv({
        NODE_ENV: 'production',
        MONGODB_URI: undefined,
      }),
    ).toThrow('MONGODB_URI is required in production');

    expect(() => loadEnv({ MONGODB_URI: 'https://not-a-mongodb-uri.example' })).toThrow();
    expect(() => loadEnv({ NODE_ENV: 'production', JWT_SECRET: undefined, MONGODB_URI: 'mongodb://localhost/devpilot' }))
      .toThrow('JWT_SECRET is required in production');
    expect(() => loadEnv({
      NODE_ENV: 'production',
      JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long',
      FRONTEND_URL: undefined,
      MONGODB_URI: 'mongodb://localhost/devpilot',
    })).toThrow('FRONTEND_URL is required in production');
    expect(() => loadEnv({
      NODE_ENV: 'production',
      JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long',
      FRONTEND_URL: 'http://devpilot.example',
      MONGODB_URI: 'mongodb://localhost/devpilot',
    })).toThrow('FRONTEND_URL must be an HTTPS origin');
    expect(() => loadEnv({
      NODE_ENV: 'production',
      JWT_SECRET: 'short',
      FRONTEND_URL: 'https://devpilot.example',
      MONGODB_URI: 'mongodb://localhost/devpilot',
    })).toThrow();
    expect(() => loadEnv({
      NODE_ENV: 'production',
      JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long',
      FRONTEND_URL: 'https://devpilot.example/path',
      MONGODB_URI: 'mongodb://localhost/devpilot',
    })).toThrow('FRONTEND_URL must be an HTTPS origin');

    vi.stubEnv('RENDER', 'true');
    try {
      expect(() => loadEnv({
        NODE_ENV: undefined,
        JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long',
        FRONTEND_URL: 'https://devpilot.example',
        MONGODB_URI: 'mongodb://localhost/devpilot',
      })).toThrow('NODE_ENV must be explicitly set to production on Render');
      expect(() => loadEnv({
        NODE_ENV: 'development',
        JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long',
        FRONTEND_URL: 'https://devpilot.example',
        MONGODB_URI: 'mongodb://localhost/devpilot',
      })).toThrow('NODE_ENV must be explicitly set to production on Render');
      expect(loadEnv({
        NODE_ENV: 'production',
        JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long',
        FRONTEND_URL: 'https://devpilot.example',
        MONGODB_URI: 'mongodb://localhost/devpilot',
      }).NODE_ENV).toBe('production');
    } finally {
      vi.unstubAllEnvs();
    }

    vi.stubEnv('RENDER', '');
    try {
      const development = loadEnv({
        NODE_ENV: undefined,
        FRONTEND_URL: undefined,
        JWT_SECRET: undefined,
        MONGODB_URI: undefined,
      });
      expect(development.NODE_ENV).toBe('development');
      expect(development.FRONTEND_URL).toBe('http://127.0.0.1:5173');
      expect(development.MONGODB_URI).toBe('mongodb://localhost:27017/devpilot');
      expect(development.JWT_SECRET).toBeTruthy();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('allows configured frontend origin and rejects others', async () => {
    const app = createApp({
      env: {
        FRONTEND_URL: 'http://127.0.0.1:5173',
      },
    });

    const allowed = await request(app)
      .get('/api/v1/health')
      .set('Origin', 'http://127.0.0.1:5173');

    expect(allowed.headers['access-control-allow-origin']).toBe('http://127.0.0.1:5173');
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');

    const rejected = await request(app)
      .get('/api/v1/health')
      .set('Origin', 'http://malicious.example');

    expect(rejected.headers['access-control-allow-origin']).toBeUndefined();

    const alternateLocalhost = await request(app)
      .get('/api/v1/health')
      .set('Origin', 'http://localhost:5173');

    expect(alternateLocalhost.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('enforces a reasonable request body limit', async () => {
    const app = createApp();

    const largePayload = 'x'.repeat(2 * 1024 * 1024);

    const response = await request(app)
      .post('/api/v1/health')
      .set('Content-Type', 'application/json')
      .send({ payload: largePayload });

    expect(response.status).toBe(413);
    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: expect.any(String),
      },
    });
  });
});
