import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  api, setTokens, clearTokens, setAuthErrorHandler,
  getStoredUser, setStoredUser,
} from '../lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(getStoredUser);
  const [loading, setLoading] = useState(true);

  // Verificar sesión al cargar
  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (token) {
      api('/auth/me')
        .then((data) => {
          setUser(data);
          setStoredUser(data);
        })
        .catch(() => {
          clearTokens();
          setUser(null);
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  // Handler cuando el token expira
  useEffect(() => {
    setAuthErrorHandler(() => {
      setUser(null);
    });
  }, []);

  const login = useCallback(async (email, password) => {
    const data = await api('/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    setTokens(data.accessToken, data.refreshToken);
    setUser(data.user);
    setStoredUser(data.user);
    return data.user;
  }, []);

  /**
   * Registro self-service de un lavadero nuevo (onboarding paso 1).
   * El backend devuelve tokens en la misma respuesta para evitar un
   * segundo round-trip de login. El payload tiene la forma del schema
   * onboardingRegister del backend.
   */
  const signup = useCallback(async (payload) => {
    const data = await api('/onboarding/register', {
      method: 'POST',
      body: payload,
    });
    setTokens(data.accessToken, data.refreshToken);
    // El response de register no incluye tenant anidado en user;
    // /auth/me devuelve el user con tenant para mantener el shape consistente.
    const fullUser = await api('/auth/me');
    setUser(fullUser);
    setStoredUser(fullUser);
    return { user: fullUser, tenant: data.tenant };
  }, []);

  const logout = useCallback(async () => {
    try {
      const rt = localStorage.getItem('refreshToken');
      await api('/auth/logout', {
        method: 'POST',
        body: { refreshToken: rt },
      });
    } catch {
      // Ignorar error en logout
    }
    clearTokens();
    setUser(null);
  }, []);

  const value = {
    user,
    loading,
    login,
    signup,
    logout,
    isAuthenticated: !!user,
    isAdmin: user?.role === 'admin' || user?.role === 'super_admin',
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth debe usarse dentro de AuthProvider');
  }
  return context;
}