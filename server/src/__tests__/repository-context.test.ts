import { describe, expect, it } from 'vitest';

import { GithubApiError, type GithubContentEntry, type GithubRepositoryClient, type GithubRepositoryFile } from '../clients/github.client.js';
import type { ContextRepository, RepositoryContextLimits } from '../services/repository-context.service.js';
import { retrieveRepositoryContext } from '../services/repository-context.service.js';

const repository: ContextRepository = {
  githubOwner: 'octo-org',
  githubRepo: 'devpilot',
  defaultBranch: 'main',
};

const limits: RepositoryContextLimits = {
  maxFiles: 6,
  maxFileChars: 10_000,
  maxTotalChars: 24_000,
  maxTreeEntries: 250,
  maxDirectoryDepth: 3,
  maxTreeRequests: 24,
};

class StubGithubClient implements GithubRepositoryClient {
  directories = new Map<string, GithubContentEntry[]>();
  files = new Map<string, GithubRepositoryFile>();
  treeCalls: Array<{ path: string; branch: string }> = [];
  fileCalls: Array<{ path: string; branch: string }> = [];
  failure: Error | undefined;

  async getRepository(): Promise<never> {
    throw new Error('Repository metadata should not be fetched by context retrieval');
  }

  async getRepositoryContents(_owner: string, _repo: string, path: string, branch: string): Promise<GithubContentEntry[]> {
    this.treeCalls.push({ path, branch });
    if (this.failure) throw this.failure;
    return this.directories.get(path) ?? [];
  }

  async getRepositoryFile(_owner: string, _repo: string, path: string, branch: string): Promise<GithubRepositoryFile> {
    this.fileCalls.push({ path, branch });
    if (this.failure) throw this.failure;
    const file = this.files.get(path);
    if (!file) throw new GithubApiError('not_found');
    return file;
  }
}

function textFile(path: string, content: string, size = content.length): GithubRepositoryFile {
  return {
    name: path.split('/').at(-1) ?? path,
    path,
    type: 'file',
    size,
    content: Buffer.from(content).toString('base64'),
    encoding: 'base64',
  };
}

