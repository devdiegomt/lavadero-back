const { Router } = require('express');
const ctrl = require('./customers.controller');
const { authenticate, requireTenant } = require('../../shared/middleware/auth');
const { asyncHandler } = require('../../shared/utils/asyncHandler');
const { validate, validateId, schemas } = require('../../shared/middleware/validate');

const router = Router();
router.use(authenticate, requireTenant);

// GET    /api/customers?search=xxx&page=1&limit=20
router.get('/', asyncHandler(ctrl.list));

// GET    /api/customers/:id
router.get('/:id', asyncHandler(ctrl.getById));

// POST   /api/customers
router.post('/', validate(schemas.customerCreate), asyncHandler(ctrl.create));

// PATCH  /api/customers/:id
router.patch('/:id', asyncHandler(ctrl.update));

// DELETE /api/customers/:id  (soft delete)
router.delete('/:id', asyncHandler(ctrl.remove));

// GET    /api/customers/:id/vehicles
router.get('/:id/vehicles', asyncHandler(ctrl.getVehicles));

// GET    /api/customers/:id/history
router.get('/:id/history', asyncHandler(ctrl.getHistory));

module.exports = router;
