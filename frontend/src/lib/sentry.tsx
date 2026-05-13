/**
 * Inicialización opcional de Sentry para el frontend.
 *
 * Si VITE_SENTRY_DSN no está definido, este módulo se desactiva
 * silenciosamente. Llamar `initSentry()` desde main.tsx antes del render.
 *
 * Para envolver la app con ErrorBoundary:
 *   import { ErrorBoundary } from './lib/sentry';
 *   <ErrorBoundary>
 *     <App />
 *   </ErrorBoundary>
 *
 * Requiere: npm install @sentry/react
 */

import type { ReactNode } from 'react';
import type { AuthUser } from '../types';

// ─── Tipos mínimos del subconjunto de @sentry/react que usamos ───────────────
// Definidos localmente para que este módulo compile aunque @sentry/react no
// esté instalado (el try/catch del initSentry maneja ese caso).

interface SentryInitOptions {
  dsn: string;
  environment?: string;
  release?: string;
  tracesSampleRate?: number;
  replaysSessionSampleRate?: number;
  replaysOnErrorSampleRate?: number;
  ignoreErrors?: string[];
  beforeSend?: (event: SentryEvent) => SentryEvent | null;
}

interface SentryEvent {
  tags?: { statusCode?: number; [key: string]: unknown };
  [key: string]: unknown;
}

interface SentryScope {
  setTag(key: string, value: unknown): void;
}

interface SentryUserPayload {
  id: string;
  email: string;
  role: string;
  tenant?: string;
}

interface SentryErrorBoundaryProps {
  fallback: (props: { error: Error; resetError: () => void }) => ReactNode;
  children: ReactNode;
}

interface SentryAPI {
  init(options: SentryInitOptions): void;
  ErrorBoundary: (props: SentryErrorBoundaryProps) => React.JSX.Element;
  withScope(callback: (scope: SentryScope) => void): void;
  captureException(err: unknown): void;
  setUser(user: SentryUserPayload | null): void;
}

// ─── Estado del módulo ───────────────────────────────────────────────────────

let Sentry: SentryAPI | null = null;
let enabled = false;

// ─── Init ────────────────────────────────────────────────────────────────────

export async function initSentry(): Promise<void> {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;

  try {
    // @ts-ignore — @sentry/react es opcional; si no está instalado el catch
    // de abajo lo maneja con un aviso al usuario.
    const mod = (await import('@sentry/react')) as unknown as SentryAPI;
    Sentry = mod;

    Sentry.init({
      dsn,
      environment: import.meta.env.MODE,
      release: import.meta.env.VITE_SENTRY_RELEASE || undefined,
      tracesSampleRate: parseFloat(import.meta.env.VITE_SENTRY_TRACES_RATE || '0.1'),
      replaysSessionSampleRate: 0,    // desactivado: sin replay en sesiones normales
      replaysOnErrorSampleRate: 0.5,  // 50% de errores capturan replay para debug
      ignoreErrors: [
        'TypeError: Failed to fetch',  // red caída del usuario, no es bug nuestro
        'AbortError',                  // requests cancelados al cambiar de página
        'NetworkError',
      ],
      beforeSend(event: SentryEvent) {
        // Ignorar errores 4xx que vengan del backend (validación, auth)
        const statusCode = event.tags?.statusCode;
        if (typeof statusCode === 'number' && statusCode < 500) return null;
        return event;
      },
    });
    enabled = true;
  } catch {
    console.warn('⚠️  VITE_SENTRY_DSN configurado pero @sentry/react no instalado.');
    console.warn('   Ejecuta: npm install @sentry/react');
  }
}

// ─── ErrorBoundary wrapper ───────────────────────────────────────────────────

/**
 * ErrorBoundary que muestra fallback amigable y reporta a Sentry.
 * Si Sentry no está activo, devuelve un wrapper transparente.
 */
export function ErrorBoundary({ children }: { children: ReactNode }) {
  if (!enabled || !Sentry) return <>{children}</>;
  const SentryEB = Sentry.ErrorBoundary;
  return (
    <SentryEB
      fallback={({ error, resetError }) => (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
          <div className="max-w-md text-center">
            <span className="text-5xl mb-4 inline-block">😔</span>
            <h1 className="text-xl font-bold text-gray-900 mb-2">Algo salió mal</h1>
            <p className="text-sm text-gray-600 mb-6">
              Recibimos el error y lo estamos revisando. Puedes intentar recargar la app.
            </p>
            <p className="text-xs font-mono text-gray-400 mb-6 break-all">{error.message}</p>
            <button
              onClick={resetError}
              className="px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-semibold rounded-xl transition text-sm"
            >
              Reintentar
            </button>
          </div>
        </div>
      )}
    >
      {children}
    </SentryEB>
  );
}

// ─── Captura manual ──────────────────────────────────────────────────────────

/** Captura manual desde cualquier componente */
export function captureException(err: unknown, context: Record<string, unknown> = {}): void {
  if (!enabled || !Sentry) return;
  const SentryRef = Sentry; // narrowing para el callback
  SentryRef.withScope((scope) => {
    Object.entries(context).forEach(([key, value]) => {
      scope.setTag(key, value);
    });
    SentryRef.captureException(err);
  });
}

// ─── User tracking ───────────────────────────────────────────────────────────

/** Setea el usuario actual para asociar errores */
export function setUser(user: AuthUser | null): void {
  if (!enabled || !Sentry) return;
  if (!user) {
    Sentry.setUser(null);
    return;
  }
  Sentry.setUser({
    id: user.id,
    email: user.email,
    role: user.role,
    tenant: user.tenant?.slug,
  });
}