describe('repository context retrieval', () => {
  it('prioritizes and fetches an explicitly mentioned validated path', async () => {
    const github = new StubGithubClient();
    github.directories.set('', [
      { name: 'src', path: 'src', type: 'directory' },
      { name: 'README.md', path: 'README.md', type: 'file', size: 10 },
    ]);
    github.directories.set('src', [
      { name: 'App.tsx', path: 'src/App.tsx', type: 'file', size: 10 },
      { name: 'other.ts', path: 'src/other.ts', type: 'file', size: 10 },
    ]);
    github.files.set('src/App.tsx', textFile('src/App.tsx', 'export const app = true;'));
    github.files.set('src/other.ts', textFile('src/other.ts', 'export const unrelated = true;'));
    github.files.set('README.md', textFile('README.md', '# Project purpose'));

    const result = await retrieveRepositoryContext(repository, 'Explain src/App.tsx', github, { ...limits, maxFiles: 1 });

    expect(result.files.map((file) => file.path)).toEqual(['src/App.tsx']);
    expect(github.fileCalls[0]).toEqual({ path: 'src/App.tsx', branch: 'main' });
    expect(github.treeCalls).toHaveLength(0);
  });

  it('ranks authentication filenames for authentication questions', async () => {
    const github = new StubGithubClient();
    github.directories.set('', [
      { name: 'report.ts', path: 'report.ts', type: 'file', size: 5 },
      { name: 'auth.service.ts', path: 'auth.service.ts', type: 'file', size: 5 },
    ]);
    github.files.set('report.ts', textFile('report.ts', 'report'));
    github.files.set('auth.service.ts', textFile('auth.service.ts', 'authentication service'));

    const result = await retrieveRepositoryContext(repository, 'How does authentication work?', github, limits);

    expect(result.files[0]?.path).toBe('auth.service.ts');
  });

  it('uses directory path matches and favors README for project purpose questions', async () => {
    const github = new StubGithubClient();
    github.directories.set('', [
      { name: 'src', path: 'src', type: 'directory' },
      { name: 'routes', path: 'routes', type: 'directory' },
      { name: 'README.md', path: 'README.md', type: 'file', size: 15 },
    ]);
    github.directories.set('src', [{ name: 'routes', path: 'src/routes', type: 'directory' }]);
    github.directories.set('src/routes', [{ name: 'auth.ts', path: 'src/routes/auth.ts', type: 'file', size: 12 }]);
    github.directories.set('routes', [{ name: 'router.ts', path: 'routes/router.ts', type: 'file', size: 10 }]);
    github.files.set('README.md', textFile('README.md', '# Overall project purpose'));
    github.files.set('src/routes/auth.ts', textFile('src/routes/auth.ts', 'route authentication'));
    github.files.set('routes/router.ts', textFile('routes/router.ts', 'route registration'));

    const routeResult = await retrieveRepositoryContext(repository, 'Explain how the routes work', github, limits);
    const purposeResult = await retrieveRepositoryContext(repository, 'Explain the main purpose of this repository', github, limits);

    expect(routeResult.files[0]?.path).toContain('routes/');
    expect(purposeResult.files[0]?.path).toBe('README.md');
    expect(github.treeCalls.some((call) => call.path === 'src/routes')).toBe(true);
  });

  it('excludes generated/vendor directories and lockfiles', async () => {
    const github = new StubGithubClient();
    github.directories.set('', [
      { name: 'node_modules', path: 'node_modules', type: 'directory' },
      { name: 'dist', path: 'dist', type: 'directory' },
      { name: 'vendor', path: 'vendor', type: 'directory' },
      { name: 'package-lock.json', path: 'package-lock.json', type: 'file', size: 10 },
      { name: 'src', path: 'src', type: 'directory' },
    ]);
    github.directories.set('src', [{ name: 'app.ts', path: 'src/app.ts', type: 'file', size: 8 }]);
    github.files.set('package-lock.json', textFile('package-lock.json', 'lock data'));
    github.files.set('src/app.ts', textFile('src/app.ts', 'source code'));

    const result = await retrieveRepositoryContext(repository, 'Explain the app', github, limits);

    expect(result.files.map((file) => file.path)).toEqual(['src/app.ts']);
    expect(github.treeCalls.map((call) => call.path)).not.toContain('node_modules');
    expect(github.treeCalls.map((call) => call.path)).not.toContain('dist');
    expect(github.treeCalls.map((call) => call.path)).not.toContain('vendor');
    expect(github.fileCalls.map((call) => call.path)).not.toContain('package-lock.json');
  });

  it('enforces file count, per-file, total-character, depth, and tree request limits', async () => {
    const github = new StubGithubClient();
    github.directories.set('', [
      { name: 'alpha.ts', path: 'alpha.ts', type: 'file', size: 200 },
      { name: 'beta.ts', path: 'beta.ts', type: 'file', size: 200 },
      { name: 'deep', path: 'deep', type: 'directory' },
    ]);
    github.directories.set('deep', [{ name: 'nested', path: 'deep/nested', type: 'directory' }]);
    github.directories.set('deep/nested', [{ name: 'gamma.ts', path: 'deep/nested/gamma.ts', type: 'file', size: 200 }]);
    github.files.set('alpha.ts', textFile('alpha.ts', 'a'.repeat(200)));
    github.files.set('beta.ts', textFile('beta.ts', 'b'.repeat(200)));
    github.files.set('deep/nested/gamma.ts', textFile('deep/nested/gamma.ts', 'c'.repeat(200)));

    const bounded = await retrieveRepositoryContext(repository, 'Explain alpha and beta and gamma', github, {
      ...limits,
      maxFiles: 2,
      maxFileChars: 80,
      maxTotalChars: 130,
      maxDirectoryDepth: 1,
      maxTreeRequests: 2,
    });

    expect(bounded.files).toHaveLength(2);
    expect(Math.max(...bounded.files.map((file) => file.content.length))).toBeLessThanOrEqual(80);
    expect(bounded.totalCharacters).toBeLessThanOrEqual(130);
    expect(bounded.files.some((file) => file.content.includes('[Repository file truncated due to context limit]'))).toBe(true);
    expect(github.treeCalls).toHaveLength(2);
    expect(bounded.files.map((file) => file.path)).not.toContain('deep/nested/gamma.ts');
  });

  it('caps total discovered tree entries across all directory responses', async () => {
    const github = new StubGithubClient();
    github.directories.set('', [
      { name: 'alpha.ts', path: 'alpha.ts', type: 'file', size: 3 },
      { name: 'beta.ts', path: 'beta.ts', type: 'file', size: 3 },
      { name: 'gamma.ts', path: 'gamma.ts', type: 'file', size: 3 },
      { name: 'deeper', path: 'deeper', type: 'directory' },
    ]);
    github.files.set('alpha.ts', textFile('alpha.ts', 'aaa'));
    github.files.set('beta.ts', textFile('beta.ts', 'bbb'));
    github.files.set('gamma.ts', textFile('gamma.ts', 'ccc'));

    const result = await retrieveRepositoryContext(repository, 'Explain alpha and beta', github, {
      ...limits,
      maxTreeEntries: 2,
    });

    expect(result.files.map((file) => file.path)).toEqual(['alpha.ts', 'beta.ts']);
    expect(github.treeCalls).toEqual([{ path: '', branch: 'main' }]);
  });

  it('returns empty bounded context for an empty repository', async () => {
    const github = new StubGithubClient();

    await expect(retrieveRepositoryContext(repository, 'Explain the project', github, limits)).resolves.toEqual({
      files: [],
      totalCharacters: 0,
    });
    expect(github.treeCalls).toEqual([{ path: '', branch: 'main' }]);
  });

  it('skips binary and unsupported files and returns empty context when no candidates match', async () => {
    const github = new StubGithubClient();
    github.directories.set('', [
      { name: 'image.png', path: 'image.png', type: 'file', size: 4 },
      { name: 'library.bin', path: 'library.bin', type: 'file', size: 4 },
      { name: 'broken.ts', path: 'broken.ts', type: 'file', size: 4 },
      { name: 'large.ts', path: 'large.ts', type: 'file', size: 1_048_577 },
      { name: 'unknown-size.ts', path: 'unknown-size.ts', type: 'file' },
    ]);
    github.files.set('image.png', { ...textFile('image.png', '\0\0'), content: 'AAABAA==', size: 4 });
    github.files.set('library.bin', { ...textFile('library.bin', 'binary'), type: 'unsupported' });
    github.files.set('broken.ts', { ...textFile('broken.ts', 'bad'), content: 'AAABAA==', size: 4 });
    github.files.set('large.ts', textFile('large.ts', 'large source', 1_048_577));
    github.files.set('unknown-size.ts', { ...textFile('unknown-size.ts', 'unknown size'), size: undefined });

    const result = await retrieveRepositoryContext(repository, 'Describe unrelated authentication service', github, limits);
    const oversizedPath = await retrieveRepositoryContext(repository, 'Explain large.ts', github, limits);
    const unknownSizePath = await retrieveRepositoryContext(repository, 'Explain unknown-size.ts', github, limits);

    expect(result).toEqual({ files: [], totalCharacters: 0 });
    expect(oversizedPath).toEqual({ files: [], totalCharacters: 0 });
    expect(unknownSizePath).toEqual({ files: [], totalCharacters: 0 });
  });

  it('rejects traversal as an exact path and never forwards that path to GitHub', async () => {
    const github = new StubGithubClient();
    github.directories.set('', [{ name: 'README.md', path: 'README.md', type: 'file', size: 4 }]);
    github.files.set('README.md', textFile('README.md', 'readme'));

    await retrieveRepositoryContext(repository, 'Explain ../secret.ts', github, limits);

    expect(github.fileCalls.some((call) => call.path.includes('..'))).toBe(false);
  });

  it('rejects traversal-like paths returned by an upstream repository tree', async () => {
    const github = new StubGithubClient();
    github.directories.set('', [
      { name: 'escape.ts', path: '../escape.ts', type: 'file', size: 20 },
      { name: 'inside.ts', path: 'src/../inside.ts', type: 'file', size: 20 },
      { name: 'safe', path: 'safe', type: 'directory' },
    ]);
    github.directories.set('safe', [{ name: 'app.ts', path: 'safe/app.ts', type: 'file', size: 3 }]);
    github.files.set('safe/app.ts', textFile('safe/app.ts', 'app'));

    const result = await retrieveRepositoryContext(repository, 'Explain escape.ts and inside.ts', github, limits);

    expect(github.fileCalls).not.toContain('../escape.ts');
    expect(github.fileCalls).not.toContain('src/../inside.ts');
    expect(result.files.every((file) => !file.path.includes('..'))).toBe(true);
  });

  it('normalizes GitHub upstream failures without leaking provider details', async () => {
    const github = new StubGithubClient();
    github.failure = Object.assign(new Error('raw GitHub response token=secret'), { kind: 'rate_limited' });

    await expect(retrieveRepositoryContext(repository, 'Explain the routes', github, limits)).rejects.toMatchObject({
      code: 'REPOSITORY_CONTEXT_RATE_LIMITED',
      message: 'GitHub is temporarily rate limiting repository context requests',
    });
    await expect(retrieveRepositoryContext(repository, 'Explain the routes', github, limits))
      .rejects.not.toHaveProperty('message', expect.stringContaining('token=secret'));
  });
});