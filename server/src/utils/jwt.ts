import jwt, { type SignOptions } from 'jsonwebtoken';

import { env, type AppEnv } from '../config/env.js';

export interface AuthTokenPayload {
  sub: string;
}

export function signAuthToken(userId: string, configuration: AppEnv = env): string {
  return jwt.sign({ sub: userId }, configuration.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: configuration.JWT_EXPIRES_IN as NonNullable<SignOptions['expiresIn']>,
  });
}

export function verifyAuthToken(token: string, configuration: AppEnv = env): AuthTokenPayload | null {
  try {
    const payload = jwt.verify(token, configuration.JWT_SECRET, { algorithms: ['HS256'] });

    if (typeof payload !== 'object' || typeof payload.sub !== 'string') {
      return null;
    }

    return { sub: payload.sub };
  } catch {
    return null;
  }
}