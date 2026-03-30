const { Router } = require('express');
const ctrl = require('./users.controller');
const { authenticate, authorize, requireTenant } = require('../../shared/middleware/auth');
const { asyncHandler } = require('../../shared/utils/asyncHandler');
const { planLimit } = require('../../shared/middleware/planLimits');
const { validate, validateId, schemas } = require('../../shared/middleware/validate');

const router = Router();
router.use(authenticate, requireTenant);

// GET    /api/users
router.get('/', asyncHandler(ctrl.list));

// POST   /api/users  (crear operador - solo admin)
router.post('/', authorize('admin'), planLimit('operators'), validate(schemas.userCreate), asyncHandler(ctrl.create));

// PATCH  /api/users/:id  (editar - solo admin)
router.patch('/:id', authorize('admin'), asyncHandler(ctrl.update));

// PATCH  /api/users/:id/toggle  (activar/desactivar - solo admin)
router.patch('/:id/toggle', authorize('admin'), asyncHandler(ctrl.toggle));

// PATCH  /api/users/:id/password  (cambiar contraseña - admin o el propio usuario)
router.patch('/:id/password', asyncHandler(ctrl.changePassword));


module.exports = router;
