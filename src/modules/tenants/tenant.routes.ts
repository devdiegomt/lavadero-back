import { Router } from 'express';
import * as tenantController from './tenant.controller';
import { authenticate, authorize, requireTenant } from '../../shared/middleware/auth';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { validate, schemas } from '../../shared/middleware/validate';

const router = Router();
router.use(authenticate, requireTenant);

router.get('/me',           asyncHandler(tenantController.getCurrent));
router.patch('/me',         authorize('admin'), validate(schemas.tenantUpdate), asyncHandler(tenantController.updateCurrent));
router.get('/me/stats',     validate(schemas.queryListado, 'query'), asyncHandler(tenantController.getDayStats));
router.get('/me/operators', asyncHandler(tenantController.getOperators));
router.get('/me/usage',     asyncHandler(tenantController.getUsage)); // bugfix: faltaba en el original

export default router;