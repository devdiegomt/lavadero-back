import { Router } from 'express';
import * as ctrl from './customers.controller';
import { authenticate, authorize, requireTenant } from '../../shared/middleware/auth';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { validate, schemas } from '../../shared/middleware/validate';

const router = Router();
router.use(authenticate, requireTenant);

router.get('/',                asyncHandler(ctrl.list));
router.get('/:id',             asyncHandler(ctrl.getById));
router.post('/',               validate(schemas.customerCreate), asyncHandler(ctrl.create));
router.patch('/:id',           asyncHandler(ctrl.update));
router.delete('/:id',          asyncHandler(ctrl.remove));
// Supresion de datos personales (Ley 1581). Es irreversible y distinta del
// DELETE de arriba, que solo hace borrado logico y conserva los datos.
router.post('/:id/anonimizar', authorize('admin'), asyncHandler(ctrl.anonimizar));
router.get('/:id/vehicles',    asyncHandler(ctrl.getVehicles));
router.get('/:id/history',     asyncHandler(ctrl.getHistory));

export default router;