import { createContext } from 'react';

import type { AuthUser } from '../lib/api';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'error';

export type AuthContextValue = {
  user: AuthUser | null;
  status: AuthStatus;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  retry: () => Promise<void>;
};

export const AuthContext = createContext<AuthContextValue | null>(null);