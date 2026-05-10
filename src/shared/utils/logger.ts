/**
 * Logger estructurado con Pino.
 *
 * PATRÓN DE EXPORT: usa `export =` (CommonJS puro) para que los archivos
 * JS que aún no se han migrado puedan seguir haciendo:
 *   const logger = require('../../shared/utils/logger');
 *   logger.info(...);
 *   const { httpLogger } = require('../../shared/utils/logger');
 *
 * Archivos TS nuevos usan:
 *   import logger from '../../shared/utils/logger';   // esModuleInterop
 *   import { httpLogger } from '../../shared/utils/logger';
 *
 * Datos sensibles redactados automáticamente.
 */

import pino, { type Logger } from 'pino';
import type { Request, Response, NextFunction, RequestHandler } from 'express';

const isDev = process.env.NODE_ENV !== 'production';

const logger: Logger = pino({
  level: process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info'),

  ...(isDev
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss',
            ignore: 'pid,hostname',
          },
        },
      }
    : {}),

  // Redactar datos sensibles automáticamente en todos los logs
  redact: {
    paths: [
      'req.headers.authorization',
      'password',
      'password_hash',
      'token',
      'refreshToken',
      'billing_api_key',
    ],
    censor: '[REDACTED]',
  },

  serializers: {
    req: (req: Request) => ({
      method: req.method,
      url: req.url,
      tenantId: req.tenantId,
      userId: req.user?.id,
    }),
    err: pino.stdSerializers.err,
  },
});

/**
 * Middleware HTTP para Express.
 * Loguea cada request con método, URL, status code, duración,
 * tenantId y userId. Añade el header `X-Request-Id` a la response.
 */
function httpLogger(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const start = Date.now();

    // Request ID para trazar errores en producción
    const requestId =
      (req.headers['x-request-id'] as string | undefined) ??
      `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

    (req as Request & { id?: string }).id = requestId;
    res.setHeader('X-Request-Id', requestId);

    res.on('finish', () => {
      const ms = Date.now() - start;
      const data = {
        requestId,
        method: req.method,
        url: req.originalUrl,
        status: res.statusCode,
        ms,
        tenantId: req.tenantId ?? null,
        userId: req.user?.id ?? null,
      };

      if (res.statusCode >= 500) {
        logger.error(data, 'Server error');
      } else if (res.statusCode >= 400) {
        logger.warn(data, 'Client error');
      } else if (ms > 1_000) {
        logger.warn(data, 'Slow request');
      } else if (!isDev || req.originalUrl !== '/api/health') {
        // En dev, suprimir health checks para no llenar el terminal
        logger.info(data, 'Request');
      }
    });

    next();
  };
}

// ─── Exportación compatible con CommonJS ──────────────────────────────────────
// `export =` compila a `module.exports = ...`, que es lo que esperan los
// archivos JS que aún hacen `const logger = require('./logger')`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LoggerWithHttp = Logger & { httpLogger: () => RequestHandler };
const exportObj = logger as LoggerWithHttp;
exportObj.httpLogger = httpLogger;

export = exportObj;