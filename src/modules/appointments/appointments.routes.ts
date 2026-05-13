import { Router } from 'express';
import * as ctrl from './appointments.controller';
import { authenticate, requireTenant } from '../../shared/middleware/auth';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { planLimit } from '../../shared/middleware/planLimits';
import { validate, validateId, schemas } from '../../shared/middleware/validate';

const router = Router();
router.use(authenticate, requireTenant);

router.get('/',         asyncHandler(ctrl.list));
router.get('/today',    asyncHandler(ctrl.today));
router.get('/:id',      validateId, asyncHandler(ctrl.getById));
router.post('/',        planLimit('appointments'), validate(schemas.appointmentCreate), asyncHandler(ctrl.create));
router.patch('/:id',    asyncHandler(ctrl.update));
router.patch('/:id/status', validateId, validate(schemas.statusChange), asyncHandler(ctrl.changeStatus));
router.post('/quick',   planLimit('appointments'), validate(schemas.appointmentQuick), asyncHandler(ctrl.quickCreate));

export default router;