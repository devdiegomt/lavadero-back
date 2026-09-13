import { Router } from 'express';
import * as ctrl from './superadmin.controller';
import { authenticate, authorize } from '../../shared/middleware/auth';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { validate, validarUuid, schemas } from '../../shared/middleware/validate';

const router = Router();
router.use(authenticate, authorize('super_admin'));

router.get('/dashboard',              asyncHandler(ctrl.dashboard));
router.get('/tenants',                validate(schemas.queryListado, 'query'), asyncHandler(ctrl.listTenants));
router.get('/tenants/:id',            validarUuid('id'), asyncHandler(ctrl.getTenantDetail));
router.patch('/tenants/:id',          validarUuid('id'), asyncHandler(ctrl.updateTenant));
router.patch('/tenants/:id/plan',     validarUuid('id'), asyncHandler(ctrl.changePlan));
router.patch('/tenants/:id/toggle',   validarUuid('id'), asyncHandler(ctrl.toggleTenant));
router.get('/plans',                  asyncHandler(ctrl.listPlans));
router.put('/plans/:id',              asyncHandler(ctrl.updatePlan));

export default router;