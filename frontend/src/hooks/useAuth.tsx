import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import {
  api, setAccessToken, clearTokens, setAuthErrorHandler,
  getStoredUser, setStoredUser, restaurarSesion, cerrarSesionEnServidor,
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
    // El access token no se persiste —vive en memoria, ver lib/api.ts— así que
    // tras recargar la página no hay ninguno. Se pide uno con la cookie
    // httpOnly, que es lo único que sobrevive al recargo. Si no hay cookie, o
    // venció, el usuario ve el login.
    //
    // Antes esto miraba `localStorage.getItem('accessToken')`, que es
    // exactamente lo que ya no existe.
    let vigente = true;

    restaurarSesion()
      .then(async (ok) => {
        if (!vigente) return;
        if (!ok) {
          clearTokens();
          setUser(null);
          return;
        }
        const data = await api<AuthUser>('/auth/me');
        if (!vigente) return;
        setUser(data);
        setStoredUser(data);
      })
      .catch(() => {
        if (!vigente) return;
        clearTokens();
        setUser(null);
      })
      .finally(() => {
        if (vigente) setLoading(false);
      });

    return () => { vigente = false; };
  }, []);

  useEffect(() => {
    setAuthErrorHandler(() => setUser(null));
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<AuthUser> => {
    // La respuesta ya no trae el refresh token: viene en una cookie httpOnly que
    // este código no puede leer, y es la mitad del arreglo.
    const data = await api<{ accessToken: string; user: AuthUser }>(
      '/auth/login', { method: 'POST', body: { email, password } },
    );
    setAccessToken(data.accessToken);
    setUser(data.user);
    setStoredUser(data.user);
    return data.user;
  }, []);

  const signup = useCallback(async (payload: Record<string, unknown>) => {
    const data = await api<{ accessToken: string; user: AuthUser; tenant: unknown }>(
      '/onboarding/register', { method: 'POST', body: payload },
    );
    setAccessToken(data.accessToken);
    const fullUser = await api<AuthUser>('/auth/me');
    setUser(fullUser);
    setStoredUser(fullUser);
    return { user: fullUser, tenant: data.tenant };
  }, []);

  const logout = useCallback(async () => {
    // El servidor es el único que puede borrar la cookie: es httpOnly. Por eso
    // cerrar sesión deja de ser una limpieza local y pasa a ser una petición.
    await cerrarSesionEnServidor();
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