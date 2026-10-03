import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';

import App from '../App';
import { AuthProvider } from '../context/AuthContext';
import { ChatPage } from '../pages/ChatPage';
import { RepositoriesPage } from '../pages/RepositoriesPage';
import { RepositoryDetailPage } from '../pages/RepositoryDetailPage';
import { ApiError, conversationApi, repositoryApi, type ConversationDetail, type Repository } from '../lib/api';

const user = { id: 'user-1', email: 'developer@example.com', createdAt: '2025-01-01T00:00:00.000Z' };

function response(status: number, data: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  } as Response;
}

function renderWithRouter(element: ReactNode, initialEntry: string) {
  return render(<MemoryRouter initialEntries={[initialEntry]}>{element}</MemoryRouter>);
}

function CurrentLocation() {
  const location = useLocation();
  return <output data-testid="current-location">{location.pathname}{location.search}</output>;
}

function repository(overrides: Partial<Repository> = {}): Repository {
  return {
    id: 'repo-1',
    githubOwner: 'octo-org',
    githubRepo: 'devpilot',
    githubFullName: 'octo-org/devpilot',
    defaultBranch: 'main',
    description: 'Public demo repository',
    htmlUrl: 'https://github.com/octo-org/devpilot',
    indexingStatus: 'pending',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function conversationDetail(overrides: Partial<ConversationDetail> = {}): ConversationDetail {
  const timestamp = '2025-01-01T00:00:00.000Z';
  return {
    conversation: {
      id: 'conversation-1',
      title: 'Repository discussion',
      repositoryId: 'repo-1',
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    repository: {
      id: 'repo-1',
      githubOwner: 'octo-org',
      githubRepo: 'devpilot',
      githubFullName: 'octo-org/devpilot',
      defaultBranch: 'main',
      description: '',
      htmlUrl: 'https://github.com/octo-org/devpilot',
    },
    messages: [{
      id: 'assistant-1',
      role: 'assistant',
      content: '<img src=x onerror=alert(1)>',
      sources: ['src/App.tsx#L1-L5'],
      createdAt: timestamp,
      updatedAt: timestamp,
    }],
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('client application flows', () => {
  it('protects dashboard routes, signs in, loads workspace data, and logs out', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/auth/me')) return response(401, { success: false, error: { code: 'UNAUTHORIZED' } });
      if (path.endsWith('/auth/login')) return response(200, { success: true, data: { user } });
      if (path.endsWith('/auth/logout')) return response(200, { success: true, data: { message: 'Logged out' } });
      if (path.endsWith('/repositories')) return response(200, { success: true, data: { repositories: [] } });
      if (path.endsWith('/conversations')) return response(200, { success: true, data: { conversations: [] } });
      throw new Error(`Unexpected API request: ${init?.method ?? 'GET'} ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/dashboard']}><App /></MemoryRouter>
      </AuthProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: user.email } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct horse battery staple' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'DevPilot workspace' })).toBeTruthy();
    expect(await screen.findByText('No repositories yet')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/auth/logout'),
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
  });

  it('connects a repository from the empty state and displays its indexing status', async () => {
    const list = vi.spyOn(repositoryApi, 'list').mockResolvedValue({ repositories: [] });
    const connect = vi.spyOn(repositoryApi, 'connect').mockResolvedValue({ repository: repository() });
    renderWithRouter(<RepositoriesPage />, '/repositories');

    const connectButtons = await screen.findAllByRole('button', { name: 'Connect repository' });
    fireEvent.click(connectButtons[0]!);
    fireEvent.change(screen.getByLabelText('Owner'), { target: { value: 'octo-org' } });
    fireEvent.change(screen.getByLabelText('Repository'), { target: { value: 'devpilot' } });
    fireEvent.click(screen.getByRole('button', { name: /^Connect$/ }));

    expect(await screen.findByText('Public demo repository')).toBeTruthy();
    expect(connect).toHaveBeenCalledWith('octo-org', 'devpilot');
    expect(list).toHaveBeenCalledOnce();
  });

  it('shows persisted source paths and renders AI text as text, not HTML', async () => {
    const list = vi.spyOn(conversationApi, 'list').mockResolvedValue({ conversations: [] });
    const get = vi.spyOn(conversationApi, 'get').mockResolvedValue(conversationDetail());
    renderWithRouter(<ChatPage />, '/chat?conversationId=conversation-1');

    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeTruthy();
    expect(screen.getByText('src/App.tsx#L1-L5')).toBeTruthy();
    expect(document.querySelector('img')).toBeNull();
    expect(get).toHaveBeenCalledWith('conversation-1');
    expect(list).toHaveBeenCalledOnce();
  });

  it('creates only one repository conversation when initialization adds its ID to the URL', async () => {
    const timestamp = '2025-01-01T00:00:00.000Z';
    const list = vi.spyOn(conversationApi, 'list').mockResolvedValue({ conversations: [] });
    const create = vi.spyOn(conversationApi, 'create').mockResolvedValue({
      conversation: {
        id: 'conversation-1',
        title: 'Repository discussion',
        repositoryId: 'repo-1',
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    });
    const get = vi.spyOn(conversationApi, 'get').mockResolvedValue(conversationDetail());

    render(
      <MemoryRouter initialEntries={['/chat?repositoryId=repo-1']}>
        <Routes>
          <Route path="/chat" element={<><ChatPage /><CurrentLocation /></>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('src/App.tsx#L1-L5')).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByTestId('current-location').textContent).toBe('/chat?conversationId=conversation-1');
    });
    expect(list).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith({ repositoryId: 'repo-1' });
    expect(get).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledWith('conversation-1');
  });

  it('surfaces a provider-unavailable state without hiding the current conversation', async () => {
    vi.spyOn(conversationApi, 'list').mockResolvedValue({ conversations: [] });
    vi.spyOn(conversationApi, 'get').mockResolvedValue(conversationDetail());
    vi.spyOn(conversationApi, 'sendMessage').mockRejectedValue(new ApiError(503, 'AI_PROVIDER_UNAVAILABLE'));
    renderWithRouter(<ChatPage />, '/chat?conversationId=conversation-1');
    await screen.findByText('src/App.tsx#L1-L5');

    fireEvent.change(screen.getByLabelText('Chat message'), { target: { value: 'Explain this source' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Unable to generate a response right now.');
    expect(screen.getByText('Repository discussion')).toBeTruthy();
  });

  it('shows indexing progress and reports when embeddings are unavailable', async () => {
    const connected = repository();
    const get = vi.spyOn(repositoryApi, 'get').mockResolvedValue({ repository: connected });
    vi.spyOn(repositoryApi, 'tree').mockResolvedValue({ entries: [] });
    const index = vi.spyOn(repositoryApi, 'index').mockResolvedValue({
      indexing: {
        status: 'ready',
        filesIndexed: 2,
        chunksIndexed: 3,
        charactersIndexed: 900,
        embeddingsCreated: false,
        indexedAt: '2025-01-01T00:00:00.000Z',
      },
    });
    render(
      <MemoryRouter initialEntries={['/repositories/repo-1']}>
        <Routes><Route path="/repositories/:repoId" element={<RepositoryDetailPage />} /></Routes>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Index repository' }));

    expect((await screen.findByRole('status')).textContent).toContain('Indexed 2 files into 3 chunks');
    expect(screen.getByRole('status').textContent).toContain('embeddings are not configured');
    expect(index).toHaveBeenCalledWith('repo-1');
    expect(get).toHaveBeenCalledTimes(2);
  });
});
