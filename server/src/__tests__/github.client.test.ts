import { describe, expect, it, vi } from 'vitest';

import { createGithubRepositoryClient } from '../clients/github.client.js';

const githubResponse = {
  owner: { login: 'facebook' },
  name: 'react',
  full_name: 'facebook/react',
  default_branch: 'main',
  description: 'A UI library',
  html_url: 'https://github.com/facebook/react',
  private: false,
  visibility: 'public',
};

describe('GitHub repository client', () => {
  it('requests the public repository endpoint with GitHub headers and maps trusted metadata', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(githubResponse), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    const client = createGithubRepositoryClient(fetchMock);

    const result = await client.getRepository('facebook', 'react');
    const [url, options] = fetchMock.mock.calls[0];
    const headers = new Headers(options?.headers);

    expect(String(url)).toBe('https://api.github.com/repos/facebook/react');
    expect(headers.get('Accept')).toBe('application/vnd.github+json');
    expect(headers.get('User-Agent')).toBe('DevPilot');
    expect(result).toEqual({
      owner: 'facebook',
      name: 'react',
      fullName: 'facebook/react',
      defaultBranch: 'main',
      description: 'A UI library',
      htmlUrl: 'https://github.com/facebook/react',
      isPrivate: false,
      visibility: 'public',
    });
  });

  it('requests and normalizes Contents API entries using path and branch', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify([
        { name: 'src', path: 'src', type: 'dir' },
        { name: 'App.tsx', path: 'App.tsx', type: 'file', size: 12, sha: 'not-exposed' },
        { name: 'link', path: 'link', type: 'symlink', size: 4 },
        { name: 'vendor', path: 'vendor', type: 'submodule', size: 0 },
      ]), { status: 200 }),
    );
    const client = createGithubRepositoryClient(fetchMock);

    const result = await client.getRepositoryContents('facebook', 'react', 'src code', 'release/next');
    const [url] = fetchMock.mock.calls[0];

    expect(String(url)).toBe('https://api.github.com/repos/facebook/react/contents/src%20code?ref=release%2Fnext');
    expect(result).toEqual([
      { name: 'src', path: 'src', type: 'directory' },
      { name: 'App.tsx', path: 'App.tsx', type: 'file', size: 12 },
      { name: 'link', path: 'link', type: 'symlink', size: 4 },
      { name: 'vendor', path: 'vendor', type: 'submodule', size: 0 },
    ]);
    expect(JSON.stringify(result)).not.toContain('not-exposed');
  });

  it('normalizes file content metadata without returning the raw response', async () => {
    const client = createGithubRepositoryClient(async () => new Response(JSON.stringify({
      name: 'App.tsx',
      path: 'src/App.tsx',
      type: 'file',
      size: 5,
      encoding: 'base64',
      content: 'aGVsbG8=',
      sha: 'not-exposed',
    }), { status: 200 }));

    await expect(client.getRepositoryFile('facebook', 'react', 'src/App.tsx', 'main')).resolves.toEqual({
      name: 'App.tsx',
      path: 'src/App.tsx',
      type: 'file',
      size: 5,
      encoding: 'base64',
      content: 'aGVsbG8=',
    });
  });

  it('normalizes a directory array returned for a file request', async () => {
    const client = createGithubRepositoryClient(async () => new Response(JSON.stringify([
      { name: 'App.tsx', path: 'src/App.tsx', type: 'file', size: 5 },
    ]), { status: 200 }));

    await expect(client.getRepositoryFile('facebook', 'react', 'src', 'main')).resolves.toEqual({
      name: 'src',
      path: 'src',
      type: 'directory',
    });
  });

  it.each([
    [404, 'not_found'],
    [403, 'rate_limited'],
    [429, 'rate_limited'],
    [500, 'unavailable'],
  ] as const)('maps Contents API HTTP %s to %s without provider data', async (status, kind) => {
    const client = createGithubRepositoryClient(async () => new Response('private provider error detail', { status }));

    await expect(client.getRepositoryContents('facebook', 'react', '', 'main')).rejects.toMatchObject({
      kind,
      message: 'GitHub API request failed',
    });
  });

  it('maps Contents API network and timeout failures to a sanitized unavailable error', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new DOMException('timeout with secret detail', 'TimeoutError'));
    const client = createGithubRepositoryClient(fetchMock);

    await expect(client.getRepositoryContents('facebook', 'react', 'src', 'main')).rejects.toMatchObject({
      kind: 'unavailable',
      message: 'GitHub API request failed',
    });
  });

  it.each([
    [404, 'not_found'],
    [403, 'rate_limited'],
    [429, 'rate_limited'],
    [401, 'authentication'],
    [500, 'unavailable'],
  ] as const)('maps GitHub HTTP status %s to %s', async (status, kind) => {
    const client = createGithubRepositoryClient(async () => new Response('sensitive upstream response', { status }));

    await expect(client.getRepository('facebook', 'react')).rejects.toMatchObject({ kind });
  });

  it('maps network failures without retaining provider error details', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error('token=github-secret-value'));
    const client = createGithubRepositoryClient(fetchMock);

    await expect(client.getRepository('facebook', 'react')).rejects.toMatchObject({
      kind: 'unavailable',
      message: 'GitHub API request failed',
    });
  });
});