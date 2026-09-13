/**
 * Rutas de la bitacoría de acciones. Sólo lectura y sólo `admin`.
 *
 * No hay `POST`: las filas las escribe el middleware `auditarAcciones`, no una
 * llamada de nadie. Una bitácora en la que se puede escribir a mano sirve mucho
 * menos como bitácora.
 */
import { Router } from 'express';
import * as ctrl from './audit.controller';
import { authenticate, authorize, requireTenant } from '../../shared/middleware/auth';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { validate, schemas } from '../../shared/middleware/validate';

const router = Router();
router.use(authenticate, requireTenant, authorize('admin'));

router.get('/', validate(schemas.queryAuditoria, 'query'), asyncHandler(ctrl.list));

export default router;
