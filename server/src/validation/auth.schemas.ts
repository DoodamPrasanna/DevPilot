import { z } from 'zod';

const email = z.string().trim().email().transform((value) => value.toLowerCase());
const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters')
  .refine((value) => Buffer.byteLength(value, 'utf8') <= 72, 'Password must be at most 72 bytes');

export const registerSchema = z.object({ email, password });
export const loginSchema = z.object({ email, password });