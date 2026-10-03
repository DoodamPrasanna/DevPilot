import type { RequestHandler } from 'express';
import mongoose from 'mongoose';

import { env, type AppEnv } from '../config/env.js';
import { AppError } from '../utils/app-error.js';
import { readAuthCookie } from '../utils/auth-cookie.js';
import { verifyAuthToken } from '../utils/jwt.js';
import { getCurrentUser } from '../services/auth.service.js';

export function authMiddleware(configuration: AppEnv = env): RequestHandler {
  return (request, _response, next) => {
    const token = readAuthCookie(request, configuration);
    const payload = token ? verifyAuthToken(token, configuration) : null;

    if (!payload || !/^[a-f\d]{24}$/i.test(payload.sub) || !mongoose.Types.ObjectId.isValid(payload.sub)) {
      next(new AppError('Authentication required', { statusCode: 401, code: 'UNAUTHORIZED' }));
      return;
    }

    void getCurrentUser(payload.sub)
      .then((user) => {
        if (!user) {
          next(new AppError('Authentication required', { statusCode: 401, code: 'UNAUTHORIZED' }));
          return;
        }

        request.user = user;
        next();
      })
      .catch(next);
  };
}