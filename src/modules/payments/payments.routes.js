const { Router } = require('express');
const ctrl = require('./payments.controller');
const { authenticate, requireTenant } = require('../../shared/middleware/auth');
const { asyncHandler } = require('../../shared/utils/asyncHandler');
const { validate, validateId, schemas } = require('../../shared/middleware/validate');

const router = Router();
router.use(authenticate, requireTenant);

// GET    /api/payments?from=2024-03-01&to=2024-03-31&page=1
router.get('/', asyncHandler(ctrl.list));

// GET    /api/payments/summary?from=2024-03-01&to=2024-03-31
router.get('/summary', asyncHandler(ctrl.summary));

// GET    /api/payments/:id
router.get('/:id', asyncHandler(ctrl.getById));

// POST   /api/payments
router.post('/', validate(schemas.paymentCreate), asyncHandler(ctrl.create));

module.exports = router;
