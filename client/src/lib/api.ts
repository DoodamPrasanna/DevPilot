const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
const API_BASE_URL = (configuredBaseUrl || 'http://127.0.0.1:5000').replace(/\/+$/, '');

type ApiEnvelope<T> = {
  success: boolean;
  data?: T;
  error?: { code?: string; message?: string };
};

export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string;

  constructor(
    status: number,
    code: string,
  ) {
    super(userFriendlyErrorMessage(status, code));
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export function userFriendlyErrorMessage(status: number, code: string): string {
  const knownMessages: Record<string, string> = {
    INVALID_CREDENTIALS: 'The email or password is incorrect.',
    EMAIL_ALREADY_EXISTS: 'An account with this email already exists.',
    VALIDATION_ERROR: 'Please check the information and try again.',
    REPOSITORY_ALREADY_CONNECTED: 'That repository is already connected.',
    GITHUB_REPOSITORY_NOT_FOUND: 'That public GitHub repository could not be found.',
    PRIVATE_REPOSITORY_NOT_SUPPORTED: 'Only public GitHub repositories can be connected.',
    GITHUB_RATE_LIMITED: 'GitHub is temporarily rate limiting requests. Try again shortly.',
    GITHUB_API_AUTHENTICATION_FAILED: 'GitHub could not complete that request. Try again shortly.',
    GITHUB_UNAVAILABLE: 'GitHub is temporarily unavailable. Try again shortly.',
    REPOSITORY_NOT_FOUND: 'This repository is unavailable or you do not have access to it.',
    GITHUB_CONTENT_NOT_FOUND: 'That repository path could not be found.',
    PATH_IS_DIRECTORY: 'Select a file to view its contents.',
    FILE_TOO_LARGE: 'This file is too large to preview.',
    UNSUPPORTED_FILE_CONTENT: 'This file type cannot be previewed as text.',
    CONVERSATION_NOT_FOUND: 'This conversation is unavailable.',
    AI_PROVIDER_NOT_CONFIGURED: 'AI chat is not configured on this server.',
    AI_PROVIDER_RATE_LIMITED: 'The AI service is busy. Try again shortly.',
    AI_PROVIDER_TIMEOUT: 'The AI response took too long. Please try again.',
    AI_PROVIDER_INVALID_RESPONSE: 'The AI service could not provide a response. Please try again.',
    AI_PROVIDER_UNAVAILABLE: 'Unable to generate a response right now. Please try again.',
    AI_ANALYSIS_INVALID_RESPONSE: 'The AI returned an invalid analysis. Please try again.',
    AI_TEST_GENERATION_INVALID_RESPONSE: 'The AI returned invalid test suggestions. Please try again.',
    REPOSITORY_ANALYSIS_CONTEXT_UNAVAILABLE: 'No relevant repository files were available for analysis.',
    REPOSITORY_TEST_CONTEXT_UNAVAILABLE: 'No relevant repository files were available for test generation.',
    REPOSITORY_TEST_FRAMEWORK_UNSUPPORTED: 'Test suggestions currently support TypeScript, JavaScript, and Python source files.',
    REPOSITORY_INDEX_IN_PROGRESS: 'Repository indexing is already in progress.',
    REPOSITORY_INDEX_UNAVAILABLE: 'Repository indexing could not complete. Please try again.',
    RATE_LIMIT_EXCEEDED: 'You have made too many requests. Please wait before trying again.',
    CSRF_ORIGIN_REJECTED: 'This request origin is not allowed. Reload the app and try again.',
  };

  if (knownMessages[code]) return knownMessages[code];
  if (status === 401) return 'Your session has expired. Please sign in again.';
  if (status === 403) return 'You do not have permission to perform this action.';
  if (status === 404) return 'The requested item could not be found.';
  if (status === 409) return 'This item already exists.';
  if (status === 413) return 'The request is too large.';
  if (status === 429) return 'Too many requests. Please wait and try again.';
  if (status >= 500) return 'The server is temporarily unavailable. Please try again.';
  return 'The request could not be completed. Please try again.';
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}/api/v1${path}`, {
      ...options,
      credentials: 'include',
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR');
  }

  const payload = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;

  if (!response.ok || !payload?.success || payload.data === undefined) {
    const code = payload?.error?.code ?? 'REQUEST_FAILED';
    if (response.status === 401) {
      window.dispatchEvent(new Event('devpilot:unauthorized'));
    }
    throw new ApiError(response.status, code);
  }

  return payload.data;
}

export type AuthUser = {
  id: string;
  email: string;
  createdAt: string;
};

export type Repository = {
  id: string;
  githubOwner: string;
  githubRepo: string;
  githubFullName: string;
  defaultBranch: string;
  description: string;
  htmlUrl: string;
  indexingStatus: 'pending' | 'indexing' | 'ready' | 'failed';
  indexedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type RepositoryTreeEntry = {
  name: string;
  path: string;
  type: 'file' | 'directory' | 'symlink' | 'submodule' | 'unsupported';
  size?: number;
};

export type RepositoryFile = {
  name: string;
  path: string;
  size: number;
  content: string;
};

export type Conversation = {
  id: string;
  title: string;
  repositoryId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ConversationMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  sources?: string[];
  createdAt: string;
  updatedAt: string;
};

export type ConversationRepository = Pick<
  Repository,
  'id' | 'githubOwner' | 'githubRepo' | 'githubFullName' | 'defaultBranch' | 'description' | 'htmlUrl'
>;

export type ConversationDetail = {
  conversation: Conversation;
  repository: ConversationRepository | null;
  messages: ConversationMessage[];
};

export type RepositoryAnalysis = {
  factualFindings: Array<{ statement: string; confidence: 'high' | 'medium' | 'low'; sourcePaths: string[] }>;
  suggestions: Array<{ statement: string; sourcePaths: string[] }>;
  uncertainties: string[];
  sources: string[];
};

export type GeneratedRepositoryTests = {
  framework: 'vitest' | 'pytest';
  fileName: string;
  code: string;
  notes: string[];
  label: 'Generated suggestion; not executed or verified.';
  sources: string[];
};

export const authApi = {
  register(email: string, password: string) {
    return request<{ user: AuthUser }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  },
  login(email: string, password: string) {
    return request<{ user: AuthUser }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  },
  logout() {
    return request<{ message: string }>('/auth/logout', { method: 'POST' });
  },
  me() {
    return request<{ user: AuthUser }>('/auth/me');
  },
};

export const repositoryApi = {
  list() {
    return request<{ repositories: Repository[] }>('/repositories');
  },
  get(repositoryId: string) {
    return request<{ repository: Repository }>(`/repositories/${encodeURIComponent(repositoryId)}`);
  },
  connect(githubOwner: string, githubRepo: string) {
    return request<{ repository: Repository }>('/repositories', {
      method: 'POST',
      body: JSON.stringify({ githubOwner, githubRepo }),
    });
  },
  tree(repositoryId: string, path = '') {
    const query = new URLSearchParams();
    if (path) query.set('path', path);
    return request<{ entries: RepositoryTreeEntry[] }>(
      `/repositories/${encodeURIComponent(repositoryId)}/tree${query.size ? `?${query}` : ''}`,
    );
  },
  file(repositoryId: string, path: string) {
    const query = new URLSearchParams({ path });
    return request<{ file: RepositoryFile }>(
      `/repositories/${encodeURIComponent(repositoryId)}/file?${query}`,
    );
  },
  index(repositoryId: string) {
    return request<{ indexing: { status: 'ready'; filesIndexed: number; chunksIndexed: number; charactersIndexed: number; embeddingsCreated: boolean; indexedAt: string } }>(
      `/repositories/${encodeURIComponent(repositoryId)}/index`,
      { method: 'POST' },
    );
  },
};

export const conversationApi = {
  create(input: { title?: string; repositoryId?: string } = {}) {
    return request<{ conversation: Conversation }>('/conversations', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
  list() {
    return request<{ conversations: Conversation[] }>('/conversations');
  },
  get(conversationId: string) {
    return request<ConversationDetail>(`/conversations/${encodeURIComponent(conversationId)}`);
  },
  sendMessage(conversationId: string, content: string) {
    return request<{ userMessage: ConversationMessage; assistantMessage: ConversationMessage; sources?: string[] }>(
      `/conversations/${encodeURIComponent(conversationId)}/messages`,
      { method: 'POST', body: JSON.stringify({ content }) },
    );
  },
  analyze(
    conversationId: string,
    question: string,
    analysisType: 'explain' | 'bugs' | 'smells' | 'security' | 'function' | 'interactions' | 'improvements' = 'explain',
  ) {
    return request<{ analysis: RepositoryAnalysis }>(
      `/conversations/${encodeURIComponent(conversationId)}/analyze`,
      { method: 'POST', body: JSON.stringify({ question, analysisType }) },
    );
  },
  generateTests(conversationId: string, question: string) {
    return request<{ tests: GeneratedRepositoryTests }>(
      `/conversations/${encodeURIComponent(conversationId)}/tests`,
      { method: 'POST', body: JSON.stringify({ question }) },
    );
  },
};