const { Router } = require('express');
const tenantController = require('./tenant.controller');
const { authenticate, authorize, requireTenant } = require('../../shared/middleware/auth');
const { asyncHandler } = require('../../shared/utils/asyncHandler');

const router = Router();

// Todas las rutas de tenant requieren autenticación
router.use(authenticate);
router.use(requireTenant);

// GET /api/tenants/me - Config del lavadero actual
router.get('/me', asyncHandler(tenantController.getCurrent));

// PATCH /api/tenants/me - Actualizar config del lavadero
router.patch('/me', authorize('admin'), asyncHandler(tenantController.updateCurrent));

// GET /api/tenants/me/stats - Resumen rápido del día
router.get('/me/stats', asyncHandler(tenantController.getDayStats));

// GET /api/tenants/me/operators - Operadores del lavadero
router.get('/me/operators', asyncHandler(tenantController.getOperators));

router.get('/me/usage', asyncHandler(tenantController.getUsage));

module.exports = router;
