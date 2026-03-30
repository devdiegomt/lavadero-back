const { Router } = require('express');
const ctrl = require('./reports.controller');
const { authenticate, requireTenant } = require('../../shared/middleware/auth');
const { asyncHandler } = require('../../shared/utils/asyncHandler');

const router = Router();
router.use(authenticate, requireTenant);

// GET /api/reports/dashboard?period=week|month|custom&from=&to=
router.get('/dashboard', asyncHandler(ctrl.dashboard));

// GET /api/reports/revenue?period=week|month
router.get('/revenue', asyncHandler(ctrl.revenue));

// GET /api/reports/services?period=week|month
router.get('/services', asyncHandler(ctrl.topServices));

// GET /api/reports/customers?period=month
router.get('/customers', asyncHandler(ctrl.topCustomers));

// GET /api/reports/operators?period=week|month
router.get('/operators', asyncHandler(ctrl.operators));

module.exports = router;
