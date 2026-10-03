import { useEffect, useState, type ReactNode } from 'react';

import { ApiError, authApi, type AuthUser } from '../lib/api';
import { AuthContext, type AuthStatus } from './auth-context';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const result = await authApi.me();
      setUser(result.user);
      setStatus('authenticated');
    } catch (requestError) {
      setUser(null);
      if (requestError instanceof ApiError && requestError.status === 401) {
        setStatus('unauthenticated');
        return;
      }

      setError(requestError instanceof Error ? requestError.message : 'Unable to check your session.');
      setStatus('error');
    }
  };

  const retry = async () => {
    setStatus('loading');
    setError(null);
    await refresh();
  };

  useEffect(() => {
    const handleUnauthorized = () => {
      setUser(null);
      setStatus('unauthenticated');
      setError(null);
    };

    window.addEventListener('devpilot:unauthorized', handleUnauthorized);
    void authApi.me()
      .then((result) => {
        setUser(result.user);
        setStatus('authenticated');
      })
      .catch((requestError: unknown) => {
        setUser(null);
        if (requestError instanceof ApiError && requestError.status === 401) {
          setStatus('unauthenticated');
          return;
        }

        setError(requestError instanceof Error ? requestError.message : 'Unable to check your session.');
        setStatus('error');
      });

    return () => window.removeEventListener('devpilot:unauthorized', handleUnauthorized);
  }, []);

  const login = async (email: string, password: string) => {
    const result = await authApi.login(email, password);
    setUser(result.user);
    setStatus('authenticated');
    setError(null);
  };

  const register = async (email: string, password: string) => {
    await authApi.register(email, password);
    await login(email, password);
  };

  const logout = async () => {
    try {
      await authApi.logout();
    } finally {
      setUser(null);
      setStatus('unauthenticated');
      setError(null);
    }
  };

  return <AuthContext.Provider value={{ user, status, error, login, register, logout, refresh, retry }}>{children}</AuthContext.Provider>;
}