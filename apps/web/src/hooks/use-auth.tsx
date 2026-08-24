'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ApiError, apiClient, refreshSession, type AuthResult } from '@/lib/api-client';
import { setAccessToken } from '@/lib/auth-token';

type AuthUser = AuthResult['user'];

export interface RegisterInput {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  /** True until the initial silent refresh (cookie -> session) has resolved. */
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function applySession(session: AuthResult, setUser: (user: AuthUser) => void): void {
  setAccessToken(session.accessToken);
  setUser(session.user);
}

export function AuthProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Shares api-client's own in-flight refresh singleton: any concurrent 401-triggered
    // retry (or React StrictMode's double effect invocation in dev) must not fire a second
    // /auth/refresh, since the refresh token is single-use and a second presentation of the
    // same cookie is treated as reuse and revokes the whole session.
    refreshSession()
      .then((session) => {
        applySession(session, setUser);
      })
      .catch((error: unknown) => {
        // No valid refresh cookie yet - an unauthenticated visitor, not a failure.
        if (!(error instanceof ApiError) || error.status !== 401) {
          throw error;
        }
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const session = await apiClient.post<AuthResult>('/auth/login', { email, password }, { skipAuthRetry: true });
    applySession(session, setUser);
  }, []);

  const register = useCallback(async (input: RegisterInput) => {
    const session = await apiClient.post<AuthResult>('/auth/register', input, { skipAuthRetry: true });
    applySession(session, setUser);
  }, []);

  const logout = useCallback(async () => {
    await apiClient.post('/auth/logout', undefined, { skipAuthRetry: true });
    setAccessToken(null);
    setUser(null);
  }, []);

  // AuthProvider wraps the whole app, so a fresh value object here re-renders every consumer
  // on every render, not just on real auth transitions.
  const value = useMemo(() => ({ user, isLoading, login, register, logout }), [user, isLoading, login, register, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === null) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
