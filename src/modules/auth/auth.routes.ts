import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import type { Request } from 'express';
import { config } from '../../config';
import * as authController from './auth.controller';
import { authenticate } from '../../shared/middleware/auth';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { validate, schemas } from '../../shared/middleware/validate';

const router = Router();

// El limite y la ventana salen de config para poder ajustarlos sin tocar
// codigo. STRICT_RATE_LIMIT_MAX existia desde antes y no se usaba en ningun
// lado: era configuracion muerta que sugeria una proteccion inexistente.
const loginLimiter = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW_MS,
  max: config.STRICT_RATE_LIMIT_MAX,
  skipSuccessfulRequests: true,
  keyGenerator: (req: Request): string => {
    const email = (req.body?.email as string | undefined ?? '').toLowerCase().trim();
    return email ? `${email}|${req.ip}` : (req.ip ?? 'unknown');
  },
  message: 'Demasiados intentos de inicio de sesión. Espera 15 minutos.',
});

router.post('/login', loginLimiter, validate(schemas.login), asyncHandler(authController.login));
router.post('/refresh', validate(schemas.refresh), asyncHandler(authController.refresh));
router.post('/logout', authenticate, asyncHandler(authController.logout));
router.get('/me', authenticate, asyncHandler(authController.me));

export default router;