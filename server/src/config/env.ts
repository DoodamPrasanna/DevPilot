import dotenv from 'dotenv';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

dotenv.config();

const ephemeralDevelopmentJwtSecret = randomBytes(32).toString('base64url');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).optional(),
  PORT: z.coerce.number().int().positive().default(5000),
  FRONTEND_URL: z.string().url().optional(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters').optional(),
  JWT_EXPIRES_IN: z.string().regex(/^[1-9]\d*(s|m|h|d)$/, 'JWT_EXPIRES_IN must be a positive duration such as 1d').default('1d'),
  COOKIE_NAME: z.string().regex(/^[A-Za-z0-9_-]+$/, 'COOKIE_NAME contains unsupported characters').default('devpilot_token'),
  MAX_REPOSITORY_FILE_SIZE_BYTES: z.coerce.number().int().positive().max(10 * 1024 * 1024).default(1024 * 1024),
  MAX_REPOSITORY_CONTEXT_FILES: z.coerce.number().int().positive().max(12).default(6),
  MAX_REPOSITORY_CONTEXT_FILE_CHARS: z.coerce.number().int().min(64).max(50_000).default(10_000),
  MAX_REPOSITORY_CONTEXT_TOTAL_CHARS: z.coerce.number().int().min(64).max(100_000).default(24_000),
  MAX_REPOSITORY_CONTEXT_TREE_ENTRIES: z.coerce.number().int().positive().max(2_000).default(250),
  MAX_REPOSITORY_CONTEXT_DIRECTORY_DEPTH: z.coerce.number().int().nonnegative().max(6).default(3),
  MAX_REPOSITORY_CONTEXT_TREE_REQUESTS: z.coerce.number().int().positive().max(24).default(8),
  MAX_REPOSITORY_INDEX_FILES: z.coerce.number().int().positive().max(500).default(100),
  MAX_REPOSITORY_INDEX_TREE_ENTRIES: z.coerce.number().int().positive().max(5_000).default(2_000),
  MAX_REPOSITORY_INDEX_TREE_REQUESTS: z.coerce.number().int().positive().max(200).default(100),
  MAX_REPOSITORY_INDEX_TOTAL_CHARS: z.coerce.number().int().positive().max(2_000_000).default(500_000),
  MAX_REPOSITORY_CHUNK_CHARS: z.coerce.number().int().min(256).max(8_000).default(3_000),
  MAX_REPOSITORY_RETRIEVED_CHUNKS: z.coerce.number().int().positive().max(20).default(6),
  MAX_REPOSITORY_RETRIEVAL_CHARS: z.coerce.number().int().positive().max(100_000).default(24_000),
  ATLAS_VECTOR_INDEX_NAME: z.string().trim().min(1).default('devpilot_repository_chunks'),
  GEMINI_EMBEDDING_MODEL: z.string().trim().min(1).default('gemini-embedding-001'),
  GEMINI_API_KEY: z.preprocess(
    (value) =>
      typeof value === 'string' &&
      (value.trim() === '' || value.trim() === 'your-gemini-api-key')
        ? undefined
        : value,
    z.string().trim().min(1).optional(),
  ),
  GEMINI_MODEL: z.string().trim().min(1).default('gemini-3.8-flash'),
  MONGODB_URI: z
    .string()
    .trim()
    .url()
    .refine((value) => value.startsWith('mongodb://') || value.startsWith('mongodb+srv://'), {
      message: 'Must be a MongoDB connection URI',
    })
    .optional(),
})
  .superRefine((configuration, context) => {
    if (configuration.NODE_ENV === 'production') {
      if (!configuration.FRONTEND_URL) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['FRONTEND_URL'],
          message: 'FRONTEND_URL is required in production',
        });
      } else if (URL.canParse(configuration.FRONTEND_URL)) {
        const frontendUrl = new URL(configuration.FRONTEND_URL);
        if (frontendUrl.protocol !== 'https:' || frontendUrl.origin !== configuration.FRONTEND_URL) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['FRONTEND_URL'],
            message: 'FRONTEND_URL must be an HTTPS origin without a path, query, or fragment in production',
          });
        }
      } else {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['FRONTEND_URL'],
          message: 'FRONTEND_URL must be a valid HTTPS origin in production',
        });
      }
    }

    if (configuration.NODE_ENV === 'production' && !configuration.JWT_SECRET) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_SECRET'],
        message: 'JWT_SECRET is required in production',
      });
    }

    if (configuration.NODE_ENV === 'production' && !configuration.MONGODB_URI) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MONGODB_URI'],
        message: 'MONGODB_URI is required in production',
      });
    }
  })
  .transform((configuration) => ({
    ...configuration,
    NODE_ENV: configuration.NODE_ENV ?? 'development',
    FRONTEND_URL: configuration.FRONTEND_URL ?? 'http://127.0.0.1:5173',
    JWT_SECRET: configuration.JWT_SECRET ?? ephemeralDevelopmentJwtSecret,
    MONGODB_URI: configuration.MONGODB_URI ?? 'mongodb://localhost:27017/devpilot',
  }));

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(overrides: Record<string, unknown> = {}): AppEnv {
  const mergedEnv = { ...process.env, ...overrides };

  if (
    (mergedEnv.RENDER === 'true' || typeof mergedEnv.RENDER_SERVICE_ID === 'string') &&
    mergedEnv.NODE_ENV !== 'production'
  ) {
    throw new Error('Invalid environment configuration: NODE_ENV must be explicitly set to production on Render');
  }

  const parsed = envSchema.safeParse(mergedEnv);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`)
      .join('; ');

    throw new Error(`Invalid environment configuration: ${issues}`);
  }

  return parsed.data;
}

export const env = loadEnv();
