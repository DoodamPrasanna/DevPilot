import type { Request, Response } from 'express';

import { env, type AppEnv } from '../config/env.js';

function expirationMilliseconds(configuration: AppEnv): number {
  const match = /^([1-9]\d*)(s|m|h|d)$/.exec(configuration.JWT_EXPIRES_IN);

  if (!match) {
    throw new Error('Invalid JWT expiration configuration');
  }

  const amount = Number(match[1]);
  const unitMilliseconds = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2] as 's' | 'm' | 'h' | 'd'];

  return amount * unitMilliseconds;
}

function cookieOptions(configuration: AppEnv) {
  const production = configuration.NODE_ENV === 'production';

  return {
    httpOnly: true,
    secure: production,
    sameSite: production ? ('none' as const) : ('lax' as const),
    path: '/',
  };
}

export function readAuthCookie(request: Request, configuration: AppEnv = env): string | undefined {
  const cookieHeader = request.headers.cookie;

  if (!cookieHeader) {
    return undefined;
  }

  for (const cookie of cookieHeader.split(';')) {
    const separator = cookie.indexOf('=');

    if (separator < 0 || cookie.slice(0, separator).trim() !== configuration.COOKIE_NAME) {
      continue;
    }

    try {
      return decodeURIComponent(cookie.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
  }

  return undefined;
}

export function setAuthCookie(response: Response, token: string, configuration: AppEnv = env): void {
  response.cookie(configuration.COOKIE_NAME, token, {
    ...cookieOptions(configuration),
    maxAge: expirationMilliseconds(configuration),
  });
}

export function clearAuthCookie(response: Response, configuration: AppEnv = env): void {
  response.clearCookie(configuration.COOKIE_NAME, cookieOptions(configuration));
}