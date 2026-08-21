/**
 * Inicialización opcional de Sentry para el backend.
 * Si SENTRY_DSN no está definido, todos los métodos son no-op.
 *
 * Requiere: npm install @sentry/node
 *
 * Uso en src/index.ts:
 *   import sentry from './shared/utils/sentry';
 *   sentry.init();
 *   // ... rutas ...
 *   app.use(sentry.errorHandler());
 *
 * Captura manual:
 *   sentry.captureException(err, { tenantId, paymentId });
 */

import type { RequestHandler } from 'express';

// Carga dinámica para no fallar si @sentry/node no está instalado
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Sentry: any = null;
let enabled = false;

export function init(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    Sentry = require('@sentry/node');

    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV ?? 'development',
      release:     process.env.SENTRY_RELEASE,
      tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),
      ignoreErrors: ['AppError', 'TokenExpiredError'],
      beforeSend(event: Record<string, unknown>) {
        // No reportar 4xx (errores del cliente / validación)
        const status = (event.contexts as { response?: { status_code?: number } })
          ?.response?.status_code;
        if (status && status < 500) return null;
        return event;
      },
    });

    enabled = true;
    console.log(`🛡️  Sentry activo [${process.env.NODE_ENV}]`);
  } catch {
    console.warn('⚠️  SENTRY_DSN configurado pero @sentry/node no instalado.');
    console.warn('   Ejecuta: npm install @sentry/node');
  }
}

/**
 * Middleware Express que captura 5xx automáticamente.
 * Si Sentry no está activo, devuelve un middleware no-op.
 */
export function errorHandler(): RequestHandler {
  if (!enabled || !Sentry) {
    // No-op con 4 parámetros (firma de error handler de Express)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ((_err: unknown, _req: unknown, _res: unknown, next: any) => next(_err)) as unknown as RequestHandler;
  }

  return Sentry.Handlers.errorHandler({
    shouldHandleError(error: { statusCode?: number; status?: number }) {
      const status = error.statusCode ?? error.status ?? 500;
      return status >= 500;
    },
  }) as RequestHandler;
}

/**
 * Captura manual de excepción con contexto adicional.
 */
export function captureException(err: Error, context: Record<string, unknown> = {}): void {
  if (!enabled || !Sentry) return;

  Sentry.withScope((scope: { setTag: (k: string, v: unknown) => void }) => {
    Object.entries(context).forEach(([key, value]) => scope.setTag(key, value));
    Sentry.captureException(err);
  });
}

/**
 * Captura un mensaje informativo (no es excepción).
 */
export function captureMessage(
  message: string,
  level: 'info' | 'warning' | 'error' = 'info',
  context: Record<string, unknown> = {},
): void {
  if (!enabled || !Sentry) return;

  Sentry.withScope((scope: { setLevel: (l: string) => void; setTag: (k: string, v: unknown) => void }) => {
    scope.setLevel(level);
    Object.entries(context).forEach(([key, value]) => scope.setTag(key, value));
    Sentry.captureMessage(message);
  });
}

// Export default para compatibilidad con:
//   import sentry from './shared/utils/sentry';
//   sentry.init();
const sentryUtils = { init, errorHandler, captureException, captureMessage };
export default sentryUtils;