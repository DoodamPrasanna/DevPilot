import type { RequestHandler } from 'express';

import { AppError } from '../utils/app-error.js';

const stateChangingMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function csrfOriginMiddleware(frontendUrl: string): RequestHandler {
  const allowedOrigin = new URL(frontendUrl).origin;

  return (request, _response, next) => {
    if (!stateChangingMethods.has(request.method)) {
      next();
      return;
    }

    const origin = request.get('origin');
    if (origin) {
      try {
        if (new URL(origin).origin !== allowedOrigin) {
          next(new AppError('Request origin is not allowed', { statusCode: 403, code: 'CSRF_ORIGIN_REJECTED' }));
          return;
        }
      } catch {
        next(new AppError('Request origin is not allowed', { statusCode: 403, code: 'CSRF_ORIGIN_REJECTED' }));
        return;
      }
    } else if (request.get('sec-fetch-site')?.toLowerCase() === 'cross-site') {
      next(new AppError('Cross-site request is not allowed', { statusCode: 403, code: 'CSRF_ORIGIN_REJECTED' }));
      return;
    }

    next();
  };
}
