import { Router } from 'express';
import * as ctrl from './reports.controller';
import { authenticate, requireTenant } from '../../shared/middleware/auth';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { validate, schemas } from '../../shared/middleware/validate';
import { planFeature } from '../../shared/middleware/planLimits';

const router = Router();
router.use(authenticate, requireTenant, planFeature('reports'));

router.get('/dashboard', validate(schemas.queryListado, 'query'), asyncHandler(ctrl.dashboard));
router.get('/revenue',   validate(schemas.queryListado, 'query'), asyncHandler(ctrl.revenue));
router.get('/services',  validate(schemas.queryListado, 'query'), asyncHandler(ctrl.topServices));
router.get('/customers', validate(schemas.queryListado, 'query'), asyncHandler(ctrl.topCustomers));
router.get('/operators', validate(schemas.queryListado, 'query'), asyncHandler(ctrl.operators));

export default router;