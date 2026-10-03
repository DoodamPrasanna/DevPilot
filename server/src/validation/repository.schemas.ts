import { z } from 'zod';

const githubOwner = z
  .string()
  .trim()
  .min(1, 'GitHub owner is required')
  .max(39, 'GitHub owner is too long')
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/, 'GitHub owner is invalid');

const githubRepo = z
  .string()
  .trim()
  .min(1, 'GitHub repository is required')
  .max(100, 'GitHub repository is too long')
  .regex(/^[A-Za-z0-9_.-]+$/, 'GitHub repository is invalid')
  .refine((value) => value !== '.' && value !== '..', 'GitHub repository is invalid');

export const createRepositorySchema = z.object({ githubOwner, githubRepo });
export const repositoryIdSchema = z.object({ id: z.string().regex(/^[a-f\d]{24}$/i, 'Repository ID is invalid') });

const repositoryPath = z
  .string()
  .trim()
  .max(1024, 'Repository path is too long')
  .refine((path) => {
    if (path === '') return true;
    if (
      path.includes('\0') ||
      path.includes('\\') ||
      path.startsWith('/') ||
      /^[A-Za-z]:/.test(path) ||
      path.endsWith('/') ||
      path.includes('//')
    ) {
      return false;
    }

    return path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
  }, 'Repository path is invalid');

export const repositoryExplorerParamsSchema = z.object({
  repositoryId: z.string().regex(/^[a-f\d]{24}$/i, 'Repository ID is invalid'),
});
export const repositoryTreeQuerySchema = z.object({ path: repositoryPath.default('') });
export const repositoryFileQuerySchema = z.object({
  path: repositoryPath.refine((path) => path.length > 0, 'File path is required'),
});