import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LockKeyhole, Mail, Sparkles } from 'lucide-react';

import { useAuth } from '../context/useAuth';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!email.trim() || !/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError('Enter a valid email address.');
      return;
    }
    if (!password) {
      setError('Enter your password.');
      return;
    }

    setSubmitting(true);
    try {
      await login(email.trim(), password);
      navigate('/dashboard', { replace: true });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to sign in. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthPageFrame title="Welcome back" subtitle="Sign in to your DevPilot workspace.">
      <form className="space-y-4" onSubmit={submit} noValidate>
        <label className="block text-sm font-medium text-slate-200">
          Email
          <span className="relative mt-1.5 block">
            <Mail className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-500" />
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2.5 pl-10 pr-3 text-sm text-white placeholder:text-slate-500"
              placeholder="you@example.com"
            />
          </span>
        </label>
        <label className="block text-sm font-medium text-slate-200">
          Password
          <span className="relative mt-1.5 block">
            <LockKeyhole className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-500" />
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2.5 pl-10 pr-3 text-sm text-white placeholder:text-slate-500"
              placeholder="Your password"
            />
          </span>
        </label>
        {error ? <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p> : null}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:cursor-wait disabled:opacity-60"
        >
          {submitting ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-400">
        New to DevPilot? <Link to="/register" className="font-medium text-cyan-300 hover:text-cyan-200">Create an account</Link>
      </p>
    </AuthPageFrame>
  );
}

export function AuthPageFrame({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-10 text-slate-100">
      <div className="w-full max-w-md">
        <Link to="/login" className="mb-8 flex items-center justify-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-500/15 text-cyan-300"><Sparkles className="h-5 w-5" /></span>
          <span className="text-sm font-semibold uppercase tracking-[0.22em] text-cyan-300">DevPilot</span>
        </Link>
        <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 shadow-xl shadow-black/20 sm:p-8">
          <h1 className="text-2xl font-semibold text-white">{title}</h1>
          <p className="mt-2 mb-6 text-sm text-slate-400">{subtitle}</p>
          {children}
        </section>
      </div>
    </main>
  );
}