/**
 * Error personalizado para la API.
 * Uso: throw new AppError('No autorizado', 401);
 */
class AppError extends Error {
  constructor(message, statusCode = 500, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
  }
}

/**
 * Middleware de manejo de errores global.
 * Express lo reconoce como error handler por tener 4 parámetros.
 */
function errorHandler(err, req, res, _next) {
  // Log del error (en prod usarías Pino/Sentry)
  if (process.env.NODE_ENV !== 'production') {
    console.error('❌', err.message);
    if (err.stack && !err.isOperational) {
      console.error(err.stack);
    }
  }

  // Errores operacionales (los que lanzamos nosotros)
  if (err.isOperational) {
    return res.status(err.statusCode).json({
      error: err.message,
      ...(err.details && { details: err.details }),
    });
  }

  // Errores de PostgreSQL
  // NOTA: err.detail contiene info del schema ("Key (tenant_id, email)=...")
  // que no debe filtrarse al cliente. Solo se expone en desarrollo.
  if (err.code === '23505') {
    return res.status(409).json({
      error: 'El registro ya existe.',
      ...(process.env.NODE_ENV !== 'production' && err.detail ? { details: err.detail } : {}),
    });
  }
  if (err.code === '23503') {
    return res.status(400).json({
      error: 'Referencia inválida. El registro relacionado no existe.',
    });
  }

  // Error no esperado
  return res.status(500).json({
    error: 'Error interno del servidor.',
  });
}

module.exports = { AppError, errorHandler };
