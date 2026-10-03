import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, Bot, Code2, LoaderCircle, MessageSquareText } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';

import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { RepositoryTree } from '../components/RepositoryTree';
import { ApiError, repositoryApi, type Repository, type RepositoryFile, type RepositoryTreeEntry } from '../lib/api';

export function RepositoryDetailPage() {
  const { repoId } = useParams();
  const [repositoryLoad, setRepositoryLoad] = useState<{
    id: string;
    repository: Repository | null;
    error: string | null;
  } | null>(null);
  const [treeLoad, setTreeLoad] = useState<{
    key: string;
    entries: RepositoryTreeEntry[];
    error: string | null;
  } | null>(null);
  const [file, setFile] = useState<RepositoryFile | null>(null);
  const [navigation, setNavigation] = useState({ repositoryId: '', path: '' });
  const [selectedPath, setSelectedPath] = useState('');
  const [loadingFile, setLoadingFile] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [treeRefreshKey, setTreeRefreshKey] = useState(0);
  const [indexing, setIndexing] = useState(false);
  const [indexError, setIndexError] = useState<{ repositoryId: string; message: string } | null>(null);
  const [indexNotice, setIndexNotice] = useState<{ repositoryId: string; message: string } | null>(null);
  const fileRequestNumber = useRef(0);
  const currentRepositoryLoad = repositoryLoad?.id === repoId ? repositoryLoad : null;
  const repo = currentRepositoryLoad?.repository ?? null;
  const error = currentRepositoryLoad?.error ?? null;
  const loadingRepo = Boolean(repoId) && !currentRepositoryLoad;
  const path = navigation.repositoryId === repoId ? navigation.path : '';
  const changePath = (nextPath: string) => setNavigation({ repositoryId: repoId ?? '', path: nextPath });
  const treeKey = `${repoId ?? ''}:${path}:${treeRefreshKey}`;
  const currentTreeLoad = treeLoad?.key === treeKey ? treeLoad : null;
  const entries = currentTreeLoad?.entries ?? [];
  const treeError = currentTreeLoad?.error ?? null;
  const loadingTree = Boolean(repo && repoId && !currentTreeLoad);

  useEffect(() => {
    if (!repoId) return;
    let active = true;
    repositoryApi.get(repoId)
      .then((result) => { if (active) setRepositoryLoad({ id: repoId, repository: result.repository, error: null }); })
      .catch((requestError: unknown) => {
        if (active) {
          setRepositoryLoad({
            id: repoId,
            repository: null,
            error: requestError instanceof ApiError ? requestError.message : 'Unable to load this repository.',
          });
        }
      })
    return () => { active = false; };
  }, [repoId]);

  useEffect(() => {
    if (!repoId || !repo) return;
    let active = true;
    repositoryApi.tree(repoId, path)
      .then((result) => { if (active) setTreeLoad({ key: treeKey, entries: result.entries, error: null }); })
      .catch((requestError: unknown) => {
        if (active) {
          setTreeLoad({
            key: treeKey,
            entries: [],
            error: requestError instanceof ApiError ? requestError.message : 'Unable to load this directory.',
          });
        }
      })
    return () => { active = false; };
  }, [repoId, repo, path, treeKey]);

  const openDirectory = (directoryPath: string) => {
    fileRequestNumber.current += 1;
    setLoadingFile(false);
    changePath(directoryPath);
    setSelectedPath('');
    setFile(null);
    setFileError(null);
  };

  const selectFile = async (filePath: string) => {
    if (!repoId) return;
    const requestNumber = ++fileRequestNumber.current;
    setSelectedPath(filePath);
    setFile(null);
    setFileError(null);
    setLoadingFile(true);
    try {
      const result = await repositoryApi.file(repoId, filePath);
      if (requestNumber === fileRequestNumber.current) setFile(result.file);
    } catch (requestError) {
      if (requestNumber === fileRequestNumber.current) {
        setFileError(requestError instanceof ApiError ? requestError.message : 'Unable to preview this file.');
      }
    } finally {
      if (requestNumber === fileRequestNumber.current) setLoadingFile(false);
    }
  };

  const navigateUp = () => {
    fileRequestNumber.current += 1;
    setLoadingFile(false);
    const segments = path.split('/').filter(Boolean);
    segments.pop();
    changePath(segments.join('/'));
    setSelectedPath('');
    setFile(null);
    setFileError(null);
  };

  const startIndexing = async () => {
    if (!repoId || indexing) return;
    setIndexing(true);
    setIndexError(null);
    setIndexNotice(null);
    setRepositoryLoad((current) => current?.repository ? {
      ...current,
      repository: { ...current.repository, indexingStatus: 'indexing' },
    } : current);
    try {
      const indexResponse = await repositoryApi.index(repoId);
      setIndexNotice({
        repositoryId: repoId,
        message: indexResponse.indexing.embeddingsCreated
          ? `Indexed ${indexResponse.indexing.filesIndexed} files into ${indexResponse.indexing.chunksIndexed} chunks.`
          : `Indexed ${indexResponse.indexing.filesIndexed} files into ${indexResponse.indexing.chunksIndexed} chunks; embeddings are not configured, so repository chat will use bounded GitHub retrieval.`,
      });
      const repositoryResponse = await repositoryApi.get(repoId);
      setRepositoryLoad({ id: repoId, repository: repositoryResponse.repository, error: null });
    } catch (requestError) {
      setIndexError({
        repositoryId: repoId,
        message: requestError instanceof ApiError ? requestError.message : 'Unable to index this repository.',
      });
      const result = await repositoryApi.get(repoId).catch(() => null);
      if (result) setRepositoryLoad({ id: repoId, repository: result.repository, error: null });
      else setRepositoryLoad((current) => current?.repository ? {
        ...current,
        repository: { ...current.repository, indexingStatus: 'failed' },
      } : current);
    } finally {
      setIndexing(false);
    }
  };

  if (loadingRepo) return <LoadingState label="Loading repository..." />;
  if (error || !repo) return <ErrorState title="Repository unavailable" message={error ?? 'This repository could not be found.'} />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <Link to="/repositories" className="inline-flex items-center gap-2 text-sm text-slate-300 hover:text-white">
          <ArrowLeft className="h-4 w-4" />
          Back to repositories
        </Link>
        <a href={repo.htmlUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-cyan-200">Open on GitHub <ArrowUpRight className="h-4 w-4" /></a>
      </div>

      <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-cyan-300">Repository</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">{repo.githubFullName}</h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-300">{repo.description || 'No description provided.'}</p>
          </div>
          <div className="flex gap-2">
            <Link to={`/chat?repositoryId=${encodeURIComponent(repo.id)}`} className="inline-flex items-center gap-2 rounded-lg bg-cyan-500 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400"><MessageSquareText className="h-4 w-4" /> Ask AI</Link>
            <button type="button" onClick={() => void startIndexing()} disabled={indexing || repo.indexingStatus === 'indexing'} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm font-semibold text-slate-100 hover:border-cyan-400 disabled:cursor-not-allowed disabled:opacity-60">
              {indexing || repo.indexingStatus === 'indexing' ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              {indexing || repo.indexingStatus === 'indexing' ? 'Indexing...' : repo.indexingStatus === 'ready' ? 'Re-index' : 'Index repository'}
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[320px_1.5fr_0.7fr]">
        <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-4">
          {loadingTree ? <LoadingState label="Loading directory..." /> : treeError ? <div><ErrorState title="Directory unavailable" message={treeError} /><button type="button" onClick={() => setTreeRefreshKey((current) => current + 1)} className="mt-3 rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200">Retry</button></div> : (
            <RepositoryTree
              entries={entries}
              path={path}
              selectedPath={selectedPath}
              onOpenDirectory={openDirectory}
              onSelectFile={(filePath) => void selectFile(filePath)}
              onNavigateUp={navigateUp}
            />
          )}
        </div>

        <div className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-950/70">
          <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/80 px-4 py-3">
            <div className="flex items-center gap-2 text-sm text-slate-200">
              <Code2 className="h-4 w-4 text-cyan-300" />
              {file?.name ?? 'No file selected'}
            </div>
            <span className="text-xs uppercase tracking-[0.18em] text-slate-400">{file ? file.name.split('.').pop() ?? 'text' : 'text'}</span>
          </div>

          {loadingFile ? <LoadingState label="Loading file contents..." /> : fileError ? <ErrorState title="File preview unavailable" message={fileError} /> : file ? (
            <pre className="max-h-[540px] overflow-auto p-4 text-sm leading-7 text-slate-200"><code>{file.content}</code></pre>
          ) : <EmptyState title="Select a file" description="Choose a file in the explorer to load its text contents." />}
        </div>

        <div className="space-y-4">
          <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-4">
            <p className="text-xs uppercase tracking-[0.28em] text-amber-300">Repository</p>
            <div className="mt-4 space-y-3 text-sm text-slate-300">
              <p className="rounded-xl border border-slate-800 bg-slate-950/40 p-3"><span className="block text-xs uppercase text-slate-500">Default branch</span><span className="mt-1 block">{repo.defaultBranch}</span></p>
              <p className="rounded-xl border border-slate-800 bg-slate-950/40 p-3"><span className="block text-xs uppercase text-slate-500">Connected</span><span className="mt-1 block">{new Date(repo.createdAt).toLocaleDateString()}</span></p>
              <p className="rounded-xl border border-slate-800 bg-slate-950/40 p-3"><span className="block text-xs uppercase text-slate-500">Indexing</span><span className="mt-1 block capitalize">{repo.indexingStatus}</span>{repo.indexedAt ? <span className="mt-1 block text-xs text-slate-500">Last indexed {new Date(repo.indexedAt).toLocaleString()}</span> : null}</p>
              <p className="flex items-start gap-2 rounded-xl border border-slate-800 bg-slate-950/40 p-3"><Bot className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" /><span>Repository chat retrieves bounded, relevant source context. Repository files are treated as untrusted data.</span></p>
              {indexError && indexError.repositoryId === repoId ? <p className="text-sm text-rose-300" role="alert">{indexError.message}</p> : null}
              {indexNotice && indexNotice.repositoryId === repoId ? <p className="text-sm text-emerald-200" role="status" aria-live="polite">{indexNotice.message}</p> : null}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-4">
            <p className="text-xs uppercase tracking-[0.28em] text-slate-400">GitHub</p>
            <a href={repo.htmlUrl} target="_blank" rel="noreferrer" className="mt-4 block break-all text-sm text-cyan-200 hover:text-cyan-100">{repo.htmlUrl}</a>
          </div>
        </div>
      </div>
    </div>
  );
}
