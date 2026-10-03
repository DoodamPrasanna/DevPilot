type EmptyStateProps = {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
};

export function EmptyState({ title, description, actionLabel, onAction }: EmptyStateProps) {
  return (
    <div className="flex min-h-[220px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-700 bg-slate-900/40 p-8 text-center">
      <div className="mb-3 rounded-full border border-slate-700 bg-slate-800 p-3 text-slate-200">
        <span aria-hidden="true">•</span>
      </div>
      <h3 className="text-lg font-semibold text-white">{title}</h3>
      <p className="mt-2 max-w-md text-sm text-slate-400">{description}</p>
      {actionLabel ? (
        <button
          type="button"
          onClick={onAction}
          disabled={!onAction}
          className="mt-5 rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400"
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
