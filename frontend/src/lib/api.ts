/// <reference types="vite/client" />

import type { ApiOptions } from '../types';

const API_URL = import.meta.env.VITE_API_URL || '/api';

let accessToken: string | null = localStorage.getItem('accessToken');
let refreshToken: string | null = localStorage.getItem('refreshToken');
let onAuthError: (() => void) | null = null;

export function setAuthErrorHandler(handler: () => void): void {
  onAuthError = handler;
}

export function setTokens(access: string, refresh: string): void {
  accessToken = access;
  refreshToken = refresh;
  localStorage.setItem('accessToken', access);
  localStorage.setItem('refreshToken', refresh);
}

export function clearTokens(): void {
  accessToken = null;
  refreshToken = null;
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('user');
}

export function getStoredUser<T = unknown>(): T | null {
  try {
    const raw = localStorage.getItem('user');
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function setStoredUser(user: unknown): void {
  localStorage.setItem('user', JSON.stringify(user));
}

async function tryRefresh(): Promise<boolean> {
  if (!refreshToken) return false;
  try {
    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { accessToken: string; refreshToken: string };
    setTokens(data.accessToken, data.refreshToken);
    return true;
  } catch {
    return false;
  }
}

export class ApiError extends Error {
  public readonly status: number;
  public readonly data: unknown;

  constructor(message: string, status: number, data: unknown = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

/**
 * Fetch wrapper con auto-refresh de token.
 *
 * Genérico: T define el tipo del response parseado.
 *   const user = await api<AuthUser>('/auth/me');
 *   const data = await api<Paginated<Appointment>>('/appointments');
 */
export async function api<T = unknown>(path: string, options: ApiOptions = {}): Promise<T> {
  const { body, headers: customHeaders, method = 'GET' } = options;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...customHeaders,
  };

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  const config: RequestInit = { method, headers };
  if (body !== undefined) {
    config.body = JSON.stringify(body);
  }

  let res = await fetch(`${API_URL}${path}`, config);

  if (res.status === 401 && refreshToken) {
    const refreshed = await tryRefresh();
    if (refreshed && accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
      res = await fetch(`${API_URL}${path}`, { ...config, headers });
    }
  }

  if (res.status === 401) {
    clearTokens();
    onAuthError?.();
    throw new ApiError('Sesión expirada', 401);
  }

  const data = (await res.json()) as T;

  if (!res.ok) {
    const errData = data as { error?: string };
    throw new ApiError(errData.error ?? 'Error del servidor', res.status, data);
  }

  return data;
}