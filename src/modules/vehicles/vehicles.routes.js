const { Router } = require('express');
const ctrl = require('./vehicles.controller');
const { authenticate, requireTenant } = require('../../shared/middleware/auth');
const { asyncHandler } = require('../../shared/utils/asyncHandler');
const { validate, validateId, schemas } = require('../../shared/middleware/validate');

const router = Router();
router.use(authenticate, requireTenant);

// GET    /api/vehicles?search=ABC  (search by plate)
router.get('/', asyncHandler(ctrl.list));

// GET    /api/vehicles/plate/:plate  (búsqueda directa por placa - la más usada)
router.get('/plate/:plate', asyncHandler(ctrl.getByPlate));

// GET    /api/vehicles/:id
router.get('/:id', asyncHandler(ctrl.getById));

// POST   /api/vehicles
router.post('/', validate(schemas.vehicleCreate), asyncHandler(ctrl.create));

// PATCH  /api/vehicles/:id
router.patch('/:id', asyncHandler(ctrl.update));

// DELETE /api/vehicles/:id (soft delete)
router.delete('/:id', asyncHandler(ctrl.remove));

// GET /api/vehicles/:id/history
router.get('/:id/history', asyncHandler(ctrl.getHistory));

module.exports = router;
