import { Router } from 'express';
import * as ctrl from './customers.controller';
import { authenticate, authorize, requireTenant } from '../../shared/middleware/auth';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { validate, validarUuid, schemas } from '../../shared/middleware/validate';

const router = Router();
router.use(authenticate, requireTenant);

router.get('/',                validate(schemas.queryListado, 'query'), asyncHandler(ctrl.list));
router.get('/:id',             validarUuid('id'), asyncHandler(ctrl.getById));
router.post('/',               validate(schemas.customerCreate), asyncHandler(ctrl.create));
router.patch('/:id',           validarUuid('id'), asyncHandler(ctrl.update));
router.delete('/:id',          validarUuid('id'), asyncHandler(ctrl.remove));
// Supresion de datos personales (Ley 1581). Es irreversible y distinta del
// DELETE de arriba, que solo hace borrado logico y conserva los datos.
router.post('/:id/anonimizar', validarUuid('id'), authorize('admin'), asyncHandler(ctrl.anonimizar));
router.get('/:id/vehicles',    validarUuid('id'), asyncHandler(ctrl.getVehicles));
router.get('/:id/history',     validarUuid('id'), asyncHandler(ctrl.getHistory));

export default router;