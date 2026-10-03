import mongoose from 'mongoose';

import { env } from './env.js';
import { logger } from '../utils/logger.js';

let connectionPromise: Promise<typeof mongoose> | undefined;

function sanitizedMongoError(error: unknown, uri: string): Record<string, string | number> {
  const details = typeof error === 'object' && error !== null ? error as Record<string, unknown> : {};
  const uriCredentials = (() => {
    try {
      const parsedUri = new URL(uri);
      return [parsedUri.username, parsedUri.password].flatMap((credential) => {
        if (!credential) {
          return [];
        }

        try {
          return [credential, decodeURIComponent(credential)];
        } catch {
          return [credential];
        }
      });
    } catch {
      return [];
    }
  })();

  const sanitize = (value: string) => {
    let sanitized = value.replace(/mongodb(?:\+srv)?:\/\/[^\s"'<>]+/gi, '[REDACTED_MONGODB_URI]');
    for (const credential of uriCredentials) {
      sanitized = sanitized.split(credential).join('[REDACTED]');
    }
    return sanitized.replace(/[\r\n\t]/g, ' ').slice(0, 1_000);
  };

  const name = typeof details.name === 'string' ? details.name : 'UnknownMongoError';
  const message = typeof details.message === 'string' ? details.message : 'Unknown MongoDB error';
  const code = details.code;

  return {
    mongoErrorName: sanitize(name),
    ...(typeof code === 'string' || typeof code === 'number' ? { mongoErrorCode: typeof code === 'string' ? sanitize(code) : code } : {}),
    mongoErrorMessage: sanitize(message),
  };
}

export function getDatabaseStatus(): 'connected' | 'unavailable' {
  return mongoose.connection.readyState === 1 ? 'connected' : 'unavailable';
}

export async function connectDatabase(uri = env.MONGODB_URI): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) {
    return mongoose;
  }

  if (connectionPromise) {
    return connectionPromise;
  }

  connectionPromise = mongoose
    .connect(uri, { serverSelectionTimeoutMS: 8_000, connectTimeoutMS: 8_000 })
    .then(() => mongoose)
    .catch((error: unknown) => {
      logger.error('MongoDB connection failed', sanitizedMongoError(error, uri));
      throw new Error('MongoDB connection failed. Check MONGODB_URI and database availability.');
    })
    .finally(() => {
      connectionPromise = undefined;
    });

  return connectionPromise;
}

export async function disconnectDatabase(): Promise<void> {
  if (connectionPromise) {
    await connectionPromise.catch(() => undefined);
  }

  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}
