import { Router } from 'express';
import * as ctrl from './vehicles.controller';
import { authenticate, requireTenant } from '../../shared/middleware/auth';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { validate, validarUuid, schemas } from '../../shared/middleware/validate';

const router = Router();
router.use(authenticate, requireTenant);

router.get('/',              validate(schemas.queryListado, 'query'), asyncHandler(ctrl.list));
router.get('/plate/:plate',  asyncHandler(ctrl.getByPlate));
router.get('/:id',           validarUuid('id'), asyncHandler(ctrl.getById));
router.post('/',             validate(schemas.vehicleCreate), asyncHandler(ctrl.create));
router.patch('/:id',         validarUuid('id'), validate(schemas.vehicleUpdate), asyncHandler(ctrl.update));
router.delete('/:id',        validarUuid('id'), asyncHandler(ctrl.remove));
router.get('/:id/history',   validarUuid('id'), asyncHandler(ctrl.getHistory));

export default router;