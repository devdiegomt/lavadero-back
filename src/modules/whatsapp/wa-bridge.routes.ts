/**
 * Rutas internas para n8n. Autenticación vía API key, tenant por número de WhatsApp.
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import * as db from '../../shared/db';
import { leerIdentidad } from './wa-identity';
import { bookingStep } from './wa-bridge.booking';
import * as ctrl from './wa-bridge.controller';

const router = Router();

// ─── Middleware: autenticar llamadas de n8n ───────────────────────────────────

function n8nAuth(req: Request, res: Response, next: NextFunction): void {
  const apiKey = process.env.N8N_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: 'N8N_API_KEY no configurado en el servidor' });
    return;
  }

  const authHeader = (req.headers['x-api-key'] ?? req.headers['authorization'] ?? '') as string;
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;

  const expected = Buffer.from(apiKey);
  const provided = Buffer.from(token);

  if (
    provided.length !== expected.length ||
    !crypto.timingSafeEqual(expected, provided)
  ) {
    res.status(401).json({ error: 'No autorizado' });
    return;
  }

  next();
}

// ─── Middleware: resolver tenant por x-tenant-phone ──────────────────────────

async function resolveTenant(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantPhone = req.headers['x-tenant-phone'] as string | undefined;
    if (!tenantPhone) {
      res.status(400).json({ error: 'Header x-tenant-phone requerido' });
      return;
    }

    const normalized = tenantPhone.replace(/[\s\-()]/g, '');

    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM tenants WHERE whatsapp_phone = $1 AND is_active = true LIMIT 1`,
      [normalized],
    );

    if (!rows[0]) {
      res.status(404).json({ error: `Tenant no encontrado para phone: ${normalized}` });
      return;
    }

    req.tenantId = rows[0].id;
    next();
  } catch (err) {
    next(err);
  }
}

// ─── Middleware: límite por cliente de WhatsApp ──────────────────────────────

/**
 * Limita por **cliente de WhatsApp**, no por IP.
 *
 * Todo el tráfico de esta ruta llega desde n8n, que es una sola dirección. Con
 * el limitador global —por IP— la cuota era compartida por todos los clientes
 * del lavadero: unos 20 mensajes la agotaban y el bot dejaba de responderle a
 * todo el mundo. Pasó en producción y el síntoma no delataba la causa; se veía
 * como si el agendamiento estuviera roto, porque un 429 en `booking-step` hace
 * que n8n crea que no hay conversación en curso y mande el mensaje a Claude.
 *
 * Va **después** de `n8nAuth`: quien llega hasta acá ya demostró conocer el
 * secreto compartido, así que lo que queda por contener no es un atacante
 * anónimo sino un cliente —o un bucle— hablando de más. Y va después de
 * `resolveTenant` para que la clave incluya el lavadero: dos clientes de
 * lavaderos distintos no se estorban entre sí.
 */
const limitePorCliente = rateLimit({
  windowMs: process.env.RATE_LIMIT_WINDOW_MS
    ? parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10)
    : 15 * 60 * 1_000,
  max: process.env.WA_BRIDGE_RATE_LIMIT_MAX
    ? parseInt(process.env.WA_BRIDGE_RATE_LIMIT_MAX, 10)
    : 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request): string => {
    const id = leerIdentidad({
      ...(req.body as Record<string, unknown>),
      ...(req.query as Record<string, unknown>),
    });
    // Sin identidad —las consultas por placa no la traen— se agrupa por
    // lavadero. Es menos fino, pero sigue sin ser una cuota global.
    const cliente = id.waLid ?? id.phone ?? 'sin-identidad';
    return `${req.tenantId ?? 'sin-tenant'}:${cliente}`;
  },
  message: {
    error: 'Demasiados mensajes seguidos. Espera un momento e intenta de nuevo.',
  },
});

router.use(n8nAuth);
router.use(resolveTenant);
router.use(limitePorCliente);

router.get('/appointment-status', ctrl.getAppointmentStatus);
router.get('/services',           ctrl.getServices);
router.get('/customer-history',   ctrl.getCustomerHistory);
router.post('/book',              ctrl.bookAppointment);
router.post('/booking-step',      bookingStep);
router.post('/log',               ctrl.logMessage);

export default router;