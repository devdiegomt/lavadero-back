import type { Request, Response, NextFunction } from 'express';

/**
 * Error operacional de la API.
 *
 * Lanzar con `throw new AppError('mensaje', statusCode)` en cualquier
 * controller o middleware. El errorHandler global lo captura y responde
 * con el statusCode y mensaje apropiados.
 *
 * `isOperational = true` distingue estos errores de bugs inesperados;
 * solo los bugs se reportan a Sentry como 5xx.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly details: unknown;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode = 500, details: unknown = null) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;

    // Necesario para que instanceof funcione correctamente en subclases de Error
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Shape de error PostgreSQL que nos interesa */
interface PgError extends Error {
  code?: string;
  detail?: string;
}

/**
 * Middleware de manejo de errores global.
 * Siempre debe ir al final del pipeline de Express (4 parámetros).
 */
export function errorHandler(
  err: PgError | AppError,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (process.env.NODE_ENV !== 'production') {
    console.error('❌', err.message);
    if (err.stack && !('isOperational' in err && err.isOperational)) {
      console.error(err.stack);
    }
  }

  // Errores operacionales (los que lanzamos nosotros)
  if ('isOperational' in err && err.isOperational) {
    res.status(err.statusCode).json({
      error: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
    return;
  }

  // Errores de PostgreSQL — nunca exponer detalles del schema en producción
  if ("code" in err && err.code === '23505') {
    res.status(409).json({
      error: 'El registro ya existe.',
      ...(process.env.NODE_ENV !== 'production' && (err as PgError).detail
        ? { details: (err as PgError).detail }
        : {}),
    });
    return;
  }

  if ("code" in err && err.code === '23503') {
    res.status(400).json({
      error: 'Referencia inválida. El registro relacionado no existe.',
    });
    return;
  }

  // Error no esperado (bug)
  res.status(500).json({ error: 'Error interno del servidor.' });
}