import { z } from 'zod';

export type GithubApiFailureKind = 'not_found' | 'rate_limited' | 'authentication' | 'unavailable';

export class GithubApiError extends Error {
  constructor(public readonly kind: GithubApiFailureKind) {
    super('GitHub API request failed');
    this.name = 'GithubApiError';
  }
}

export interface GithubRepositoryMetadata {
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  description: string;
  htmlUrl: string;
  isPrivate: boolean;
  visibility?: string | null;
}

export type GithubContentType = 'file' | 'directory' | 'symlink' | 'submodule' | 'unsupported';

export interface GithubContentEntry {
  name: string;
  path: string;
  type: GithubContentType;
  size?: number;
}

export interface GithubRepositoryFile extends GithubContentEntry {
  content?: string;
  encoding?: string;
}

export interface GithubRepositoryClient {
  getRepository(owner: string, repository: string): Promise<GithubRepositoryMetadata>;
  getRepositoryContents(owner: string, repository: string, path: string, branch: string): Promise<GithubContentEntry[]>;
  getRepositoryFile(owner: string, repository: string, path: string, branch: string): Promise<GithubRepositoryFile>;
}

const repositoryResponseSchema = z.object({
  owner: z.object({ login: z.string().min(1) }),
  name: z.string().min(1),
  full_name: z.string().min(1),
  default_branch: z.string().min(1),
  description: z.string().nullable(),
  html_url: z.string().url(),
  private: z.boolean().default(false),
  visibility: z.string().nullable().optional(),
});

const contentsEntrySchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  type: z.string().min(1),
  size: z.number().int().nonnegative().optional(),
  content: z.string().optional(),
  encoding: z.string().optional(),
});

function normalizedContentType(type: string): GithubContentType {
  switch (type) {
    case 'file':
      return 'file';
    case 'dir':
      return 'directory';
    case 'symlink':
      return 'symlink';
    case 'submodule':
      return 'submodule';
    default:
      return 'unsupported';
  }
}

function normalizeContentEntry(value: unknown): GithubRepositoryFile {
  const parsed = contentsEntrySchema.safeParse(value);

  if (!parsed.success) {
    throw new GithubApiError('unavailable');
  }

  return {
    name: parsed.data.name,
    path: parsed.data.path,
    type: normalizedContentType(parsed.data.type),
    ...(parsed.data.size === undefined ? {} : { size: parsed.data.size }),
    ...(parsed.data.content === undefined ? {} : { content: parsed.data.content }),
    ...(parsed.data.encoding === undefined ? {} : { encoding: parsed.data.encoding }),
  };
}

export function createGithubRepositoryClient(fetchImplementation: typeof fetch = fetch): GithubRepositoryClient {
  async function fetchContents(owner: string, repository: string, path: string, branch: string): Promise<unknown> {
    const encodedPath = path ? `/${path.split('/').map(encodeURIComponent).join('/')}` : '';
    const url = new URL(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/contents${encodedPath}`,
    );
    url.searchParams.set('ref', branch);
    let response: Response;

    try {
      response = await fetchImplementation(url, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'DevPilot',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      throw new GithubApiError('unavailable');
    }

    if (response.status === 404) throw new GithubApiError('not_found');
    if (response.status === 403 || response.status === 429) throw new GithubApiError('rate_limited');
    if (response.status === 401) throw new GithubApiError('authentication');
    if (!response.ok) throw new GithubApiError('unavailable');

    try {
      return await response.json();
    } catch {
      throw new GithubApiError('unavailable');
    }
  }

  return {
    async getRepository(owner, repository) {
      const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`;
      let response: Response;

      try {
        response = await fetchImplementation(url, {
          headers: {
            Accept: 'application/vnd.github+json',
            'User-Agent': 'DevPilot',
            'X-GitHub-Api-Version': '2022-11-28',
          },
          signal: AbortSignal.timeout(8000),
        });
      } catch {
        throw new GithubApiError('unavailable');
      }

      if (response.status === 404) {
        throw new GithubApiError('not_found');
      }

      if (response.status === 403 || response.status === 429) {
        throw new GithubApiError('rate_limited');
      }

      if (response.status === 401) {
        throw new GithubApiError('authentication');
      }

      if (!response.ok) {
        throw new GithubApiError('unavailable');
      }

      let responseBody: unknown;

      try {
        responseBody = await response.json();
      } catch {
        throw new GithubApiError('unavailable');
      }

      const parsed = repositoryResponseSchema.safeParse(responseBody);

      if (!parsed.success) {
        throw new GithubApiError('unavailable');
      }

      return {
        owner: parsed.data.owner.login,
        name: parsed.data.name,
        fullName: parsed.data.full_name,
        defaultBranch: parsed.data.default_branch,
        description: parsed.data.description ?? '',
        htmlUrl: parsed.data.html_url,
        isPrivate: parsed.data.private,
        visibility: parsed.data.visibility,
      };
    },
    async getRepositoryContents(owner, repository, path, branch) {
      const responseBody = await fetchContents(owner, repository, path, branch);
      const entries = Array.isArray(responseBody) ? responseBody : [responseBody];
      return entries.map((entry) => {
        const normalized = normalizeContentEntry(entry);
        return {
          name: normalized.name,
          path: normalized.path,
          type: normalized.type,
          ...(normalized.size === undefined ? {} : { size: normalized.size }),
        };
      });
    },
    async getRepositoryFile(owner, repository, path, branch) {
      const responseBody = await fetchContents(owner, repository, path, branch);

      if (Array.isArray(responseBody)) {
        const name = path.split('/').at(-1) ?? path;
        return { name, path, type: 'directory' };
      }

      return normalizeContentEntry(responseBody);
    },
  };
}

export const githubRepositoryClient = createGithubRepositoryClient();