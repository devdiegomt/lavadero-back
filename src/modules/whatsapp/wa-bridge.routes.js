/**
 * wa-bridge.routes.js
 *
 * Rutas internas para n8n. Autenticación vía API key (N8N_API_KEY).
 * El tenant se resuelve por el header x-tenant-phone.
 *
 * Todas las rutas: /api/wa-bridge/*
 */

const { Router } = require('express');
const db = require('../../shared/db');
const {
  getAppointmentStatus,
  getServices,
  getCustomerHistory,
  bookAppointment,
  logMessage,
} = require('./wa-bridge.controller');

const router = Router();

// ---------------------------------------------------------------------------
// Middleware: autenticar llamadas de n8n con API key
//
// Falla cerrado sin importar el entorno: si N8N_API_KEY no está configurado
// el endpoint queda inaccesible. Antes solo bloqueaba con NODE_ENV=production,
// lo que dejaba el endpoint abierto si alguien olvidaba setear NODE_ENV.
// ---------------------------------------------------------------------------
const crypto = require('crypto');

function n8nAuth(req, res, next) {
  const apiKey = process.env.N8N_API_KEY;

  if (!apiKey) {
    return res.status(503).json({
      error: 'N8N_API_KEY no configurado en el servidor',
    });
  }

  const authHeader = req.headers['x-api-key'] || req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;

  // Comparación de tiempo constante para evitar timing attacks
  const expected = Buffer.from(apiKey);
  const provided = Buffer.from(token);
  if (provided.length !== expected.length ||
      !crypto.timingSafeEqual(expected, provided)) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  next();
}

// ---------------------------------------------------------------------------
// Middleware: resolver tenant por número de WhatsApp (x-tenant-phone header)
//
// El tenant SIEMPRE se resuelve a partir del número de WhatsApp del lavadero.
// No se permite pasar tenant_id directo desde headers — eso permitiría que
// cualquier caller con la N8N_API_KEY se hiciera pasar por cualquier tenant.
// ---------------------------------------------------------------------------
async function resolveTenant(req, res, next) {
  try {
    const tenantPhone = req.headers['x-tenant-phone'];
    if (!tenantPhone) {
      return res.status(400).json({
        error: 'Header x-tenant-phone requerido',
      });
    }

    const normalized = String(tenantPhone).replace(/[\s\-\(\)]/g, '');

    const { rows } = await db.query(
      `SELECT id FROM tenants
       WHERE whatsapp_phone = $1 AND is_active = true
       LIMIT 1`,
      [normalized]
    );

    if (!rows[0]) {
      return res.status(404).json({
        error: `Tenant no encontrado para phone: ${normalized}`,
      });
    }

    req.tenantId = rows[0].id;
    next();
  } catch (err) {
    next(err);
  }
}

// Aplicar middleware a todas las rutas
router.use(n8nAuth);
router.use(resolveTenant);

// ---------------------------------------------------------------------------
// Rutas
// ---------------------------------------------------------------------------
router.get('/appointment-status', getAppointmentStatus);
router.get('/services', getServices);
router.get('/customer-history', getCustomerHistory);
router.post('/book', bookAppointment);
router.post('/log', logMessage);

module.exports = router;
