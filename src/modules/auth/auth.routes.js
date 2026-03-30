const { Router } = require('express');
const authController = require('./auth.controller');
const { authenticate } = require('../../shared/middleware/auth');
const { asyncHandler } = require('../../shared/utils/asyncHandler');
const { validate, validateId, schemas } = require('../../shared/middleware/validate');

const router = Router();

// POST /api/auth/login
router.post('/login', validate(schemas.login), asyncHandler(authController.login));

// POST /api/auth/refresh
router.post('/refresh', validate(schemas.refresh), asyncHandler(authController.refresh));

// POST /api/auth/logout
router.post('/logout', authenticate, asyncHandler(authController.logout));

// GET /api/auth/me (perfil del usuario autenticado)
router.get('/me', authenticate, asyncHandler(authController.me));

module.exports = router;
