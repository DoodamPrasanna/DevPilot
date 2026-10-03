import { ArrowLeft, FileCode2, Folder, FolderTree } from 'lucide-react';

import type { RepositoryTreeEntry } from '../lib/api';

type RepositoryTreeProps = {
  entries: RepositoryTreeEntry[];
  path: string;
  selectedPath?: string;
  onOpenDirectory: (path: string) => void;
  onSelectFile: (path: string) => void;
  onNavigateUp: () => void;
};

export function RepositoryTree({ entries, path, selectedPath, onOpenDirectory, onSelectFile, onNavigateUp }: RepositoryTreeProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 px-2 text-xs uppercase tracking-[0.28em] text-slate-400">
        <FolderTree className="h-3.5 w-3.5" />
        File explorer
      </div>
      <div className="flex items-center gap-2 px-2">
        <button type="button" disabled={!path} onClick={onNavigateUp} aria-label="Go to parent directory" title="Parent directory" className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-40">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <p className="min-w-0 truncate text-xs text-slate-400" title={path || '/'}>{path || '/'}</p>
      </div>
      <div className="space-y-2">
        {entries.map((entry) => {
          const isSelected = selectedPath === entry.path;
          const isDirectory = entry.type === 'directory';
          const isFile = entry.type === 'file';
          return (
            <button
              key={entry.path}
              type="button"
              disabled={!isDirectory && !isFile}
              onClick={() => isDirectory ? onOpenDirectory(entry.path) : isFile ? onSelectFile(entry.path) : undefined}
              className={[
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-45',
                isSelected ? 'bg-cyan-500/10 text-cyan-200' : 'text-slate-300 hover:bg-slate-800 hover:text-slate-50',
              ].join(' ')}
              title={isDirectory ? 'Open directory' : isFile ? 'Open file' : `Unsupported GitHub entry: ${entry.type}`}
            >
              {isDirectory ? <Folder className="h-4 w-4 text-cyan-300" /> : <FileCode2 className="h-4 w-4 text-slate-400" />}
              <span className="min-w-0 flex-1 truncate">{entry.name}</span>
              {isFile && entry.size !== undefined ? <span className="text-[10px] text-slate-500">{formatSize(entry.size)}</span> : null}
            </button>
          );
        })}
        {entries.length === 0 ? <p className="px-2 py-3 text-sm text-slate-500">This directory is empty.</p> : null}
      </div>
    </div>
  );
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
