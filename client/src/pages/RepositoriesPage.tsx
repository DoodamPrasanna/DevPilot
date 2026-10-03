import { ArrowUpRight, GitBranch, LoaderCircle, Plus, X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { ApiError, repositoryApi, type Repository } from '../lib/api';

export function RepositoriesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [connectOpen, setConnectOpen] = useState(searchParams.get('connect') === '1');
  const [owner, setOwner] = useState('');
  const [repositoryName, setRepositoryName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);

  const loadRepositories = async () => {
    try {
      const result = await repositoryApi.list();
      setRepositories(result.repositories);
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : 'Unable to load repositories. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const retryRepositories = () => {
    setLoading(true);
    setError(null);
    void loadRepositories();
  };

  useEffect(() => {
    let active = true;
    void repositoryApi.list()
      .then((result) => {
        if (active) setRepositories(result.repositories);
      })
      .catch((requestError: unknown) => {
        if (active) {
          setError(requestError instanceof ApiError ? requestError.message : 'Unable to load repositories. Please try again.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, []);

  const closeConnect = () => {
    setConnectOpen(false);
    setConnectError(null);
    const next = new URLSearchParams(searchParams);
    next.delete('connect');
    setSearchParams(next, { replace: true });
  };

  const connectRepository = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setConnectError(null);
    setConnecting(true);
    try {
      const result = await repositoryApi.connect(owner, repositoryName);
      setRepositories((current) => [result.repository, ...current.filter((repository) => repository.id !== result.repository.id)]);
      setOwner('');
      setRepositoryName('');
      closeConnect();
    } catch (requestError) {
      setConnectError(requestError instanceof ApiError ? requestError.message : 'Unable to connect that repository. Please try again.');
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-cyan-300">Workspace</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Connected repositories</h2>
        </div>
        <button
          type="button"
          onClick={() => { setConnectError(null); setConnectOpen(true); }}
          className="inline-flex items-center justify-center rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400"
        >
          <Plus className="mr-2 h-4 w-4" /> Connect repository
        </button>
      </div>

      {connectOpen ? <form onSubmit={connectRepository} className="rounded-2xl border border-cyan-500/20 bg-slate-900/80 p-5">
        <div className="mb-4 flex items-center justify-between">
          <div><h3 className="font-semibold text-white">Connect a public repository</h3><p className="mt-1 text-sm text-slate-400">Enter its GitHub owner and repository name.</p></div>
          <button type="button" aria-label="Close connect form" onClick={closeConnect} className="rounded-md p-2 text-slate-400 hover:bg-slate-800 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <label className="text-sm text-slate-300">Owner<input required maxLength={39} value={owner} onChange={(event) => setOwner(event.target.value)} placeholder="facebook" className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white placeholder:text-slate-500" /></label>
          <label className="text-sm text-slate-300">Repository<input required maxLength={100} value={repositoryName} onChange={(event) => setRepositoryName(event.target.value)} placeholder="react" className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white placeholder:text-slate-500" /></label>
          <button disabled={connecting} type="submit" className="inline-flex items-center justify-center gap-2 self-end rounded-lg bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-slate-950 disabled:opacity-60">{connecting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}{connecting ? 'Connecting...' : 'Connect'}</button>
        </div>
        {connectError ? <p role="alert" className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{connectError}</p> : null}
      </form> : null}

      {loading ? <LoadingState label="Loading connected repositories..." /> : error ? <div><ErrorState title="Repositories unavailable" message={error} /><button type="button" onClick={retryRepositories} className="mx-auto mt-4 block rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:border-cyan-400/50">Retry</button></div> : repositories.length === 0 ? <EmptyState title="No repositories connected" description="Connect a public GitHub repository to browse its files." actionLabel="Connect repository" onAction={() => setConnectOpen(true)} /> : <div className="grid gap-4 xl:grid-cols-2">
        {repositories.map((repo) => (
          <div key={repo.id} className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-cyan-300">{repo.githubOwner}</p>
                <h3 className="mt-2 text-xl font-semibold text-white">{repo.githubRepo}</h3>
              </div>
              <span className="rounded-full border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-300">{repo.defaultBranch}</span>
              <span className="rounded-full border border-cyan-500/20 bg-cyan-500/5 px-2.5 py-1 text-xs capitalize text-cyan-200" aria-label={`Index status: ${repo.indexingStatus}`}>{repo.indexingStatus}</span>
            </div>

            <p className="mt-4 min-h-10 text-sm text-slate-300">{repo.description || 'No description provided.'}</p>

            <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-slate-400">
              <a href={repo.htmlUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 hover:text-cyan-200">GitHub <ArrowUpRight className="h-3.5 w-3.5" /></a>
              <span className="inline-flex items-center gap-1.5"><GitBranch className="h-3.5 w-3.5 text-cyan-300" /> {repo.defaultBranch}</span>
              <span>Connected {new Date(repo.createdAt).toLocaleDateString()}</span>
            </div>

            <div className="mt-5 flex items-center justify-between">
              <span className="truncate text-sm text-slate-400">{repo.githubFullName}</span>
              <Link
                to={`/repositories/${repo.id}`}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-medium text-slate-200 hover:border-cyan-400/40 hover:text-white"
              >
                Open repo
                <ArrowUpRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        ))}
      </div>}
    </div>
  );
}
