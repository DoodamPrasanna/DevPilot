import { Router } from 'express';

import { env, type AppEnv } from '../config/env.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { createRateLimitMiddleware } from '../middleware/rate-limit.middleware.js';
import { AppError } from '../utils/app-error.js';
import { clearAuthCookie, setAuthCookie } from '../utils/auth-cookie.js';
import { validateRequest } from '../utils/validate.js';
import { loginSchema, registerSchema } from '../validation/auth.schemas.js';
import { loginUser, registerUser } from '../services/auth.service.js';

export function createAuthRouter(configuration: AppEnv = env) {
  const router = Router();
  const credentialRateLimit = createRateLimitMiddleware({
    bucket: 'credentials',
    limit: 10,
    windowMilliseconds: 15 * 60 * 1000,
  });

  router.post('/register', credentialRateLimit, async (request, response, next) => {
    try {
      const credentials = validateRequest(registerSchema, request.body, 'request body');
      const user = await registerUser(credentials.email, credentials.password);

      response.status(201).json({ success: true, data: { user } });
    } catch (error) {
      next(error);
    }
  });

  router.post('/login', credentialRateLimit, async (request, response, next) => {
    try {
      const credentials = validateRequest(loginSchema, request.body, 'request body');
      const result = await loginUser(credentials.email, credentials.password, configuration);

      setAuthCookie(response, result.token, configuration);
      response.status(200).json({ success: true, data: { user: result.user } });
    } catch (error) {
      next(error);
    }
  });

  router.post('/logout', (_request, response) => {
    clearAuthCookie(response, configuration);
    response.status(200).json({ success: true, data: { message: 'Logged out' } });
  });

  router.get('/me', authMiddleware(configuration), (request, response, next) => {
    if (!request.user) {
      next(new AppError('Authentication required', { statusCode: 401, code: 'UNAUTHORIZED' }));
      return;
    }

    response.status(200).json({ success: true, data: { user: request.user } });
  });

  return router;
}