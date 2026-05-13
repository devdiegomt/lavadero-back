import { Router } from 'express';
import * as ctrl from './services.controller';
import { authenticate, authorize, requireTenant } from '../../shared/middleware/auth';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { planLimit } from '../../shared/middleware/planLimits';
import { validate, schemas } from '../../shared/middleware/validate';

const router = Router();
router.use(authenticate, requireTenant);

router.get('/',           asyncHandler(ctrl.list));
router.get('/:id',        asyncHandler(ctrl.getById));
router.post('/',          authorize('admin'), planLimit('services'), validate(schemas.serviceCreate), asyncHandler(ctrl.create));
router.patch('/:id',      authorize('admin'), asyncHandler(ctrl.update));
router.patch('/:id/toggle', authorize('admin'), asyncHandler(ctrl.toggle));

export default router;