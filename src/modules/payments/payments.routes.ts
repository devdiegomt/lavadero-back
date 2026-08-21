import { Router } from 'express';
import * as ctrl from './payments.controller';
import { authenticate, requireTenant } from '../../shared/middleware/auth';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { validate, schemas } from '../../shared/middleware/validate';

const router = Router();
router.use(authenticate, requireTenant);

router.get('/',        asyncHandler(ctrl.list));
router.get('/summary', asyncHandler(ctrl.summary));
router.get('/:id',     asyncHandler(ctrl.getById));
router.post('/',       validate(schemas.paymentCreate), asyncHandler(ctrl.create));

export default router;