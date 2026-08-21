import { Router } from 'express';
import * as ctrl from './vehicles.controller';
import { authenticate, requireTenant } from '../../shared/middleware/auth';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { validate, schemas } from '../../shared/middleware/validate';

const router = Router();
router.use(authenticate, requireTenant);

router.get('/',              asyncHandler(ctrl.list));
router.get('/plate/:plate',  asyncHandler(ctrl.getByPlate));
router.get('/:id',           asyncHandler(ctrl.getById));
router.post('/',             validate(schemas.vehicleCreate), asyncHandler(ctrl.create));
router.patch('/:id',         asyncHandler(ctrl.update));
router.delete('/:id',        asyncHandler(ctrl.remove));
router.get('/:id/history',   asyncHandler(ctrl.getHistory));

export default router;