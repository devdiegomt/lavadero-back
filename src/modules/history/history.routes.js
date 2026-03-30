const { Router } = require('express');
const ctrl = require('./history.controller');
const { authenticate, requireTenant } = require('../../shared/middleware/auth');
const { asyncHandler } = require('../../shared/utils/asyncHandler');

const router = Router();
router.use(authenticate, requireTenant);

// GET /api/history/vehicle/:plate  (historial por placa)
router.get('/vehicle/:plate', asyncHandler(ctrl.vehicleHistory));

// GET /api/history/customer/:id  (historial por cliente)
router.get('/customer/:id', asyncHandler(ctrl.customerHistory));

// GET /api/history/search?q=ABC  (búsqueda global: placa, teléfono, nombre)
router.get('/search', asyncHandler(ctrl.search));

module.exports = router;
