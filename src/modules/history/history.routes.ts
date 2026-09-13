import { Router } from 'express';
import * as ctrl from './history.controller';
import { authenticate, requireTenant } from '../../shared/middleware/auth';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { validarUuid } from '../../shared/middleware/validate';

const router = Router();
router.use(authenticate, requireTenant);

router.get('/vehicle/:plate', asyncHandler(ctrl.vehicleHistory));
router.get('/customer/:id',   validarUuid('id'), asyncHandler(ctrl.customerHistory));
router.get('/search',         asyncHandler(ctrl.search));

export default router;