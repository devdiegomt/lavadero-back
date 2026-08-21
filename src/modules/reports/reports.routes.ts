import { Router } from 'express';
import * as ctrl from './reports.controller';
import { authenticate, requireTenant } from '../../shared/middleware/auth';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { planFeature } from '../../shared/middleware/planLimits';

const router = Router();
router.use(authenticate, requireTenant, planFeature('reports'));

router.get('/dashboard', asyncHandler(ctrl.dashboard));
router.get('/revenue',   asyncHandler(ctrl.revenue));
router.get('/services',  asyncHandler(ctrl.topServices));
router.get('/customers', asyncHandler(ctrl.topCustomers));
router.get('/operators', asyncHandler(ctrl.operators));

export default router;