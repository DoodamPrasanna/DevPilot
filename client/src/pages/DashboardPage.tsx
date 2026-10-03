import { ArrowUpRight, GitBranch, ShieldCheck, Star } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { ApiError, conversationApi, repositoryApi, userFriendlyErrorMessage, type Conversation, type Repository } from '../lib/api';

export function DashboardPage() {
  const navigate = useNavigate();
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = async () => {
    try {
      const [repositoryResult, conversationResult] = await Promise.all([repositoryApi.list(), conversationApi.list()]);
      setRepositories(repositoryResult.repositories);
      setConversations(conversationResult.conversations);
    } catch (requestError) {
      setError(requestError instanceof ApiError
        ? requestError.message
        : userFriendlyErrorMessage(500, 'REQUEST_FAILED'));
    } finally {
      setLoading(false);
    }
  };

  const retryDashboard = () => {
    setLoading(true);
    setError(null);
    void loadDashboard();
  };

  useEffect(() => {
    let active = true;
    void Promise.all([repositoryApi.list(), conversationApi.list()])
      .then(([repositoryResult, conversationResult]) => {
        if (!active) return;
        setRepositories(repositoryResult.repositories);
        setConversations(conversationResult.conversations);
      })
      .catch((requestError: unknown) => {
        if (!active) return;
        setError(requestError instanceof ApiError
          ? requestError.message
          : userFriendlyErrorMessage(500, 'REQUEST_FAILED'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, []);

  const featuredRepo = repositories[0];

  return (
    <div className="space-y-6">
      {loading ? <LoadingState label="Loading your workspace..." /> : error ? (
        <div>
          <ErrorState title="Workspace unavailable" message={error} />
          <button type="button" onClick={retryDashboard} className="mx-auto mt-4 block rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:border-cyan-400/50">Retry</button>
        </div>
      ) : (
        <>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-400">Repositories</p><p className="mt-2 text-2xl font-semibold text-white">{repositories.length}</p></div>
            <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-400">Conversations</p><p className="mt-2 text-2xl font-semibold text-white">{conversations.length}</p></div>
            <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-400">Chat history</p><p className="mt-2 text-sm font-medium text-cyan-200">Persisted to your account</p></div>
            <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-400">Repository context</p><p className="mt-2 text-sm font-medium text-slate-200">Bounded files in repository chats</p></div>
          </section>

          <section className="grid gap-6 xl:grid-cols-[1.4fr_0.6fr]">
            <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5 shadow-lg shadow-slate-950/20">
              {featuredRepo ? <>
              <div className="mb-5 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.28em] text-cyan-300">Featured repo</p>
                  <h2 className="mt-2 text-xl font-semibold text-white">{featuredRepo.githubFullName}</h2>
                </div>
                <Link
                  to={`/repositories/${featuredRepo.id}`}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 hover:border-cyan-400/40 hover:text-white"
                >
                  Open
                  <ArrowUpRight className="h-4 w-4" />
                </Link>
              </div>

              <p className="max-w-xl text-sm text-slate-300">{featuredRepo.description}</p>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Default branch</p>
                  <p className="mt-2 text-lg font-semibold text-white">{featuredRepo.defaultBranch}</p>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Connected</p>
                  <p className="mt-2 text-lg font-semibold text-white">{new Date(featuredRepo.createdAt).toLocaleDateString()}</p>
                </div>
              </div>
              </> : <EmptyState title="No repositories yet" description="Connect a public GitHub repository to browse its files." actionLabel="Connect a repository" onAction={() => navigate('/repositories?connect=1')} />}
            </div>

            <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5">
              <p className="text-xs uppercase tracking-[0.28em] text-cyan-300">Recent conversations</p>
              <div className="mt-4 space-y-2">
                {conversations.slice(0, 4).map((conversation) => (
                  <Link key={conversation.id} to={`/chat?conversationId=${encodeURIComponent(conversation.id)}`} className="block rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-200 hover:border-cyan-500/30">
                    <span className="block truncate">{conversation.title}</span>
                    <span className="mt-1 block text-xs text-slate-500">{new Date(conversation.updatedAt).toLocaleString()}</span>
                  </Link>
                ))}
                {conversations.length === 0 ? <p className="text-sm text-slate-400">No conversations yet.</p> : null}
                <Link to="/chat" className="inline-flex items-center gap-1 pt-2 text-sm font-medium text-cyan-300 hover:text-cyan-200">Open chat <ArrowUpRight className="h-4 w-4" /></Link>
              </div>
            </div>
          </section>

          <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white">Repositories</h3>
                <Link to="/repositories" className="text-sm font-medium text-cyan-300 hover:text-cyan-200">
                  View all
                </Link>
              </div>

              <div className="space-y-3">
                {repositories.map((repo) => (
                  <Link
                    key={repo.id}
                    to={`/repositories/${repo.id}`}
                    className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-950/50 p-4 hover:border-cyan-500/30 hover:bg-slate-900"
                  >
                    <div>
                      <p className="text-sm font-medium text-white">{repo.githubFullName}</p>
                      <p className="mt-1 text-xs text-slate-400">{repo.description || `Default branch: ${repo.defaultBranch}`}</p>
                    </div>
                    <span className="text-xs text-slate-500">{new Date(repo.updatedAt).toLocaleDateString()}</span>
                  </Link>
                ))}
                {repositories.length === 0 ? <p className="text-sm text-slate-400">No connected repositories.</p> : null}
              </div>
            </div>

            <div className="space-y-4 rounded-3xl border border-slate-800 bg-slate-900/80 p-5">
              <h3 className="text-lg font-semibold text-white">Workspace</h3>
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-300">
                <p className="flex items-center gap-2"><GitBranch className="h-4 w-4 text-cyan-300" /> Public repositories only</p>
                <p className="mt-3 flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-emerald-300" /> Your data is scoped to your account</p>
                <p className="mt-3 flex items-center gap-2"><Star className="h-4 w-4 text-amber-300" /> AI chat does not receive repository files</p>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
