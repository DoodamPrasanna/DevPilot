export function LoadingState({ label = 'Loading workspace...' }: { label?: string }) {
  return (
    <div className="flex min-h-[220px] items-center justify-center rounded-2xl border border-slate-800 bg-slate-900/60 p-8">
      <div className="flex items-center gap-3 text-slate-200">
        <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" aria-label="Loading" />
        <span className="text-sm font-medium">{label}</span>
      </div>
    </div>
  );
}
