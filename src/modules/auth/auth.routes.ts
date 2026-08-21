import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import type { Request } from 'express';
import * as authController from './auth.controller';
import { authenticate } from '../../shared/middleware/auth';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { validate, schemas } from '../../shared/middleware/validate';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1_000,
  max: 10,
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