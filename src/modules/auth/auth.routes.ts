import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import type { Request } from 'express';
import { config } from '../../config';
import * as authController from './auth.controller';
import { authenticate } from '../../shared/middleware/auth';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { validate, schemas } from '../../shared/middleware/validate';
import { conBypassRls } from '../../shared/middleware/rls';
import { exigirIntencionDelPanel } from './cookies';

const router = Router();

// La autenticación no puede tener contexto de tenant: el login busca al usuario
// por email justamente para averiguar de qué lavadero es. No se puede filtrar por
// tenant para averiguar el tenant. Es una de las tres puertas de atrás de RLS, y
// está enumerada en shared/middleware/rls.ts.
router.use(conBypassRls('autenticación: el tenant se conoce después de validar'));

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
// `exigirIntencionDelPanel` es la defensa contra CSRF de los dos únicos
// endpoints que se autentican con cookie. Las rutas que cambian datos usan
// `Authorization`, que el navegador nunca adjunta solo, así que no la necesitan.
// Ver modules/auth/cookies.ts.
//
// Ya no valida el cuerpo: el token viene de la cookie. Exigirlo en el cuerpo
// rechazaría justamente el flujo nuevo.
router.post('/refresh', exigirIntencionDelPanel, asyncHandler(authController.refresh));
router.post('/logout', exigirIntencionDelPanel, authenticate, asyncHandler(authController.logout));
router.get('/me', authenticate, asyncHandler(authController.me));

export default router;