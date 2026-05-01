const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const authController = require('./auth.controller');
const { authenticate } = require('../../shared/middleware/auth');
const { asyncHandler } = require('../../shared/utils/asyncHandler');
const { validate, validateId, schemas } = require('../../shared/middleware/validate');

const router = Router();

// ---------------------------------------------------------------------------
// Rate limit por email para login.
// El limitador global por IP no protege contra credential stuffing distribuido
// (muchos atacantes apuntando al mismo email desde IPs distintas).
// Aquí cuentamos intentos por email + IP, y solo los fallidos.
// ---------------------------------------------------------------------------
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 10,                  // 10 intentos fallidos por email por ventana
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // los logins exitosos no cuentan
  keyGenerator: (req) => {
    const email = (req.body?.email || '').toLowerCase().trim();
    // Combina email + IP para no penalizar a otros usuarios desde la misma IP
    return email ? `${email}|${req.ip}` : req.ip;
  },
  message: {
    error: 'Demasiados intentos de inicio de sesión. Espera 15 minutos.',
  },
});

// POST /api/auth/login
router.post('/login', loginLimiter, validate(schemas.login), asyncHandler(authController.login));

// POST /api/auth/refresh
router.post('/refresh', validate(schemas.refresh), asyncHandler(authController.refresh));

// POST /api/auth/logout
router.post('/logout', authenticate, asyncHandler(authController.logout));

// GET /api/auth/me (perfil del usuario autenticado)
router.get('/me', authenticate, asyncHandler(authController.me));

module.exports = router;
