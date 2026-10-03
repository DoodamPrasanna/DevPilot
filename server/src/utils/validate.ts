import type { ZodSchema } from 'zod';

import { AppError } from './app-error.js';

export function validateRequest<T>(schema: ZodSchema<T>, data: unknown, fieldName: string): T {
  const parsed = schema.safeParse(data);

  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => issue.message).join(', ');
    throw new AppError(`Invalid ${fieldName}: ${details}`, {
      statusCode: 400,
      code: 'VALIDATION_ERROR',
    });
  }

  return parsed.data;
}
