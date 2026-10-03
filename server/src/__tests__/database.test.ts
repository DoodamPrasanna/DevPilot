import mongoose from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { connectDatabase } from '../config/database.js';
import { logger } from '../utils/logger.js';

describe('database connection diagnostics', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs sanitized MongoDB diagnostics and uses a bounded connection timeout', async () => {
    const uri = 'mongodb+srv://demo-user:demo-password@cluster.example/devpilot';
    const connectionError = Object.assign(
      new Error(`Authentication failed for demo-user:demo-password at ${uri}`),
      { name: 'MongoServerSelectionError', code: 'ETIMEDOUT' },
    );
    const connect = vi.spyOn(mongoose, 'connect').mockRejectedValue(connectionError);
    const errorLog = vi.spyOn(logger, 'error').mockImplementation(() => {});

    await expect(connectDatabase(uri)).rejects.toThrow(
      'MongoDB connection failed. Check MONGODB_URI and database availability.',
    );

    expect(connect).toHaveBeenCalledWith(uri, {
      serverSelectionTimeoutMS: 8_000,
      connectTimeoutMS: 8_000,
    });
    expect(errorLog).toHaveBeenCalledWith('MongoDB connection failed', {
      mongoErrorName: 'MongoServerSelectionError',
      mongoErrorCode: 'ETIMEDOUT',
      mongoErrorMessage: 'Authentication failed for [REDACTED]:[REDACTED] at [REDACTED_MONGODB_URI]',
    });
    const loggedDiagnostics = JSON.stringify(errorLog.mock.calls);
    expect(loggedDiagnostics).not.toContain(uri);
    expect(loggedDiagnostics).not.toContain('demo-password');
  });
});
