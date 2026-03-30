/**
 * Logger estructurado con Pino.
 * 
 * Reemplaza console.log/console.error y Morgan por logging JSON en producción
 * y formato legible en desarrollo.
 * 
 * Uso:
 *   const logger = require('../../shared/utils/logger');
 *   logger.info({ appointmentId, tenantId }, 'Turno creado');
 *   logger.error({ err, paymentId }, 'Error en facturación');
 * 
 * En index.js reemplazar morgan por httpLogger():
 *   const { httpLogger } = require('./shared/utils/logger');
 *   app.use(httpLogger());
 */

const pino = require('pino');

const isDev = process.env.NODE_ENV !== 'production';

const logger = pino({
  level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),

  ...(isDev ? {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss',
        ignore: 'pid,hostname',
      },
    },
  } : {}),

  // Redactar datos sensibles automáticamente
  redact: {
    paths: [
      'req.headers.authorization',
      'password', 'password_hash',
      'token', 'refreshToken',
      'billing_api_key',
    ],
    censor: '[REDACTED]',
  },

  serializers: {
    req: (req) => ({
      method: req.method,
      url: req.url,
      tenantId: req.tenantId,
      userId: req.user?.id,
    }),
    err: pino.stdSerializers.err,
  },
});

/**
 * Middleware HTTP para Express. Reemplaza a Morgan.
 * Cada request se loguea con request ID, duración, status code.
 */
function httpLogger() {
  return (req, res, next) => {
    const start = Date.now();

    // Request ID (útil para trazar errores en producción)
    req.id = req.headers['x-request-id']
      || `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    res.setHeader('X-Request-Id', req.id);

    res.on('finish', () => {
      const ms = Date.now() - start;
      const data = {
        requestId: req.id,
        method: req.method,
        url: req.originalUrl,
        status: res.statusCode,
        ms,
        tenantId: req.tenantId || null,
        userId: req.user?.id || null,
      };

      if (res.statusCode >= 500) {
        logger.error(data, 'Server error');
      } else if (res.statusCode >= 400) {
        logger.warn(data, 'Client error');
      } else if (ms > 1000) {
        logger.warn(data, 'Slow request');
      } else if (!isDev || req.originalUrl !== '/api/health') {
        // En dev no loguear health checks repetitivos
        logger.info(data, 'Request');
      }
    });

    next();
  };
}

module.exports = logger;
module.exports.httpLogger = httpLogger;
