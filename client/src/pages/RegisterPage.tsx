import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LockKeyhole, Mail } from 'lucide-react';

import { useAuth } from '../context/useAuth';
import { AuthPageFrame } from './LoginPage';

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!email.trim() || !/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError('Enter a valid email address.');
      return;
    }
    if (password.length < 8 || new TextEncoder().encode(password).length > 72) {
      setError('Password must be at least 8 characters and no more than 72 bytes.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      await register(email.trim(), password);
      navigate('/dashboard', { replace: true });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to create your account. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthPageFrame title="Create your account" subtitle="Use your email to set up a DevPilot workspace.">
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
              autoComplete="new-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2.5 pl-10 pr-3 text-sm text-white placeholder:text-slate-500"
              placeholder="At least 8 characters"
            />
          </span>
        </label>
        <label className="block text-sm font-medium text-slate-200">
          Confirm password
          <input
            type="password"
            autoComplete="new-password"
            required
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white placeholder:text-slate-500"
            placeholder="Repeat your password"
          />
        </label>
        {error ? <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p> : null}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:cursor-wait disabled:opacity-60"
        >
          {submitting ? 'Creating account...' : 'Create account'}
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-400">
        Already registered? <Link to="/login" className="font-medium text-cyan-300 hover:text-cyan-200">Sign in</Link>
      </p>
    </AuthPageFrame>
  );
}