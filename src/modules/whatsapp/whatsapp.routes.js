/**
 * WhatsApp Routes
 * 
 * Rutas públicas (webhook) y protegidas (panel admin).
 */

const { Router } = require('express');
const { asyncHandler } = require('../../shared/utils/asyncHandler');
const { authenticate, authorize, requireTenant } = require('../../shared/middleware/auth');
const ctrl = require('./whatsapp.controller');

const router = Router();

// ---------------------------------------------------------------------------
// Rutas públicas (webhook - llamadas por Twilio/360dialog)
// ---------------------------------------------------------------------------

// Verificación del webhook (handshake)
router.get('/webhook', asyncHandler(ctrl.verifyWebhook));

// Recibe mensajes entrantes
router.post('/webhook', asyncHandler(ctrl.handleIncoming));

// ---------------------------------------------------------------------------
// Rutas protegidas (panel admin del lavadero)
// ---------------------------------------------------------------------------

// Mensajes recientes
router.get(
  '/messages',
  authenticate,
  requireTenant,
  authorize('admin'),
  asyncHandler(ctrl.listMessages)
);

// Conversaciones activas
router.get(
  '/conversations',
  authenticate,
  requireTenant,
  authorize('admin'),
  asyncHandler(ctrl.listConversations)
);

// Estadísticas del bot
router.get(
  '/stats',
  authenticate,
  requireTenant,
  authorize('admin'),
  asyncHandler(ctrl.getStats)
);

module.exports = router;
