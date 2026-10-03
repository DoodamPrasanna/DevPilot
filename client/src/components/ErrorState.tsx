import { AlertTriangle } from 'lucide-react';

type ErrorStateProps = {
  title?: string;
  message?: string;
};

export function ErrorState({
  title = 'Something went wrong',
  message = 'The workspace is temporarily unavailable. Try again in a moment.',
}: ErrorStateProps) {
  return (
    <div className="flex min-h-[220px] items-center justify-center rounded-2xl border border-red-500/40 bg-red-500/5 p-8">
      <div className="flex max-w-lg items-start gap-4 text-left">
        <div className="mt-0.5 rounded-full bg-red-500/10 p-2 text-red-300">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-base font-semibold text-white">{title}</h3>
          <p className="mt-1 text-sm text-slate-300">{message}</p>
        </div>
      </div>
    </div>
  );
}
