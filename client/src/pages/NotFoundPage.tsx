import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="flex min-h-[360px] flex-col items-center justify-center rounded-3xl border border-slate-800 bg-slate-900/80 p-8 text-center">
      <p className="text-xs uppercase tracking-[0.32em] text-cyan-300">404</p>
      <h2 className="mt-3 text-3xl font-semibold text-white">Page not found</h2>
      <p className="mt-2 max-w-md text-sm text-slate-300">
        The route you requested does not exist in this workspace.
      </p>
      <Link
        to="/dashboard"
        className="mt-6 inline-flex items-center rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400"
      >
        Return to dashboard
      </Link>
    </div>
  );
}
