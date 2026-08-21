import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { AppError } from './errorHandler';
import { config } from '../../config';
import type { JwtPayload } from '../../types/api';
import type { UserRole } from '../../types/entities';

/**
 * Verifica el JWT del header `Authorization: Bearer <token>`.
 * Inyecta `req.user` con el payload del token.
 *
 * No requiere tenant — permite que super_admin (tenantId = null) pase.
 */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;

  if (!header?.startsWith('Bearer ')) {
    throw new AppError('Token de acceso requerido', 401);
  }

  const token = header.split(' ')[1];

  try {
    const payload = jwt.verify(token, config.JWT_SECRET) as JwtPayload;
    req.user = {
      id: payload.sub,
      tenantId: payload.tenantId,
      role: payload.role,
      email: payload.email,
    };
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new AppError('Token expirado', 401);
    }
    throw new AppError('Token inválido', 401);
  }
}

/**
 * Middleware de autorización por rol.
 *
 * Nota: `super_admin` pasa siempre (bypass implícito).
 *
 * Uso:
 *   router.delete('/:id', authenticate, authorize('admin'), asyncHandler(ctrl.delete));
 *   router.post('/', authenticate, authorize('admin', 'operator'), asyncHandler(ctrl.create));
 */
export function authorize(...roles: UserRole[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
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
 * Garantiza que `req.tenantId` esté presente.
 * Protege contra queries sin WHERE tenant_id que expondrían datos de otros tenants.
 *
 * Debe usarse DESPUÉS de `authenticate` en todas las rutas de negocio.
 * Super admin NO tiene tenant_id → lanza 400 si intenta usar rutas de tenant.
 */
export function requireTenant(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user?.tenantId) {
    throw new AppError('Tenant no identificado', 400);
  }
  req.tenantId = req.user.tenantId;
  next();
}