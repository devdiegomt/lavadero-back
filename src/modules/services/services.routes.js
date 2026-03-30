const { Router } = require('express');
const ctrl = require('./services.controller');
const { authenticate, authorize, requireTenant } = require('../../shared/middleware/auth');
const { asyncHandler } = require('../../shared/utils/asyncHandler');
const { planLimit } = require('../../shared/middleware/planLimits');
const { validate, validateId, schemas } = require('../../shared/middleware/validate');

const router = Router();
router.use(authenticate, requireTenant);

// GET    /api/services  (lista activos para el operador)
router.get('/', asyncHandler(ctrl.list));

// GET    /api/services/:id
router.get('/:id', asyncHandler(ctrl.getById));

// POST   /api/services  (solo admin)
router.post('/', authorize('admin'), planLimit('services'), validate(schemas.serviceCreate), asyncHandler(ctrl.create));

// PATCH  /api/services/:id  (solo admin)
router.patch('/:id', authorize('admin'), asyncHandler(ctrl.update));

// PATCH  /api/services/:id/toggle  (activar/desactivar, solo admin)
router.patch('/:id/toggle', authorize('admin'), asyncHandler(ctrl.toggle));

module.exports = router;
