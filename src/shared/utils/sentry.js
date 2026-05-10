/**
 * Inicialización opcional de Sentry para el backend.
 *
 * Si SENTRY_DSN no está definido en el entorno, este módulo se desactiva
 * silenciosamente y exporta un middleware no-op. Esto permite levantar el
 * backend en desarrollo sin necesidad de configurar Sentry, y activarlo
 * solo en producción.
 *
 * Uso en src/index.js:
 *   const sentry = require('./shared/utils/sentry');
 *   sentry.init();
 *   // ...después de definir las rutas, antes del errorHandler:
 *   app.use(sentry.errorHandler());
 *
 * Para capturar manualmente desde cualquier módulo:
 *   const sentry = require('../../shared/utils/sentry');
 *   sentry.captureException(err, { tenantId, paymentId });
 *
 * Requiere: npm install @sentry/node @sentry/profiling-node
 */

let Sentry = null;
let enabled = false;

function init() {
  if (!process.env.SENTRY_DSN) {
    return; // Sentry desactivado: no hay DSN
  }

  try {
    // Carga lazy: si la dependencia no está instalada, el backend
    // no se cae — solo queda Sentry desactivado con un warning.
    Sentry = require('@sentry/node');

    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV || 'development',
      release: process.env.SENTRY_RELEASE || undefined,
      // Sample rate de traces (rendimiento); 0.0 desactiva tracing,
      // 1.0 captura el 100%. En producción ajustar a 0.1–0.2.
      tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1'),
      // Ignora ruidos comunes que no son errores reales
      ignoreErrors: [
        'AppError',          // errores de negocio esperados (4xx)
        'TokenExpiredError', // jwt expirado, lo manejamos en auth
      ],
      beforeSend(event) {
        // No enviar a Sentry los errores 4xx (son bugs del cliente o validación)
        if (event.contexts?.response?.status_code < 500) return null;
        return event;
      },
    });
    enabled = true;
    // eslint-disable-next-line no-console
    console.log('🛡️  Sentry inicializado para', process.env.NODE_ENV);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('⚠️  SENTRY_DSN configurado pero @sentry/node no instalado.');
    console.warn('   Ejecuta: npm install @sentry/node');
  }
}

/**
 * Middleware Express que captura excepciones automáticamente.
 * Si Sentry no está activo, devuelve un middleware no-op.
 */
function errorHandler() {
  if (!enabled || !Sentry) {
    return (err, req, res, next) => next(err);
  }
  return Sentry.Handlers.errorHandler({
    shouldHandleError(error) {
      // Solo enviar 5xx y errores no clasificados
      const status = error.statusCode || error.status || 500;
      return status >= 500;
    },
  });
}

/**
 * Captura manual de excepción con contexto adicional.
 * Útil para errores que se manejan pero queremos rastrear.
 */
function captureException(err, context = {}) {
  if (!enabled || !Sentry) return;
  Sentry.withScope((scope) => {
    Object.entries(context).forEach(([key, value]) => {
      scope.setTag(key, value);
    });
    Sentry.captureException(err);
  });
}

/**
 * Captura mensaje informativo (no es excepción).
 */
function captureMessage(message, level = 'info', context = {}) {
  if (!enabled || !Sentry) return;
  Sentry.withScope((scope) => {
    scope.setLevel(level);
    Object.entries(context).forEach(([key, value]) => {
      scope.setTag(key, value);
    });
    Sentry.captureMessage(message);
  });
}

module.exports = { init, errorHandler, captureException, captureMessage };