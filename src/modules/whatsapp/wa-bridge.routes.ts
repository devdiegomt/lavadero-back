/**
 * Rutas internas para n8n. Autenticación vía API key, tenant por número de WhatsApp.
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import * as db from '../../shared/db';
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

router.use(n8nAuth);
router.use(resolveTenant);

router.get('/appointment-status', ctrl.getAppointmentStatus);
router.get('/services',           ctrl.getServices);
router.get('/customer-history',   ctrl.getCustomerHistory);
router.post('/book',              ctrl.bookAppointment);
router.post('/log',               ctrl.logMessage);

export default router;