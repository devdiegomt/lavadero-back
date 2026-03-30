/**
 * Super Admin Routes
 * 
 * TODAS las rutas requieren role='super_admin'.
 * El super_admin NO tiene tenant_id (es un usuario global).
 */

const { Router } = require('express');
const ctrl = require('./superadmin.controller');
const { authenticate, authorize } = require('../../shared/middleware/auth');
const { asyncHandler } = require('../../shared/utils/asyncHandler');

const router = Router();

// Todas las rutas requieren super_admin
router.use(authenticate);
router.use(authorize('super_admin'));

// ── Dashboard ────────────────────────────────────────────────────────
router.get('/dashboard', asyncHandler(ctrl.dashboard));

// ── Tenants ──────────────────────────────────────────────────────────
router.get('/tenants', asyncHandler(ctrl.listTenants));
router.get('/tenants/:id', asyncHandler(ctrl.getTenantDetail));
router.patch('/tenants/:id', asyncHandler(ctrl.updateTenant));
router.patch('/tenants/:id/plan', asyncHandler(ctrl.changePlan));
router.patch('/tenants/:id/toggle', asyncHandler(ctrl.toggleTenant));

// ── Planes ───────────────────────────────────────────────────────────
router.get('/plans', asyncHandler(ctrl.listPlans));
router.put('/plans/:id', asyncHandler(ctrl.updatePlan));

module.exports = router;
