import type { GithubApiFailureKind, GithubContentEntry, GithubRepositoryClient } from '../clients/github.client.js';
import { env } from '../config/env.js';
import { repositoryFileQuerySchema } from '../validation/repository.schemas.js';
import type { Repository } from '../models/repository.model.js';
import { AppError } from '../utils/app-error.js';

export interface RepositoryContextLimits {
  maxFiles: number;
  maxFileChars: number;
  maxTotalChars: number;
  maxTreeEntries: number;
  maxDirectoryDepth: number;
  maxTreeRequests: number;
}

export interface RepositoryContextFile {
  path: string;
  content: string;
}

export interface RepositoryContext {
  files: RepositoryContextFile[];
  totalCharacters: number;
}

export type ContextRepository = Pick<Repository, 'githubOwner' | 'githubRepo' | 'defaultBranch'>;

export const DEFAULT_REPOSITORY_CONTEXT_LIMITS: RepositoryContextLimits = {
  maxFiles: env.MAX_REPOSITORY_CONTEXT_FILES,
  maxFileChars: env.MAX_REPOSITORY_CONTEXT_FILE_CHARS,
  maxTotalChars: env.MAX_REPOSITORY_CONTEXT_TOTAL_CHARS,
  maxTreeEntries: env.MAX_REPOSITORY_CONTEXT_TREE_ENTRIES,
  maxDirectoryDepth: env.MAX_REPOSITORY_CONTEXT_DIRECTORY_DEPTH,
  maxTreeRequests: env.MAX_REPOSITORY_CONTEXT_TREE_REQUESTS,
};

const sourceExtensions = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.go', '.rs', '.cpp', '.c', '.h', '.hpp', '.cs', '.html',
  '.css', '.scss', '.json', '.md', '.yml', '.yaml', '.toml', '.xml', '.sh', '.sql', '.vue', '.svelte',
]);

const excludedDirectories = new Set([
  '.git', 'node_modules', 'dist', 'build', 'coverage', 'vendor', 'target', '.next', '.nuxt', 'out',
  'generated', '__generated__', 'vendor_modules',
]);

const stopWords = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'can', 'does', 'for', 'from', 'how', 'i', 'in', 'is', 'it', 'me',
  'of', 'on', 'or', 'please', 'the', 'this', 'to', 'what', 'which', 'with', 'you', 'explain', 'show',
]);

const tokenAliases: Record<string, string[]> = {
  auth: ['authentication', 'login'],
  authentication: ['auth', 'login'],
  route: ['routes', 'router'],
  routes: ['route', 'router'],
  router: ['route', 'routes'],
  component: ['components'],
  components: ['component'],
  config: ['configuration'],
  configuration: ['config'],
};

const truncationMarker = '\n[Repository file truncated due to context limit]';
const exactPathPattern = /(?:^|[^A-Za-z0-9_])((?:[A-Za-z0-9_.@-]+\/)*[A-Za-z0-9_.@-]+\.[A-Za-z0-9]{1,12})(?=$|[^A-Za-z0-9_])/g;

function contextUnavailable(kind: GithubApiFailureKind): AppError {
  const rateLimited = kind === 'rate_limited';
  const notFound = kind === 'not_found';
  return new AppError(
    notFound ? 'Repository context could not be found' : rateLimited ? 'GitHub is temporarily rate limiting repository context requests' : 'Repository context is temporarily unavailable',
    {
      statusCode: notFound ? 404 : 503,
      code: notFound ? 'REPOSITORY_CONTEXT_NOT_FOUND' : rateLimited ? 'REPOSITORY_CONTEXT_RATE_LIMITED' : 'REPOSITORY_CONTEXT_UNAVAILABLE',
    },
  );
}

function isExcludedPath(path: string): boolean {
  const segments = path.toLowerCase().split('/');
  if (segments.some((segment) => excludedDirectories.has(segment))) return true;

  const filename = segments.at(-1) ?? '';
  return /(^|\.)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|composer\.lock|cargo\.lock|gemfile\.lock|poetry\.lock|pipfile\.lock)$/.test(filename);
}

function isSupportedSourceFile(path: string): boolean {
  const filename = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  const extension = filename.slice(filename.lastIndexOf('.'));
  return sourceExtensions.has(extension);
}

function pathTokens(path: string): Set<string> {
  const expanded = path.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2');
  return new Set(expanded.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 1));
}

function queryTokens(question: string): string[] {
  return [...pathTokens(question)].filter((token) => !stopWords.has(token));
}

function exactMentionedPath(question: string): string | undefined {
  exactPathPattern.lastIndex = 0;
  const match = exactPathPattern.exec(question);
  if (!match) return undefined;

  const candidate = match[1].replace(/[),.;:!?]+$/, '');
  return repositoryFileQuerySchema.safeParse({ path: candidate }).success ? candidate : undefined;
}

function scoreFile(path: string, question: string, query: string[], exactPath: string | undefined): number {
  if (exactPath && path.toLowerCase() === exactPath.toLowerCase()) return 100_000;

  const tokens = pathTokens(path);
  const filename = path.slice(path.lastIndexOf('/') + 1);
  const filenameTokens = pathTokens(filename);
  let score = 0;

  for (const token of query) {
    const aliases = tokenAliases[token] ?? [];
    if (filenameTokens.has(token) || aliases.some((alias) => filenameTokens.has(alias))) score += 12;
    else if (tokens.has(token) || aliases.some((alias) => tokens.has(alias))) score += 5;
  }

  const metadataIntent = /\b(purpose|overview|architecture|project|repository|setup|dependencies|build|configuration)\b/i.test(question);
  const baseName = filename.toLowerCase();
  if (metadataIntent && (baseName === 'readme.md' || baseName === 'readme')) score += 16;
  if (/\b(dependencies|package|build|setup)\b/i.test(question) && (baseName === 'package.json' || baseName === 'tsconfig.json')) score += 10;
  if (/\b(build|vite|frontend)\b/i.test(question) && /^vite\.config\./i.test(baseName)) score += 8;

  return score;
}

