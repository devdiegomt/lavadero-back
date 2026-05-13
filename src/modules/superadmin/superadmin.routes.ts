import { Router } from 'express';
import * as ctrl from './superadmin.controller';
import { authenticate, authorize } from '../../shared/middleware/auth';
import { asyncHandler } from '../../shared/utils/asyncHandler';

const router = Router();
router.use(authenticate, authorize('super_admin'));

router.get('/dashboard',              asyncHandler(ctrl.dashboard));
router.get('/tenants',                asyncHandler(ctrl.listTenants));
router.get('/tenants/:id',            asyncHandler(ctrl.getTenantDetail));
router.patch('/tenants/:id',          asyncHandler(ctrl.updateTenant));
router.patch('/tenants/:id/plan',     asyncHandler(ctrl.changePlan));
router.patch('/tenants/:id/toggle',   asyncHandler(ctrl.toggleTenant));
router.get('/plans',                  asyncHandler(ctrl.listPlans));
router.put('/plans/:id',              asyncHandler(ctrl.updatePlan));

export default router;