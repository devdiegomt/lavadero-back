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
// ---------------------------------------------------------------------------
function n8nAuth(req, res, next) {
  const apiKey = process.env.N8N_API_KEY;

  // Si no hay clave configurada, sólo permitir en desarrollo
  if (!apiKey) {
    if (process.env.NODE_ENV === 'production') {
      return res.status(503).json({ error: 'N8N_API_KEY no configurado' });
    }
    return next();
  }

  const authHeader = req.headers['x-api-key'] || req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;

  if (token !== apiKey) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  next();
}

// ---------------------------------------------------------------------------
// Middleware: resolver tenant por número de WhatsApp (x-tenant-phone header)
// ---------------------------------------------------------------------------
async function resolveTenant(req, res, next) {
  // Opción 1: tenant ID directo (para tests internos)
  if (req.headers['x-tenant-id']) {
    req.tenantId = req.headers['x-tenant-id'];
    return next();
  }

  // Opción 2: resolver por número de WhatsApp del lavadero
  const tenantPhone = req.headers['x-tenant-phone'];
  if (!tenantPhone) {
    return res.status(400).json({
      error: 'Header x-tenant-phone o x-tenant-id requerido',
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
