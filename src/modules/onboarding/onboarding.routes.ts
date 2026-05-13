import { Router } from 'express';
import * as ctrl from './onboarding.controller';
import { authenticate, requireTenant } from '../../shared/middleware/auth';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { validate, schemas } from '../../shared/middleware/validate';

const router = Router();

// Público — registro de nuevo lavadero
router.post('/register', validate(schemas.onboardingRegister), asyncHandler(ctrl.register));

// Autenticado — pasos post-registro
router.post('/services', authenticate, requireTenant, asyncHandler(ctrl.addDefaultServices));
router.post('/complete', authenticate, requireTenant, asyncHandler(ctrl.complete));
router.get('/status',    authenticate, requireTenant, asyncHandler(ctrl.status));

export default router;