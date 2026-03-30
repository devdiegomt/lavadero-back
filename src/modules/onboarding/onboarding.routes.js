const { Router } = require('express');
const ctrl = require('./onboarding.controller');
const { authenticate, requireTenant } = require('../../shared/middleware/auth');
const { asyncHandler } = require('../../shared/utils/asyncHandler');
const { validate, validateId, schemas } = require('../../shared/middleware/validate');

const router = Router();

// PÚBLICO — Registro de nuevo lavadero (no requiere auth)
router.post('/register', validate(schemas.onboardingRegister), asyncHandler(ctrl.register));

// AUTENTICADO — Pasos post-registro
router.post('/services', authenticate, requireTenant, asyncHandler(ctrl.addDefaultServices));
router.post('/complete', authenticate, requireTenant, asyncHandler(ctrl.complete));
router.get('/status', authenticate, requireTenant, asyncHandler(ctrl.status));

module.exports = router;
