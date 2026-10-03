import type { RequestHandler } from 'express';

import { AppError } from '../utils/app-error.js';

interface RateLimitOptions {
  bucket: string;
  limit: number;
  windowMilliseconds: number;
  maxTrackedClients?: number;
}

interface RateWindow {
  count: number;
  resetAt: number;
}

export function createRateLimitMiddleware(options: RateLimitOptions): RequestHandler {
  const windows = new Map<string, RateWindow>();
  const maxTrackedClients = options.maxTrackedClients ?? 10_000;
  let requestCount = 0;

  return (request, response, next) => {
    const now = Date.now();
    requestCount += 1;
    if (requestCount % 64 === 0) {
      for (const [key, window] of windows) {
        if (window.resetAt <= now) windows.delete(key);
      }
    }

    const principal = request.user?.id ?? request.ip ?? request.socket.remoteAddress ?? 'unknown';
    const key = `${options.bucket}:${principal}`;
    let current = windows.get(key);
    if (!current || current.resetAt <= now) {
      if (!current && windows.size >= maxTrackedClients) {
        next(new AppError('Request limiter is temporarily at capacity', {
          statusCode: 503,
          code: 'RATE_LIMITER_CAPACITY',
        }));
        return;
      }
      current = { count: 0, resetAt: now + options.windowMilliseconds };
      windows.set(key, current);
    }

    current.count += 1;
    if (current.count > options.limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
      response.setHeader('Retry-After', String(retryAfterSeconds));
      next(new AppError('Too many requests. Please wait before trying again.', {
        statusCode: 429,
        code: 'RATE_LIMIT_EXCEEDED',
      }));
      return;
    }

    next();
  };
}
