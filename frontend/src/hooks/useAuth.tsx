import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import {
  api, setTokens, clearTokens, setAuthErrorHandler,
  getStoredUser, setStoredUser,
} from '../lib/api';
import type { AuthUser } from '../types';

// ─── Context ──────────────────────────────────────────────────────────────────

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login(email: string, password: string): Promise<AuthUser>;
  signup(payload: Record<string, unknown>): Promise<{ user: AuthUser; tenant: unknown }>;
  logout(): Promise<void>;
  isAuthenticated: boolean;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => getStoredUser<AuthUser>());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (token) {
      api<AuthUser>('/auth/me')
        .then((data) => { setUser(data); setStoredUser(data); })
        .catch(() => { clearTokens(); setUser(null); })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setAuthErrorHandler(() => setUser(null));
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<AuthUser> => {
    const data = await api<{ accessToken: string; refreshToken: string; user: AuthUser }>(
      '/auth/login', { method: 'POST', body: { email, password } },
    );
    setTokens(data.accessToken, data.refreshToken);
    setUser(data.user);
    setStoredUser(data.user);
    return data.user;
  }, []);

  const signup = useCallback(async (payload: Record<string, unknown>) => {
    const data = await api<{ accessToken: string; refreshToken: string; user: AuthUser; tenant: unknown }>(
      '/onboarding/register', { method: 'POST', body: payload },
    );
    setTokens(data.accessToken, data.refreshToken);
    const fullUser = await api<AuthUser>('/auth/me');
    setUser(fullUser);
    setStoredUser(fullUser);
    return { user: fullUser, tenant: data.tenant };
  }, []);

  const logout = useCallback(async () => {
    try {
      const rt = localStorage.getItem('refreshToken');
      await api('/auth/logout', { method: 'POST', body: { refreshToken: rt } });
    } catch { /* Ignorar error en logout */ }
    clearTokens();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{
      user, loading, login, signup, logout,
      isAuthenticated: !!user,
      isAdmin: user?.role === 'admin' || user?.role === 'super_admin',
    }}>
      {children}
    </AuthContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return context;
}