function decodeSupportedText(content: string | undefined, encoding: string | undefined): string | null {
  if (content === undefined || encoding !== 'base64') return null;
  const normalized = content.replace(/\s/g, '');
  if (!/^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/.test(normalized)) return null;

  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(normalized, 'base64'));
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) return null;
    return text;
  } catch {
    return null;
  }
}

function truncateContent(content: string, maximum: number): string {
  if (content.length <= maximum) return content;
  if (maximum <= truncationMarker.length) return content.slice(0, maximum);
  return `${content.slice(0, maximum - truncationMarker.length)}${truncationMarker}`;
}

function sortTreeEntries(entries: GithubContentEntry[]): GithubContentEntry[] {
  return [...entries].sort((left, right) => left.name.toLowerCase().localeCompare(right.name.toLowerCase()) || left.path.localeCompare(right.path));
}

export async function retrieveRepositoryContext(
  repository: ContextRepository,
  question: string,
  githubClient: GithubRepositoryClient,
  limits: RepositoryContextLimits = DEFAULT_REPOSITORY_CONTEXT_LIMITS,
): Promise<RepositoryContext> {
  const exactPath = exactMentionedPath(question);
  const candidates = new Map<string, number>();
  const selectedFiles: RepositoryContextFile[] = [];
  let totalCharacters = 0;

  const addFile = (path: string, text: string) => {
    if (selectedFiles.length >= limits.maxFiles || totalCharacters >= limits.maxTotalChars) return;
    const maximum = Math.min(limits.maxFileChars, limits.maxTotalChars - totalCharacters);
    if (maximum <= 0) return;
    if (text.length > maximum && maximum <= truncationMarker.length) return;
    const content = truncateContent(text, maximum);
    selectedFiles.push({ path, content });
    totalCharacters += content.length;
  };

  if (exactPath && !isExcludedPath(exactPath)) {
    try {
      const exactFile = await githubClient.getRepositoryFile(
        repository.githubOwner,
        repository.githubRepo,
        exactPath,
        repository.defaultBranch,
      );
      if (exactFile.type === 'file' && exactFile.size !== undefined && exactFile.size <= env.MAX_REPOSITORY_FILE_SIZE_BYTES) {
        const text = decodeSupportedText(exactFile.content, exactFile.encoding);
        if (text !== null) addFile(exactFile.path, text);
      }
    } catch (error) {
      if (!(error instanceof Error) || !('kind' in error) || error.kind !== 'not_found') {
        if (error instanceof Error && 'kind' in error) {
          throw contextUnavailable(error.kind as GithubApiFailureKind);
        }
        throw contextUnavailable('unavailable');
      }
    }
  }

  if (selectedFiles.length > 0) {
    return { files: selectedFiles, totalCharacters };
  }

  const queue: Array<{ path: string; depth: number }> = [{ path: '', depth: 0 }];
  let treeRequests = 0;
  let treeEntries = 0;

  while (queue.length > 0 && treeRequests < limits.maxTreeRequests && treeEntries < limits.maxTreeEntries) {
    const directory = queue.shift();
    if (!directory) break;
    let entries: GithubContentEntry[];

    try {
      entries = await githubClient.getRepositoryContents(
        repository.githubOwner,
        repository.githubRepo,
        directory.path,
        repository.defaultBranch,
      );
    } catch (error) {
      if (error instanceof Error && 'kind' in error) {
        throw contextUnavailable(error.kind as GithubApiFailureKind);
      }
      throw contextUnavailable('unavailable');
    }

    treeRequests += 1;
    for (const entry of sortTreeEntries(entries)) {
      if (treeEntries >= limits.maxTreeEntries) break;
      treeEntries += 1;
      const safePath = repositoryFileQuerySchema.safeParse({ path: entry.path });
      if (!safePath.success || isExcludedPath(safePath.data.path)) continue;
      const path = safePath.data.path;

      if (entry.type === 'directory') {
        if (directory.depth < limits.maxDirectoryDepth) {
          queue.push({ path, depth: directory.depth + 1 });
        }
        continue;
      }

      if (entry.type === 'file' && isSupportedSourceFile(path)) {
        const score = scoreFile(path, question, queryTokens(question), exactPath);
        if (score > 0) candidates.set(path, Math.max(score, candidates.get(path) ?? 0));
      }
    }
  }

  const rankedCandidates = [...candidates.entries()]
    .filter(([path]) => !selectedFiles.some((file) => file.path === path))
    .sort(([leftPath, leftScore], [rightPath, rightScore]) => rightScore - leftScore || leftPath.localeCompare(rightPath));

  for (const [path] of rankedCandidates) {
    if (selectedFiles.length >= limits.maxFiles || totalCharacters >= limits.maxTotalChars) break;

    let file;
    try {
      file = await githubClient.getRepositoryFile(
        repository.githubOwner,
        repository.githubRepo,
        path,
        repository.defaultBranch,
      );
    } catch (error) {
      if (error instanceof Error && 'kind' in error && error.kind === 'not_found') continue;
      if (error instanceof Error && 'kind' in error) throw contextUnavailable(error.kind as GithubApiFailureKind);
      throw contextUnavailable('unavailable');
    }

    if (file.type !== 'file' || file.size === undefined || file.size > env.MAX_REPOSITORY_FILE_SIZE_BYTES) continue;
    const text = decodeSupportedText(file.content, file.encoding);
    if (text !== null) addFile(file.path, text);
  }

  return { files: selectedFiles, totalCharacters };
}