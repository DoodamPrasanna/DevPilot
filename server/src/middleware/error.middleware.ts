import type { NextFunction, Request, Response } from 'express';

import { env } from '../config/env.js';

export function errorHandler(
  error: Error & { status?: number; statusCode?: number; code?: string | number },
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  const isDuplicateKey = error.code === 11000;
  const isValidationError = error.name === 'ValidationError';
  const isCastError = error.name === 'CastError';
  const isDatabaseError = error.name.startsWith('Mongo') || error.name.startsWith('Mongoose');
  const isPayloadTooLarge = error.statusCode === 413 || error.status === 413;
  const statusCode = isDuplicateKey
    ? 409
    : isValidationError || isCastError
      ? 400
      : error.statusCode ?? error.status ?? 500;
  const code = isDuplicateKey
    ? 'DUPLICATE_RESOURCE'
    : isValidationError
      ? 'VALIDATION_ERROR'
      : isCastError
        ? 'INVALID_IDENTIFIER'
        : isDatabaseError
          ? 'DATABASE_ERROR'
        : isPayloadTooLarge
          ? error.name === 'AppError' && typeof error.code === 'string'
            ? error.code
            : 'PAYLOAD_TOO_LARGE'
          : typeof error.code === 'string'
            ? error.code
            : 'INTERNAL_SERVER_ERROR';
  const safeDatabaseMessage = isDuplicateKey
    ? 'A record with this value already exists'
    : isValidationError
      ? 'The provided data is invalid'
      : isCastError
        ? 'The supplied identifier is invalid'
        : isDatabaseError
          ? 'A database error occurred'
        : undefined;
  const message = safeDatabaseMessage ?? (env.NODE_ENV === 'production' ? 'Something went wrong' : error.message || 'Something went wrong');

  res.status(statusCode).json({
    success: false,
    error: {
      code,
      message,
    },
  });
}
