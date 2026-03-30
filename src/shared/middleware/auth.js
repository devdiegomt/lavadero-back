const jwt = require('jsonwebtoken');
const { AppError } = require('./errorHandler');

/**
 * Middleware de autenticación.
 * Verifica JWT del header Authorization: Bearer <token>
 * Inyecta req.user con: { id, tenantId, role, email }
 */
function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    throw new AppError('Token de acceso requerido', 401);
  }

  const token = header.split(' ')[1];

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = {
      id: payload.sub,
      tenantId: payload.tenantId,
      role: payload.role,
      email: payload.email,
    };
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw new AppError('Token expirado', 401);
    }
    throw new AppError('Token inválido', 401);
  }
}

/**
 * Middleware de autorización por rol.
 * Uso: authorize('admin') o authorize('admin', 'operator')
 */
function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      throw new AppError('No autenticado', 401);
    }
    // super_admin puede todo
    if (req.user.role === 'super_admin') {
      return next();
    }
    if (!roles.includes(req.user.role)) {
      throw new AppError('No tienes permisos para esta acción', 403);
    }
    next();
  };
}

/**
 * Middleware que asegura tenant_id en todas las queries.
 * Inyecta req.tenantId para uso en los módulos.
 *
 * IMPORTANTE: Usar en TODAS las rutas de negocio.
 * Sin esto, un usuario podría ver datos de otro tenant.
 */
function requireTenant(req, res, next) {
  if (!req.user?.tenantId) {
    throw new AppError('Tenant no identificado', 400);
  }
  req.tenantId = req.user.tenantId;
  next();
}

module.exports = { authenticate, authorize, requireTenant };
