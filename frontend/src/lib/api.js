/**
 * Cliente HTTP para la API.
 * Maneja tokens, refresh automático, y errores.
 */

const API_URL = import.meta.env.VITE_API_URL || '/api';

let accessToken = localStorage.getItem('accessToken');
let refreshToken = localStorage.getItem('refreshToken');

// Callback para cuando el token expira y no se puede refrescar
let onAuthError = null;

export function setAuthErrorHandler(handler) {
  onAuthError = handler;
}

export function setTokens(access, refresh) {
  accessToken = access;
  refreshToken = refresh;
  localStorage.setItem('accessToken', access);
  localStorage.setItem('refreshToken', refresh);
}

export function clearTokens() {
  accessToken = null;
  refreshToken = null;
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('user');
}

export function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem('user'));
  } catch {
    return null;
  }
}

export function setStoredUser(user) {
  localStorage.setItem('user', JSON.stringify(user));
}

/**
 * Intenta refrescar el access token.
 * Retorna true si tuvo éxito, false si no.
 */
async function tryRefresh() {
  if (!refreshToken) return false;

  try {
    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    if (!res.ok) return false;

    const data = await res.json();
    setTokens(data.accessToken, data.refreshToken);
    return true;
  } catch {
    return false;
  }
}

/**
 * Fetch wrapper con auth automático.
 *
 * Uso:
 *   const data = await api('/tenants/me');
 *   const data = await api('/auth/login', { method: 'POST', body: { email, password } });
 */
export async function api(path, options = {}) {
  const { body, headers: customHeaders, ...rest } = options;

  const headers = {
    'Content-Type': 'application/json',
    ...customHeaders,
  };

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  const config = {
    ...rest,
    headers,
  };

  if (body) {
    config.body = JSON.stringify(body);
  }

  let res = await fetch(`${API_URL}${path}`, config);

  // Si recibimos 401, intentar refresh
  if (res.status === 401 && refreshToken) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      headers['Authorization'] = `Bearer ${accessToken}`;
      res = await fetch(`${API_URL}${path}`, { ...config, headers });
    }
  }

  // Si sigue siendo 401 después del refresh, cerrar sesión
  if (res.status === 401) {
    clearTokens();
    onAuthError?.();
    throw new ApiError('Sesión expirada', 401);
  }

  const data = await res.json();

  if (!res.ok) {
    throw new ApiError(data.error || 'Error del servidor', res.status, data);
  }

  return data;
}

export class ApiError extends Error {
  constructor(message, status, data = null) {
    super(message);
    this.status = status;
    this.data = data;
  }
}
